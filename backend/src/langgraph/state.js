// src/langgraph/state.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — TripSetGo Copilot: LangGraph State Definition
//
// This module defines the canonical State shape that flows through every node
// in the CopilotGraph.  We use LangGraph's Annotation API (the JS equivalent of
// TypedDict + operator.add for Python) so the runtime can safely merge partial
// state updates returned from each node.
//
// Three top-level channels:
//
//   messages    — The running conversation as LangChain BaseMessage objects.
//                 The reducer APPENDS incoming messages to the existing array
//                 (using the built-in messagesStateReducer). This is the
//                 standard LangGraph pattern for chat-history accumulation.
//
//   tripContext — A plain object with the current trip's structured details
//                 (destination, budget, dates, …).  The reducer MERGES (shallow
//                 Object.assign) so a node can update just one field without
//                 wiping the rest.
//
//   userContext — A plain object with user-profile data (name, preferences,
//                 recentTrips).  Same merge reducer as tripContext.
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const { Annotation, messagesStateReducer } = require('@langchain/langgraph')

// ── tripContext reducer ────────────────────────────────────────────────────────
// Accepts a partial object and shallow-merges it onto the existing state.
// This lets any node do:
//   return { tripContext: { budget: 50000 } }
// without discarding unrelated fields like `destination`.
//
// Passing `null` or `undefined` resets the context to an empty object,
// which happens when a conversation is started without a linked trip.
function mergeTripContext(existing, incoming) {
  if (incoming === null || incoming === undefined) return {}
  return Object.assign({}, existing, incoming)
}

// ── userContext reducer ────────────────────────────────────────────────────────
// Same merge strategy as tripContext.  userContext is always populated from the
// authenticated session, so it should never be null in normal operation.
function mergeUserContext(existing, incoming) {
  if (incoming === null || incoming === undefined) return {}
  return Object.assign({}, existing, incoming)
}

// ── CopilotState ──────────────────────────────────────────────────────────────
// Annotation.Root is the LangGraph equivalent of a TypedDict / dataclass for
// the graph's state.  Each key is a "channel" and its `reducer` controls how
// partial updates (returned by nodes) are merged into the full state object.
//
// Field definitions:
//
//   messages {BaseMessage[]}
//     - Managed by the built-in `messagesStateReducer`.
//     - Understands LangChain message removal semantics (RemoveMessage).
//     - Default: empty array (no prior history).
//
//   tripContext {object}
//     - destination  {string}  — e.g. "Goa"
//     - source       {string}  — departure city, e.g. "Mumbai"
//     - budget       {number}  — total budget in INR
//     - numTravelers {number}  — party size
//     - groupType    {string}  — "solo" | "couple" | "family" | "friends"
//     - startDate    {string}  — ISO date string
//     - endDate      {string}  — ISO date string
//     - totalDays    {number}  — derived from planData.meta.total_days
//     - preferences  {string[]}— e.g. ["beach", "food", "adventure"]
//     - planData     {object|null} — the full Gemini-generated plan blob
//     Default: empty object (no linked trip).
//
//   userContext {object}
//     - name         {string}  — user's display name
//     - recentTrips  {Array}   — last N trips [{ destination }]
//     Default: empty object (hydrated from req.user on every request).
//
//   consecutiveErrors {number}
//     - Tracks consecutive callModel failures to trigger fallback logic.
const CopilotState = Annotation.Root({
  /**
   * messages — Append-only conversation history.
   *
   * Each entry is a LangChain BaseMessage (HumanMessage, AIMessage,
   * SystemMessage).  The reducer appends new messages from node return values;
   * it does NOT replace the full array.
   *
   * Example node return:
   *   return { messages: [new AIMessage("Here's your Goa itinerary...")] }
   */
  messages: Annotation({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /**
   * tripContext — Structured data about the trip currently in scope.
   *
   * This is populated once at the start of each request from the MongoDB Trip
   * document (if the user has linked a trip to this conversation).  Nodes can
   * update individual fields by returning a partial object; unmentioned fields
   * are preserved by the merge reducer.
   *
   * Set to {} (or omit) if no trip is linked.
   *
   * Example node return (partial update):
   *   return { tripContext: { budget: 60000 } }
   */
  tripContext: Annotation({
    reducer: mergeTripContext,
    default: () => ({}),
  }),

  /**
   * userContext — Lightweight user-profile data for personalisation.
   *
   * Populated at request time from the Express session (req.user + recentTrips
   * query).  Nodes should treat this as read-only; they may update it if the
   * graph adds a profile-refresh node in a later phase.
   *
   * Example node return (extending recentTrips):
   *   return { userContext: { recentTrips: [...updated] } }
   */
  userContext: Annotation({
    reducer: mergeUserContext,
    default: () => ({}),
  }),

  /**
   * consecutiveErrors — Tracks agent failures in the current graph run.
   * Replaces the old closure-based counter to ensure thread-safety
   * when multiple requests share the same compiled graph.
   */
  consecutiveErrors: Annotation({
    reducer: (existing, incoming) => incoming,
    default: () => 0,
  }),
})

module.exports = { CopilotState }
