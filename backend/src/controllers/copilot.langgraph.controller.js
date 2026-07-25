// src/controllers/copilot.langgraph.controller.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — LangGraph-powered Copilot Controller (SSE Streaming)
//
// Drop-in replacement for the `streamChat` export in copilot.controller.js.
// Key differences from the Gemini-direct version:
//
//   • Uses the compiled CopilotGraph (with MongoDB checkpointing) instead of
//     calling gemini.service.js directly.
//   • Iterates over `graph.streamEvents()` to receive fine-grained events and
//     pipe LLM token chunks to the SSE connection as they arrive.
//   • thread_id === conversation._id.toString() so LangGraph automatically
//     resumes from the last checkpoint — no manual history management needed.
//   • Manual Message persistence is kept as a safety backup (the LangGraph
//     checkpoint already stores full state, but your Conversation + Message
//     collections remain the source-of-truth for the rest of the app).
//
// Route: POST /api/v1/copilot/chat/lg
// (Register alongside the existing route, or swap it in — your choice.)
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const { HumanMessage } = require('@langchain/core/messages')

const Conversation   = require('../models/Conversation.model')
const Message        = require('../models/Message.model')
const Trip           = require('../models/Trip.model')
const asyncHandler   = require('../utils/asyncHandler')
const { notFound }   = require('../utils/response')
const logger         = require('../utils/logger')
const { sanitizeText } = require('../utils/sanitizer')
const { buildCopilotGraphWithCheckpointer } = require('../langgraph/graph')

// ── Compile the checkpointed graph once at module load.
// `buildCopilotGraphWithCheckpointer()` is async (fetches the MongoDBSaver) so
// we store the Promise and await it inside each request rather than at the top
// level.  After the first resolution the singleton is returned instantly.
let _graphPromise = null
function getGraph() {
  if (!_graphPromise) {
    _graphPromise = buildCopilotGraphWithCheckpointer().catch((err) => {
      // If MongoDB isn't ready yet, reset so the next request retries.
      _graphPromise = null
      throw err
    })
  }
  return _graphPromise
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/copilot/chat/lg  →  Server-Sent Events stream
// ─────────────────────────────────────────────────────────────────────────────
exports.streamChatLG = asyncHandler(async (req, res) => {
  // ── 1. Validate input ───────────────────────────────────────────────────────
  const userId  = req.user._id
  const message = sanitizeText(String(req.body.message || '')).trim()

  if (!message) {
    return res.status(400).json({ success: false, message: 'message is required' })
  }
  if (message.length > 2000) {
    return res.status(400).json({ success: false, message: 'message too long (max 2000 characters)' })
  }

  const requestedTripId = req.body.tripId || null

  // ── 2. Resolve (or create) the AI conversation ──────────────────────────────
  let conversation = null
  if (req.body.conversationId) {
    conversation = await Conversation.findOne({
      _id:          req.body.conversationId,
      participants: userId,
      type:         'ai_assistant',
    })
  }
  if (!conversation) {
    conversation = await Conversation.create({
      participants: [userId],
      type:         'ai_assistant',
      tripId:       requestedTripId,
    })
  }

  // The thread_id ties this conversation to its LangGraph checkpoint.
  // Format: "conv_<mongoId>" — keeps it readable in the checkpoints collection.
  const threadId = `conv_${conversation._id.toString()}`

  // ── 3. Ground the graph on the user's trip (if any) ────────────────────────
  let trip = null
  const tripId = conversation.tripId || requestedTripId
  if (tripId) {
    trip = await Trip.findById(tripId).select(
      'source destination startDate endDate budget numTravelers preferences planData userId'
    )
    if (trip && !trip.userId.equals(userId)) trip = null
  }
  const recentTrips = await Trip.find({ userId })
    .sort({ createdAt: -1 })
    .limit(3)
    .select('destination')

  // ── 4. Persist the user message to MongoDB ──────────────────────────────────
  await Message.create({
    conversationId: conversation._id,
    senderId:       userId,
    role:           'user',
    text:           message,
  })

  // ── 5. Set up SSE ───────────────────────────────────────────────────────────
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection',    'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // disable nginx / Render proxy buffering

  if (res.flushHeaders) res.flushHeaders()

  /**
   * Helper: serialise an object to an SSE `data:` frame and flush it
   * through any compression middleware immediately.
   */
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
    if (res.flush) res.flush()
  }

  // Immediately hand the client the conversation ID so it can update its URL /
  // state before the first token arrives.
  send({ type: 'meta', conversationId: conversation._id })

  // ── 6. Build the initial graph state ───────────────────────────────────────
  //
  // When a checkpointer is active, LangGraph loads the previous checkpoint for
  // this thread_id BEFORE executing the first node, so `messages` here only
  // needs to carry the NEW human message.  The full prior conversation is
  // already in the checkpoint.
  const initialState = {
    messages: [new HumanMessage(message)],
    tripContext: trip
      ? {
          source:       trip.source,
          destination:  trip.destination,
          startDate:    trip.startDate,
          endDate:      trip.endDate,
          budget:       trip.budget,
          numTravelers: trip.numTravelers,
          preferences:  trip.preferences || [],
          totalDays:    trip.planData?.meta?.total_days,
        }
      : {},
    userContext: {
      userId:      req.user._id.toString(),
      name:        req.user.name,
      preferences: req.user.preferences || [],
      recentTrips: recentTrips.map((t) => ({ destination: t.destination })),
    },
  }

  // ── 7. Stream the graph ─────────────────────────────────────────────────────
  //
  // `graph.streamEvents(state, config, { version: 'v2' })` emits a rich stream
  // of typed events.  We filter for two event types:
  //
  //   on_chat_model_stream  — a token chunk from the LLM; pipe to SSE
  //   on_chat_model_end     — the LLM finished; used for fallback detection
  //
  // All other events (on_tool_start, on_tool_end, on_chain_*) are silently
  // skipped — you can forward them to power a "Thinking…" UI indicator.
  const config = {
    configurable: {
      thread_id: threadId,  // ← THIS is what activates the checkpointer memory
    },
    recursionLimit: 25,
  }

  let fullReply = ''
  let isFallback = false

  try {
    const graph = await getGraph()

    const eventStream = graph.streamEvents(initialState, config, { version: 'v2' })

    for await (const event of eventStream) {
      const { event: eventName, data, tags } = event

      // ── Token chunk ────────────────────────────────────────────────────────
      // Fired every time the LLM outputs a partial text chunk.
      // `data.chunk` is a LangChain AIMessageChunk.
      if (eventName === 'on_chat_model_stream') {
        const chunk = data?.chunk
        if (!chunk) continue

        // Extract the string content from the message chunk.
        // content can be a string OR an array of content parts (multimodal).
        let token = ''
        if (typeof chunk.content === 'string') {
          token = chunk.content
        } else if (Array.isArray(chunk.content)) {
          // Concatenate text parts; skip image / audio parts
          token = chunk.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')
        }

        if (token) {
          fullReply += token
          send({ type: 'token', text: token })
        }
        continue
      }

      // ── Detect fallback path ───────────────────────────────────────────────
      // The fallback node produces a single AIMessage with `_isFallback: true`
      // in additional_kwargs.  We detect it here to label the SSE `done` frame.
      if (eventName === 'on_chat_model_end') {
        const output = data?.output
        if (output?.additional_kwargs?._isFallback) {
          isFallback = true
          // The fallback node writes the whole plan as one chunk; it won't come
          // through on_chat_model_stream.  Grab the content now.
          if (typeof output.content === 'string' && !fullReply) {
            fullReply = output.content
            send({ type: 'token', text: fullReply })
          }
        }
        continue
      }

      // (Optional) Forward tool-call progress to the client for a "Thinking…" UI.
      // Uncomment the block below to enable:
      //
      // if (eventName === 'on_tool_start') {
      //   send({ type: 'tool_start', name: event.name })
      // }
      // if (eventName === 'on_tool_end') {
      //   send({ type: 'tool_end', name: event.name })
      // }
    }
  } catch (err) {
    logger.error(`[CopilotLG] streamEvents failed: ${err.message}`, { threadId })

    // Attempt to detect client disconnect before writing the error frame.
    if (res.writableEnded) return

    send({
      type:    'error',
      message: 'The copilot is unavailable right now. Please try again in a moment.',
    })
    return res.end()
  }

  // ── 8. Persist the assistant reply ─────────────────────────────────────────
  //
  // LangGraph already stored the full state in MongoDB via the checkpointer.
  // We additionally save the assistant reply to the Message collection so the
  // rest of the app (notifications, exports, etc.) can read it without touching
  // the checkpoints collection.
  if (fullReply.trim()) {
    try {
      await Message.create({
        conversationId: conversation._id,
        senderId:       userId,  // assistant messages use the same userId as author
        role:           'assistant',
        text:           fullReply,
      })
      conversation.lastMessage = {
        text:     fullReply.slice(0, 200),
        senderId: userId,
        sentAt:   new Date(),
      }
      await conversation.save()
    } catch (persistErr) {
      // Non-fatal — the checkpoint already has the state.
      logger.warn(`[CopilotLG] Failed to persist assistant message: ${persistErr.message}`)
    }
  }

  // ── 9. Signal completion ────────────────────────────────────────────────────
  send({
    type:           'done',
    conversationId: conversation._id,
    threadId,
    isFallback,
  })
  res.end()
})

// ─────────────────────────────────────────────────────────────────────────────
// Re-export unchanged endpoints from the original controller so routes don't
// need to import from two files.
// ─────────────────────────────────────────────────────────────────────────────
const {
  listConversations,
  getMessages,
  deleteConversation,
} = require('./copilot.controller')

exports.listConversations  = listConversations
exports.getMessages        = getMessages
exports.deleteConversation = deleteConversation
