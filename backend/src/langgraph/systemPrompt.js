// src/langgraph/systemPrompt.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — TripSetGo Copilot: Dynamic System Prompt Builder
//
// This module replaces the hand-rolled `buildSystemPrompt()` string builder
// in copilot.controller.js with a proper LangChain / LangGraph pattern:
//
//   OLD (raw SDK):
//     const system = buildSystemPrompt({ user, trip, recentTrips })
//     const model  = buildCopilotModel(system)  // injects as systemInstruction
//     for await (const token of model.generateContentStream(...)) { ... }
//
//   NEW (LangGraph):
//     const systemMsg = buildSystemMessage(state.tripContext, state.userContext)
//     const boundModel = getCopilotModel().withConfig({ ... })
//     const messages   = [systemMsg, ...state.messages]
//     for await (const chunk of boundModel.stream(messages)) { ... }
//
// Why a SystemMessage object instead of a plain string?
//   LangChain's ChatModel.stream() / invoke() accept an array of BaseMessage
//   objects.  A SystemMessage placed as the FIRST element is automatically
//   converted to the provider-specific system instruction format (Gemini,
//   OpenAI, Anthropic, etc.).  This makes the code portable across providers.
//
// Exported helpers:
//   buildSystemMessage(tripContext, userContext) → SystemMessage
//   buildBoundModel(tripContext, userContext)    → ChatGoogleGenerativeAI
//   buildInitialMessages(tripContext, userContext, priorMessages) → BaseMessage[]
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const { SystemMessage } = require('@langchain/core/messages')
const { getCopilotModel } = require('./model')

// ── Core system prompt lines (static) ─────────────────────────────────────────
// These lines form the immutable personality and capability declaration of the
// TripSetGo Copilot.  They are identical to the originals in copilot.controller.js
// so that migration does not change the model's behaviour.
const PERSONA_LINES = [
  'You are TripSetGo Copilot, an expert and friendly AI travel assistant for an Indian travel-planning app.',
  'Help the user plan and refine trips: suggest destinations, attractions, restaurants and hidden gems, optimise budgets, explain costs, build day-wise plans, and adjust itineraries on request.',
  'Be concise, practical and specific. Show prices in Indian Rupees (₹). Prefer short paragraphs or tight bullet lists.',
  'Never claim to make real bookings or payments. If you lack a detail, ask one short clarifying question.',
]

/**
 * Builds the full system prompt text from CopilotState channels.
 *
 * Mirrors the original `buildSystemPrompt({ user, trip, recentTrips })` but
 * reads structured data from the LangGraph State instead of raw Express objects.
 *
 * @param {object} tripContext  - State channel: tripContext
 *   @param {string}   [tripContext.destination]
 *   @param {string}   [tripContext.source]
 *   @param {number}   [tripContext.numTravelers]
 *   @param {number}   [tripContext.budget]
 *   @param {string}   [tripContext.startDate]
 *   @param {string}   [tripContext.endDate]
 *   @param {number}   [tripContext.totalDays]
 *   @param {string[]} [tripContext.preferences]
 *
 * @param {object} userContext  - State channel: userContext
 *   @param {string}   [userContext.userId]
 *   @param {string}   [userContext.name]
 *   @param {string[]} [userContext.preferences]
 *   @param {Array}    [userContext.recentTrips]  - [{ destination }]
 *
 * @returns {string}  The fully-assembled system prompt text.
 */
function buildSystemPromptText(tripContext, userContext) {
  // Start with the immutable persona lines (spread so we don't mutate the constant)
  const lines = [...PERSONA_LINES]

  // ── User personalisation ────────────────────────────────────────────────────
  if (userContext?.name) {
    lines.push(`The user's name is ${userContext.name}.`)
  }

  // ── Active trip grounding ───────────────────────────────────────────────────
  // Injecting the current trip's details directly into the system prompt gives
  // the model authoritative context — it knows the budget, dates, and party size
  // without the user having to repeat them in every message.
  if (tripContext?.destination) {
    const {
      source,
      destination,
      numTravelers,
      budget,
      startDate,
      endDate,
      totalDays,
      preferences,
    } = tripContext

    // Compose a compact trip summary line.
    const fromPart = source ? `${source} → ` : ''
    const travelerPart = numTravelers
      ? `${numTravelers} traveller(s), `
      : ''
    const budgetPart = budget ? `total budget ₹${budget}, ` : ''
    const datesPart = (startDate && endDate)
      ? `dates ${new Date(startDate).toDateString()} to ${new Date(endDate).toDateString()}.`
      : ''

    lines.push(
      `CURRENT TRIP: ${fromPart}${destination}, ${travelerPart}${budgetPart}${datesPart}`,
    )

    // Duration (sourced from the plan's meta, not raw date math, for accuracy)
    if (totalDays) {
      lines.push(`The current plan spans ${totalDays} days.`)
    }

    // User preferences (e.g. "beach, food, adventure") sharpen recommendations
    if (Array.isArray(preferences) && preferences.length > 0) {
      lines.push(`Trip preferences: ${preferences.join(', ')}.`)
    }
  }

  // ── Long-term User Preferences ──────────────────────────────────────────────
  // Baseline understanding of the user's general likes/dislikes (saved from previous chats).
  const userPreferences = userContext?.preferences
  if (Array.isArray(userPreferences) && userPreferences.length > 0) {
    lines.push(`The user has the following long-term travel preferences: ${userPreferences.join('; ')}.`)
  }

  // ── Travel history ──────────────────────────────────────────────────────────
  // Knowing where the user has been helps the model avoid repetitive suggestions
  // and tailor recommendations to their travel style.
  const recentTrips = userContext?.recentTrips
  if (Array.isArray(recentTrips) && recentTrips.length > 0) {
    const destinations = recentTrips
      .map((t) => t.destination)
      .filter(Boolean)
      .join(', ')
    if (destinations) {
      lines.push(`The user has recently planned trips to: ${destinations}.`)
    }
  }

  return lines.join('\n')
}

/**
 * Builds a LangChain `SystemMessage` from State channels.
 *
 * This is the primary export for use inside LangGraph nodes.
 * Place this message as the FIRST element of the messages array passed to
 * the model — LangChain maps it to Gemini's `system_instruction` field.
 *
 * @param {object} tripContext  - CopilotState.tripContext value
 * @param {object} userContext  - CopilotState.userContext value
 * @returns {SystemMessage}
 *
 * @example
 *   // Inside a LangGraph node:
 *   async function copilotNode(state) {
 *     const systemMsg = buildSystemMessage(state.tripContext, state.userContext)
 *     const fullMessages = [systemMsg, ...state.messages]
 *     const response = await getCopilotModel().invoke(fullMessages)
 *     return { messages: [response] }
 *   }
 */
function buildSystemMessage(tripContext, userContext) {
  const text = buildSystemPromptText(tripContext, userContext)
  return new SystemMessage(text)
}

/**
 * Returns the shared model with the system message pre-wired.
 *
 * In LangGraph nodes that use `.stream()`, callers can either:
 *   A) Prepend the SystemMessage to the messages array (preferred — explicit).
 *   B) Use `buildBoundModel()` which attaches the system message via
 *      `model.withConfig({ configurable: { systemMessage: ... } })`.
 *
 * We expose BOTH approaches so Phase 2 graph nodes can choose the style
 * that fits their structure best.  Option A is the idiomatic LangGraph way.
 *
 * Note: `ChatGoogleGenerativeAI` does not support `bindTools` with a system
 * message natively, so we rely on the message-array approach (Option A).
 * This function is a convenience wrapper that builds the messages list.
 *
 * @param {object} tripContext
 * @param {object} userContext
 * @param {import('@langchain/core/messages').BaseMessage[]} priorMessages
 *   — The current state.messages (already-accumulated history without the
 *     system message, which is rebuilt fresh on every request).
 * @returns {import('@langchain/core/messages').BaseMessage[]}
 *   A complete messages array: [SystemMessage, ...priorMessages]
 */
function buildMessagesWithSystem(tripContext, userContext, priorMessages) {
  const systemMsg = buildSystemMessage(tripContext, userContext)

  // The system message always goes first.  We deliberately do NOT persist it
  // in state.messages so it stays dynamic — if the user's trip budget changes
  // mid-conversation, the next invocation picks up the updated context.
  return [systemMsg, ...priorMessages]
}

/**
 * Convenience: build the full messages array AND stream tokens from the model.
 *
 * This is the thin bridge between Phase 1 (state + model) and the Phase 2
 * graph node.  It encapsulates the "prepend system → stream" pattern so nodes
 * stay focused on state transitions.
 *
 * @param {object} tripContext
 * @param {object} userContext
 * @param {import('@langchain/core/messages').BaseMessage[]} priorMessages
 * @returns {AsyncIterable<import('@langchain/core/messages').AIMessageChunk>}
 *
 * @example
 *   // In the streamChat controller (Phase 2):
 *   const stream = streamCopilotResponse(
 *     state.tripContext,
 *     state.userContext,
 *     state.messages,
 *   )
 *   for await (const chunk of stream) {
 *     send({ type: 'token', text: chunk.content })
 *   }
 */
async function* streamCopilotResponse(tripContext, userContext, priorMessages) {
  const model = getCopilotModel()
  const fullMessages = buildMessagesWithSystem(tripContext, userContext, priorMessages)

  // model.stream() returns an async iterable of AIMessageChunk.
  // Each chunk has a `.content` property (string) with the partial token text.
  const stream = await model.stream(fullMessages)
  for await (const chunk of stream) {
    // Yield only non-empty content — matches the original:
    //   const t = typeof chunk.text === 'function' ? chunk.text() : ''
    //   if (t) yield t
    if (chunk.content) yield chunk
  }
}

module.exports = {
  buildSystemPromptText,  // low-level: returns raw string (useful for logging/tests)
  buildSystemMessage,     // returns a LangChain SystemMessage object
  buildMessagesWithSystem, // prepends system msg to an existing messages array
  streamCopilotResponse,  // full pipeline: build messages → stream from model
}
