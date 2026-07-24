// src/langgraph/agentNode.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — TripSetGo Copilot: Agent Node + Tool Node
//
// This module defines the two core nodes of the CopilotGraph:
//
//   callModel   — The "brain" node. Binds tools to the model and invokes it
//                 with the full conversation history + system context. Returns
//                 an AIMessage (possibly with tool_calls) to update State.
//
//   toolNode    — The "hands" node. Executes every tool_call in the last
//                 AIMessage and returns ToolMessage objects back to State. Built
//                 on LangGraph's prebuilt ToolNode for reliability.
//
// Node contract (LangGraph standard):
//   • Each node receives the FULL State snapshot.
//   • Each node returns a PARTIAL State update (only the channels it changes).
//   • Returning { messages: [newMsg] } APPENDS to messages (due to our reducer).
//
// Agent loop (Phase 3 will wire this into the StateGraph):
//
//   START → callModel → should_continue?
//                              ├─ "tools"  → toolNode → callModel → …
//                              └─ "end"   → END
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const { ToolNode }            = require('@langchain/langgraph/prebuilt')
const { HumanMessage }        = require('@langchain/core/messages')
const { getCopilotModel }     = require('./model')
const { buildMessagesWithSystem } = require('./systemPrompt')
const { createCopilotTools }  = require('./tools')
const logger                  = require('../utils/logger')

// ─────────────────────────────────────────────────────────────────────────────
// callModel — Primary Agent Node
//
// Responsibilities:
//   1. Build the tool list from the current State (tools close over tripContext)
//   2. Bind tools to the model with `.bindTools()` so Gemini knows what to call
//   3. Prepend the dynamic SystemMessage (contains trip + user context)
//   4. Invoke the model and return the AIMessage to update State.messages
//
// Why rebuild tools on every call?
//   `tripContext` may change mid-conversation (e.g., user links a different trip).
//   Re-creating context-dependent tools on each invocation ensures the agent
//   always operates on the freshest budget/destination data without a DB round-trip.
//
// Why prepend SystemMessage here rather than storing it in State?
//   The SystemMessage is intentionally ephemeral — rebuilt fresh on every call
//   so that any change to tripContext (budget, dates, etc.) is immediately
//   reflected without complex State-update coordination.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The primary agent node.  Bound to the "callModel" node in the StateGraph.
 *
 * @param {object} state — Full CopilotState snapshot
 * @param {import('@langchain/core/messages').BaseMessage[]} state.messages
 * @param {object} state.tripContext
 * @param {object} state.userContext
 * @returns {Promise<{ messages: import('@langchain/core/messages').BaseMessage[] }>}
 *   Partial state update: appends one AIMessage.
 */
async function callModel(state) {
  const { messages, tripContext, userContext } = state

  logger.info(
    `[AgentNode:callModel] Invoking model — ` +
    `messages in state: ${messages.length}, ` +
    `trip: "${tripContext?.destination || 'none'}", ` +
    `user: "${userContext?.name || 'anonymous'}"`
  )

  // ── Step 1: Build tool list (closes over current tripContext) ──────────────
  const tools = createCopilotTools(state)

  // ── Step 2: Bind tools to the model ───────────────────────────────────────
  // `.bindTools()` sends the tool schemas to Gemini as function declarations.
  // The model may then respond with a message whose `tool_calls` array is
  // populated — that's the signal for the ToolNode to execute them.
  const modelWithTools = getCopilotModel().bindTools(tools)

  // ── Step 3: Compose the full message list ─────────────────────────────────
  // [SystemMessage, ...state.messages]
  // The SystemMessage is always first; it sets personality + trip context.
  // state.messages holds the accumulated human/AI/tool history.
  const fullMessages = buildMessagesWithSystem(tripContext, userContext, messages)

  // ── Step 4: Invoke the model ───────────────────────────────────────────────
  // Returns an AIMessage. If Gemini wants to use a tool, the message will have
  // a non-empty `tool_calls` array. Otherwise it contains the final text reply.
  let response
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), 15000) // 15s timeout

  try {
    response = await modelWithTools.invoke(fullMessages, { signal: abortController.signal })
    clearTimeout(timeoutId)
    logger.info(
      `[AgentNode:callModel] Response received — ` +
      `tool_calls: ${response.tool_calls?.length ?? 0}, ` +
      `content length: ${String(response.content || '').length} chars`
    )
  } catch (err) {
    clearTimeout(timeoutId)
    logger.error(`[AgentNode:callModel] Model invocation failed: ${err.message || err}`)
    // Propagate — the graph's agentNode wrapper will catch this and manage retries.
    throw err
  }

  // Return partial state update: append the new AIMessage.
  // The messagesStateReducer in State handles the actual append.
  return { messages: [response] }
}

// ─────────────────────────────────────────────────────────────────────────────
// toolNode — Tool Execution Node (Prebuilt)
//
// LangGraph's `ToolNode` is a production-grade prebuilt that:
//   • Reads `tool_calls` from the last AIMessage in State.messages
//   • Looks up each tool by name in the provided tool array
//   • Executes all tool calls (in parallel by default)
//   • Wraps each result in a `ToolMessage` with the correct `tool_call_id`
//   • Returns { messages: [ToolMessage, ToolMessage, ...] } as a partial update
//
// The tool registry passed to ToolNode MUST match the tools bound to the model
// in `callModel`. We use the same `createCopilotTools` factory but pass a
// State-like object at ToolNode creation time.
//
// IMPORTANT: ToolNode re-creates the tool instances from the CURRENT State on
// each invocation via the `getTools` callback. This ensures the tools always
// have the latest tripContext even after a mid-conversation State update.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Factory: creates a ToolNode that dynamically resolves tools from State.
 *
 * Using a factory rather than a static ToolNode instance is required because
 * `fetch_trip_details` and `calculate_budget_impact` close over `tripContext`,
 * which can change between invocations.  The `getTools` callback runs before
 * each tool execution, ensuring tools are always bound to the latest State.
 *
 * @returns {ToolNode}
 *
 * @example
 *   // In the graph definition (Phase 3):
 *   const node = createToolNode()
 *   graph.addNode('tools', node)
 */
function createToolNode() {
  // ToolNode accepts an array of tools OR a function that returns tools.
  // We use the function form so tools are resolved fresh on each call.
  // The function receives the current State snapshot as its argument.
  return new ToolNode(
    // `getTools` callback — called by ToolNode before executing tool_calls.
    // Receives the current State and must return the tool array synchronously.
    (state) => {
      logger.info('[AgentNode:toolNode] Resolving tools for tool execution step')
      return createCopilotTools(state)
    }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// shouldContinue — Conditional Edge Function
//
// Determines whether to route back to `callModel` (tool was requested) or
// to END (model produced a final text response).
//
// This is used as the conditional edge function in the StateGraph:
//   graph.addConditionalEdges('callModel', shouldContinue, {
//     tools: 'tools',
//     end:   END,
//   })
//
// LangGraph routes to the key returned by this function.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the last message in State and decides the next graph step.
 *
 * @param {object} state — Full CopilotState snapshot
 * @returns {'tools' | 'end'}
 */
function shouldContinue(state) {
  const { messages } = state
  if (!messages || messages.length === 0) return 'end'

  const lastMessage = messages[messages.length - 1]

  // If the model made at least one tool call, route to the ToolNode.
  // tool_calls is populated by Gemini when it wants to invoke a function.
  if (
    lastMessage.tool_calls &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length > 0
  ) {
    logger.info(
      `[AgentNode:shouldContinue] Routing to tools — ` +
      `${lastMessage.tool_calls.length} tool call(s): ` +
      lastMessage.tool_calls.map((tc) => tc.name).join(', ')
    )
    return 'tools'
  }

  // Model returned a final text response — end the loop.
  logger.info('[AgentNode:shouldContinue] Routing to end — no tool calls in last message')
  return 'end'
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  callModel,
  createToolNode,
  shouldContinue,
}
