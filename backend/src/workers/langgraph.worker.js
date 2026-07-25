// src/workers/langgraph.worker.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — LangGraph Agent inside a BullMQ Worker
//
// WHY a dedicated worker?
//   Heavy itinerary generation (multi-tool ReAct loops, RAG lookups, Gemini
//   calls) can take 10–60 seconds.  Running it synchronously inside an Express
//   request would:
//     a) block the Node.js event loop (bad — all other requests queue behind it)
//     b) time out on Render/Railway's 30-second HTTP limit
//     c) fail silently if the user closes the tab mid-request
//
//   BullMQ runs this processor in a *separate* process (spawned by
//   `workers/index.js`) so:
//     • The Express event loop is free immediately after the job is enqueued.
//     • The job survives client disconnects (it's queued in Redis).
//     • Built-in retry / backoff / DLQ protects against transient errors.
//     • `job.updateProgress()` lets the frontend poll or receive Socket.io
//       progress events without opening a long-lived HTTP connection.
//
// Job data shape (queue: 'langgraph'):
//   {
//     type:           'copilot_reply'   — run the Copilot graph for one turn
//     userId:         string            — MongoDB ObjectId as string
//     conversationId: string            — MongoDB Conversation._id
//     message:        string            — the user's new message
//     tripId?:        string            — optional linked trip
//   }
//
// Progress shape (reported via job.updateProgress):
//   number  0..100   — percentage-based progress for polling clients
//
// Completion: the final AIMessage content is stored in job.returnvalue so the
//   caller (or a Socket.io event from the `completed` handler) can deliver it
//   to the client.
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const { Worker } = require('bullmq')

const { getQueueConnectionOptions } = require('../config/queue')
const { buildCopilotGraphWithCheckpointer } = require('../langgraph/graph')
const { HumanMessage }   = require('@langchain/core/messages')

const Conversation = require('../models/Conversation.model')
const Message      = require('../models/Message.model')
const Trip         = require('../models/Trip.model')
const { logFailedJob } = require('../services/dlq.service')
const logger       = require('../utils/logger')

// ── Compile the checkpointed graph once when the worker process starts ────────
// This runs in the worker process (separate from Express), so it has its own
// Mongoose connection (established in workers/index.js before initWorkers()).
let _graphPromise = null
function getGraph() {
  if (!_graphPromise) {
    _graphPromise = buildCopilotGraphWithCheckpointer().catch((err) => {
      _graphPromise = null
      throw err
    })
  }
  return _graphPromise
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
//
// BullMQ calls this function for every job it dequeues.  The function is async
// and Node.js's event loop remains free to process other jobs concurrently
// (controlled by the `concurrency` option in `new Worker()`).
//
// Async execution model:
//   • BullMQ queues jobs in Redis.  When a slot is available (concurrency),
//     it calls `processor(job)` as a standard async Promise.
//   • Node.js is single-threaded but non-blocking: while the `await` inside
//     `processor` is waiting for Gemini/MongoDB I/O, the event loop handles
//     other events (other job completions, health-check pings, etc.).
//   • CPU-intensive work should be offloaded to a `worker_thread` or child
//     process, but LangGraph agent loops are I/O-bound (network calls), so
//     plain async/await is sufficient here.
// ─────────────────────────────────────────────────────────────────────────────
const processor = async (job) => {
  const { type, userId, conversationId, message, tripId } = job.data

  logger.info(`[LangGraphWorker] Job ${job.id} started — type: ${type}, conv: ${conversationId}`)

  // ── Progress 0%: job received ─────────────────────────────────────────────
  await job.updateProgress(0)

  if (type !== 'copilot_reply') {
    throw new Error(`[LangGraphWorker] Unknown job type: "${type}"`)
  }

  // ── 1. Load conversation ──────────────────────────────────────────────────
  const conversation = await Conversation.findById(conversationId)
  if (!conversation) {
    throw new Error(`[LangGraphWorker] Conversation ${conversationId} not found`)
  }

  const threadId = `conv_${conversationId}`

  // ── 2. Load trip context (if any) ─────────────────────────────────────────
  let trip = null
  const linkedTripId = conversation.tripId || tripId
  if (linkedTripId) {
    trip = await Trip.findById(linkedTripId).select(
      'source destination startDate endDate budget numTravelers preferences planData userId'
    )
    // Safety: only use the trip if it belongs to this user
    if (trip && trip.userId.toString() !== userId) trip = null
  }

  // ── Progress 10%: context loaded ──────────────────────────────────────────
  await job.updateProgress(10)

  // ── 2b. Load user record for long-term preferences ────────────────────────
  const User = require('../models/User.model')
  const userRecord = await User.findById(userId).select('name preferences')

  // ── 3. Persist the user message ───────────────────────────────────────────
  await Message.create({
    conversationId: conversation._id,
    senderId:       userId,
    role:           'user',
    text:           message,
  })

  // ── 4. Build initial state ────────────────────────────────────────────────
  //
  // The checkpointer reloads prior turns from MongoDB automatically when the
  // same thread_id is reused, so `messages` only needs the new HumanMessage.
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
      userId,
      name:        userRecord?.name,
      preferences: userRecord?.preferences || [],
    },
  }

  const config = {
    configurable: { thread_id: threadId },
    recursionLimit: 25,
  }

  // ── Progress 20%: graph invocation starting ────────────────────────────────
  await job.updateProgress(20)

  // ── 5. Invoke the LangGraph agent ─────────────────────────────────────────
  //
  // In a BullMQ worker we use `graph.invoke()` (blocking until done) rather
  // than `graph.streamEvents()` (streaming).  The Node.js event loop stays
  // responsive because `invoke()` is async and all I/O happens via awaited
  // Promises — no CPU spin.
  //
  // If you need streaming progress to the client, use Socket.io events instead:
  //   io.to(socketId).emit('copilot:token', { token })
  // You can hook into the graph's stream inside the worker by replacing
  // `graph.invoke()` with the streamEvents loop shown in
  // copilot.langgraph.controller.js and emitting each token via Socket.io.
  let finalState
  let fullReply   = ''
  let isFallback  = false

  try {
    const graph = await getGraph()

    // ── Option A: invoke() — wait for the whole reply ───────────────────────
    finalState = await graph.invoke(initialState, config)

    // Extract the last AIMessage from the graph output.
    const lastMessage = finalState.messages
      .slice()
      .reverse()
      .find((m) => m._getType?.() === 'ai' || m.constructor?.name === 'AIMessage')

    if (lastMessage) {
      fullReply  = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content)
      isFallback = !!lastMessage.additional_kwargs?._isFallback
    }

    // ── Option B (uncomment for Socket.io token streaming from the worker) ──
    // const graph = await getGraph()
    // const io          = global.__io
    // const activeUsers = global.__activeUsers
    // const socketId    = activeUsers?.get(userId)
    //
    // for await (const event of graph.streamEvents(initialState, config, { version: 'v2' })) {
    //   if (event.event === 'on_chat_model_stream') {
    //     const token = typeof event.data?.chunk?.content === 'string'
    //       ? event.data.chunk.content
    //       : ''
    //     if (token && io && socketId) {
    //       io.to(socketId).emit('copilot:token', { conversationId, token })
    //     }
    //     fullReply += token
    //   }
    // }
  } catch (err) {
    logger.error(`[LangGraphWorker] graph.invoke failed: ${err.message}`, { threadId })
    throw err  // BullMQ will retry according to job options
  }

  // ── Progress 80%: graph finished, persisting ──────────────────────────────
  await job.updateProgress(80)

  // ── 6. Persist the assistant reply ───────────────────────────────────────
  if (fullReply.trim()) {
    try {
      await Message.create({
        conversationId: conversation._id,
        senderId:       userId,
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
      // Non-fatal — the checkpoint already stored the state.
      logger.warn(`[LangGraphWorker] Message persist failed: ${persistErr.message}`)
    }
  }

  // ── 7. Notify the client via Socket.io ────────────────────────────────────
  const io          = global.__io
  const activeUsers = global.__activeUsers
  if (io && activeUsers) {
    const socketId = activeUsers.get(userId)
    if (socketId) {
      io.to(socketId).emit('copilot:reply', {
        conversationId,
        threadId,
        reply: fullReply,
        isFallback,
      })
    }
  }

  // ── Progress 100%: done ────────────────────────────────────────────────────
  await job.updateProgress(100)

  logger.info(
    `[LangGraphWorker] Job ${job.id} completed — ` +
    `conv: ${conversationId}, chars: ${fullReply.length}, fallback: ${isFallback}`
  )

  // The return value is stored in BullMQ's job.returnvalue and accessible
  // from the `completed` event listener below.
  return { conversationId, threadId, replyLength: fullReply.length, isFallback }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker initialisation
// ─────────────────────────────────────────────────────────────────────────────

const initLangGraphWorker = () => {
  const connectionOpts = getQueueConnectionOptions()

  const worker = new Worker('langgraph', processor, {
    ...connectionOpts,
    // concurrency: how many jobs run in parallel inside this process.
    // LangGraph jobs are I/O-bound (awaiting Gemini + MongoDB), so Node.js
    // can handle several concurrently without CPU contention.
    // Keep this ≤ 5 to avoid overwhelming the Gemini API rate limits.
    concurrency: 3,
  })

  // ── Event: job completed ───────────────────────────────────────────────────
  worker.on('completed', (job, returnValue) => {
    logger.info(
      `[LangGraphWorker] ✅ Job ${job.id} completed — ` +
      `reply length: ${returnValue?.replyLength ?? 0} chars`
    )
  })

  // ── Event: job failed ──────────────────────────────────────────────────────
  worker.on('failed', (job, err) => {
    logger.error(`[LangGraphWorker] ❌ Job ${job?.id} failed: ${err.message}`)

    if (job) {
      logFailedJob('langgraph', job, err)

      // Notify the client of the failure via Socket.io
      const { conversationId, userId } = job.data
      const io          = global.__io
      const activeUsers = global.__activeUsers
      if (io && activeUsers) {
        const socketId = activeUsers.get(userId)
        if (socketId) {
          io.to(socketId).emit('copilot:error', {
            conversationId,
            error: 'The copilot encountered an error. Please try again.',
          })
        }
      }
    }
  })

  // ── Event: worker error (Redis disconnect, etc.) ───────────────────────────
  worker.on('error', (err) => {
    logger.error(`[LangGraphWorker] Worker-level error: ${err.message}`)
  })

  logger.info('[LangGraphWorker] Worker started — queue: "langgraph", concurrency: 3')
  return worker
}

module.exports = { initLangGraphWorker }
