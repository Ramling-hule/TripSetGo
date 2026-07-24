// src/langgraph/graph.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3/4 — TripSetGo Copilot: StateGraph Compilation
//
// This module is the single wiring point for the entire CopilotGraph.  It pulls
// together the three pieces built in earlier phases and compiles them into a
// runnable LangGraph application:
//
//   Phase 1 → CopilotState   (state.js)   — Annotation with 3 channels
//   Phase 2 → callModel      (agentNode.js)— Agent node (Gemini + tools)
//   Phase 2 → createToolNode (agentNode.js)— ToolNode (executes tool_calls)
//   Phase 3 → graph.js (this file)         — Wiring + compilation
//   Phase 4 → checkpointer param           — Optional MongoDBSaver for memory
//
// Graph topology (ReAct loop):
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │                                                              │
//   │   START ──► [agent] ──► routeAfterAgent ──► [tools] ──┐     │
//   │                   │                                    │     │
//   │                   │  (no tool calls)                   └──► [agent]
//   │                   ▼                                          │
//   │                  END  ◄──────────────────────────────────────┘
//   │                                                              │
//   │  On consecutive errors → [fallback] ──► END                 │
//   └──────────────────────────────────────────────────────────────┘
//
// Fallback strategy:
//   The `routeAfterAgent` conditional edge tracks how many times `callModel`
//   has thrown an unrecoverable error within a single graph run.  After
//   MAX_CONSECUTIVE_ERRORS failures, the graph routes to the `fallback` node
//   instead of re-entering the agent loop.  The `fallback` node delegates to
//   `fallbackPlanner.js` — the same deterministic planner the old while-loop
//   code used — and emits a single AIMessage with the pre-built plan so the
//   caller always receives a coherent response.
//
// Usage (in a controller/worker):
//   const { buildCopilotGraph } = require('./langgraph/graph')
//
//   // Without persistence (stateless, fresh per-request):
//   const app = buildCopilotGraph()
//   const result = await app.invoke(initialState, { recursionLimit: 25 })
//
//   // With MongoDB persistence (Phase 4):
//   const { buildCopilotGraphWithCheckpointer } = require('./langgraph/graph')
//   const app = await buildCopilotGraphWithCheckpointer()
//   const result = await app.invoke(initialState, {
//     configurable: { thread_id: 'conv_<conversationId>' },
//     recursionLimit: 25,
//   })
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const { StateGraph, START, END } = require('@langchain/langgraph')
const { toolsCondition }         = require('@langchain/langgraph/prebuilt')
const { AIMessage }              = require('@langchain/core/messages')

const { CopilotState }               = require('./state')
const { callModel, createToolNode }  = require('./agentNode')
const { generatePlan }               = require('../planning/fallbackPlanner')
const logger                         = require('../utils/logger')

// ── Tuneable constants ─────────────────────────────────────────────────────────

/**
 * How many consecutive `callModel` failures are tolerated before the graph
 * abandons the agentic loop and routes to the deterministic fallback planner.
 *
 * Keep this low (≤ 2) so that transient Gemini outages don't loop for too long.
 * LangChain's internal `maxRetries: 3` on the model already handles 429 / 5xx
 * retries at the HTTP level, so this counter only ticks up after *those* have
 * been exhausted.
 */
const MAX_CONSECUTIVE_ERRORS = 2

// ─────────────────────────────────────────────────────────────────────────────
// buildCopilotGraph()
//
// Factory function that compiles a fresh CopilotGraph each time it is called.
//
// Why a factory?
//   The `consecutiveErrors` counter is closed over by both `agentNode` and
//   `routeAfterAgent`.  Calling `buildCopilotGraph()` once per HTTP request
//   gives each request its own isolated counter — a concurrent failure in
//   request A cannot poison request B's error state.
//
//   If you prefer the singleton pattern (saves ~1 ms compile time per request),
//   use `getCopilotGraph()` below.  Read the warning there first.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds and compiles a fresh CopilotGraph instance.
 *
 * @returns {import('@langchain/langgraph').CompiledStateGraph}
 */
/**
 * @param {import('@langchain/langgraph-checkpoint-mongodb').MongoDBSaver | null} [checkpointer]
 *   Optional MongoDBSaver from `getCheckpointer()`.  When supplied, LangGraph
 *   writes a state snapshot to MongoDB after every node execution and reloads
 *   it on the next call sharing the same `thread_id`.
 *
 *   Pass `null` (or omit) for stateless / test usage.
 *
 * @returns {import('@langchain/langgraph').CompiledStateGraph}
 */
function buildCopilotGraph(checkpointer = null) {

  // ─────────────────────────────────────────────────────────────────────────
  // Node: agentNode
  //
  // Thin wrapper around Phase 2's `callModel` that tracks consecutive errors
  // in the LangGraph state.
  //   • On success → resets `consecutiveErrors` to 0, returns the AIMessage.
  //   • On failure → increments `consecutiveErrors`, and returns the state
  //     so the conditional edge can route to 'fallback' if the limit is reached.
  // ─────────────────────────────────────────────────────────────────────────
  async function agentNode(state) {
    try {
      const result = await callModel(state)
      logger.debug('[Graph:agentNode] callModel succeeded; error streak reset to 0')
      return {
        ...result,
        consecutiveErrors: 0
      }
    } catch (err) {
      const currentErrors = state.consecutiveErrors || 0
      const newErrors = currentErrors + 1
      logger.error(
        `[Graph:agentNode] callModel failed ` +
        `(streak: ${newErrors}/${MAX_CONSECUTIVE_ERRORS}): ${err.message}`
      )
      
      // Unconditionally return the updated state instead of throwing.
      // If we throw, the LangGraph execution aborts, and the updated error 
      // count is NOT persisted to the checkpointer. By returning the state,
      // we allow `routeAfterAgent` to safely transition either back to 'agent'
      // for a retry, or to 'fallback' if the limit is reached.
      if (newErrors < MAX_CONSECUTIVE_ERRORS) {
        logger.info(`[Graph:agentNode] Delaying 1s before internal retry...`)
        await new Promise(r => setTimeout(r, 1000))
      }

      return { consecutiveErrors: newErrors }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Node: fallbackNode
  //
  // Deterministic safety-net.  Invoked when `callModel` has failed
  // MAX_CONSECUTIVE_ERRORS times in a row.
  //
  // Delegates to `fallbackPlanner.generatePlan()` — the same function the old
  // `gemini.service.js` while-loop fell back to — and wraps the plan in an
  // AIMessage so the caller always gets a consistent message structure.
  //
  // The `additional_kwargs._isFallback` flag lets the controller log or show
  // a "degraded mode" banner to the user.
  // ─────────────────────────────────────────────────────────────────────────
  async function fallbackNode(state) {
    const { tripContext, userContext } = state

    logger.warn(
      '[Graph:fallbackNode] Agent failed repeatedly — invoking deterministic fallbackPlanner. ' +
      `trip: "${tripContext?.destination || 'unknown'}", ` +
      `user: "${userContext?.name || 'anonymous'}"`
    )

    let planText

    try {
      // We need at least destination + dates + budget to build a meaningful plan.
      const hasMinContext =
        tripContext?.destination &&
        tripContext?.startDate   &&
        tripContext?.endDate     &&
        tripContext?.budget

      if (hasMinContext) {
        const plan = generatePlan({
          source:       tripContext.source       || 'Unknown',
          destination:  tripContext.destination,
          startDate:    tripContext.startDate,
          endDate:      tripContext.endDate,
          budget:       tripContext.budget,
          numTravelers: tripContext.numTravelers  || 1,
          groupType:    tripContext.groupType     || 'solo',
          preferences:  tripContext.preferences   || [],
        })

        // Emit a concise markdown summary so the UI can render immediately.
        // The full plan JSON is embedded in a fenced block for clients that
        // parse structured data (the frontend trip-planner page does this).
        planText =
          `⚠️ *I'm currently experiencing issues reaching my AI service. ` +
          `Here's a ready-to-use itinerary for your trip to ${tripContext.destination} ` +
          `generated from our offline planner.*\n\n` +
          `\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\``
      } else {
        // Insufficient context for a structured plan — return a graceful message.
        planText =
          `⚠️ *I'm currently experiencing issues reaching my AI service and I don't ` +
          `have enough trip details to generate an offline itinerary. ` +
          `Please try again in a moment, or provide your destination, dates, and budget ` +
          `and I'll prepare a plan for you right away.*`
      }
    } catch (fallbackErr) {
      // The fallback planner itself crashed — pure deterministic JS, so this
      // should never happen, but we handle it defensively just in case.
      logger.error(`[Graph:fallbackNode] fallbackPlanner also failed: ${fallbackErr.message}`)
      planText =
        `⚠️ *I'm temporarily unable to assist due to a service disruption. ` +
        `Please try again shortly.*`
    }

    return {
      messages: [
        new AIMessage({
          content: planText,
          // Signal to the controller that this came from the fallback path.
          additional_kwargs: { _isFallback: true },
        }),
      ],
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Conditional edge: routeAfterAgent
  //
  // Runs after the `agent` node.  Priority:
  //
  //   1. consecutiveErrors ≥ MAX_CONSECUTIVE_ERRORS  → 'fallback'
  //   2. last message has tool_calls                 → 'tools'   (toolsCondition)
  //   3. final text reply                            → END       (toolsCondition)
  //
  // We wrap LangGraph's built-in `toolsCondition` rather than rewriting it so
  // the happy-path routing stays identical to the LangGraph prebuilt standard.
  //
  // Return values must match the keys in `addConditionalEdges`'s routing map.
  // ─────────────────────────────────────────────────────────────────────────
  function routeAfterAgent(state) {
    const errors = state.consecutiveErrors || 0
    // Guard: too many consecutive failures → deterministic fallback
    if (errors >= MAX_CONSECUTIVE_ERRORS) {
      logger.warn(
        `[Graph:routeAfterAgent] Consecutive error limit reached ` +
        `(${errors}/${MAX_CONSECUTIVE_ERRORS}). Routing to fallback.`
      )
      return 'fallback'
    }
    
    // Guard: there was an error, but we haven't hit the limit.
    // Route back to 'agent' to internally retry the LLM call.
    if (errors > 0) {
      logger.info(`[Graph:routeAfterAgent] Retrying agent after failure (${errors}/${MAX_CONSECUTIVE_ERRORS})`)
      return 'agent'
    }

    // Delegate to LangGraph's prebuilt toolsCondition.
    // Returns 'tools' if state.messages[-1].tool_calls is non-empty, else END.
    return toolsCondition(state)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Graph assembly
  // ─────────────────────────────────────────────────────────────────────────

  // Step 1 — Instantiate the StateGraph with our Phase 1 annotation.
  //           This tells LangGraph the channel shapes and their reducers.
  const workflow = new StateGraph(CopilotState)

  // Step 2 — Create the ToolNode (Phase 2 factory, dynamic getTools callback).
  const toolNode = createToolNode()

  // Step 3 — Register nodes.
  //
  //  'agent'    The primary AI reasoning node.
  //             Wraps callModel with error-tracking for the fallback guard.
  //
  //  'tools'    The tool-execution node (LangGraph prebuilt ToolNode).
  //             Reads tool_calls from the last AIMessage; returns ToolMessages.
  //
  //  'fallback' The deterministic safety-net node.
  //             Produces a plan via fallbackPlanner when the agent keeps failing.
  workflow.addNode('agent',    agentNode)
  workflow.addNode('tools',    toolNode)
  workflow.addNode('fallback', fallbackNode)

  // Step 4 — Define edges.

  // 4a. Entry point: START always enters the agent node.
  workflow.addEdge(START, 'agent')

  // 4b. Conditional edge from agent:
  //       • error streak ≥ limit → 'fallback'
  //       • tool_calls present   → 'tools'
  //       • final reply          → END
  //
  //     The routing map enumerates ALL possible return values of routeAfterAgent
  //     so LangGraph can validate the wiring topology at compile time.
  workflow.addConditionalEdges(
    'agent',          // source node
    routeAfterAgent,  // routing function
    {
      agent:    'agent',    // error streak < limit → retry agent
      tools:    'tools',    // tool_calls present → execute tools
      fallback: 'fallback', // error limit hit    → deterministic plan
      [END]:    END,        // final answer        → terminate graph
    }
  )

  // 4c. ReAct back-edge: tools → agent closes the reasoning loop.
  //     After every tool execution batch, control returns to the agent so it
  //     can incorporate the ToolMessage results into its next response.
  workflow.addEdge('tools', 'agent')

  // 4d. Fallback is a terminal node: one deterministic response, then done.
  workflow.addEdge('fallback', END)

  // Step 5 — Compile.
  // Validates topology (no orphan nodes, all edges resolve), returns a
  // runnable CompiledStateGraph with .invoke(), .stream(), .streamEvents().
  //
  // Phase 4: When a `checkpointer` is provided, LangGraph automatically:
  //   • Loads previous state from MongoDB at the start of each invoke/stream
  //     call (matched by configurable.thread_id).
  //   • Saves a new checkpoint after every node execution.
  //   • interruptBefore: ['tools'] — human-in-the-loop approval gate
  //   • interruptAfter:  ['agent'] — inspect AI output before continuing
  const compileOptions = checkpointer ? { checkpointer } : {}
  const compiledGraph = workflow.compile(compileOptions)

  logger.info(
    '[Graph] CopilotGraph compiled. ' +
    `Nodes: agent, tools, fallback | ` +
    `Max consecutive errors before fallback: ${MAX_CONSECUTIVE_ERRORS} | ` +
    `Checkpointer: ${checkpointer ? 'MongoDB' : 'none (stateless)'}`
  )

  return compiledGraph
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton accessor (for tests / scripts)
//
// The compiled graph object is itself stateless. Now that `consecutiveErrors`
// is tracked in the LangGraph state instead of a closure, the compiled graph
// is fully thread-safe and can be shared across concurrent requests.
// ─────────────────────────────────────────────────────────────────────────────

let _cachedGraph = null

/**
 * Returns a singleton compiled CopilotGraph (stateless, no checkpointer).
 *
 * Safe for concurrent production traffic since state is isolated per request.
 *
 * Provided for convenience in tests, CLI scripts, and single-threaded dev runs.
 *
 * @returns {import('@langchain/langgraph').CompiledStateGraph}
 */
function getCopilotGraph() {
  if (!_cachedGraph) {
    _cachedGraph = buildCopilotGraph()
  }
  return _cachedGraph
}

// ─────────────────────────────────────────────────────────────────────────────
// buildCopilotGraphWithCheckpointer()  [Phase 4]
//
// Async factory that fetches the MongoDBSaver singleton and compiles a fresh
// graph wired to it.  Call this once at server startup (or lazily on first
// request) and reuse the compiled graph across requests — the checkpointer is
// shared safely because MongoDB handles concurrent writes at the collection
// level.
//
// Each request/conversation must supply a unique thread_id in its
// RunnableConfig so LangGraph can isolate checkpoints per conversation.
// ─────────────────────────────────────────────────────────────────────────────

let _cachedCheckpointedGraph = null

/**
 * Returns a singleton CopilotGraph compiled with MongoDB checkpointing.
 *
 * Fetches the MongoDBSaver (from checkpointer.js) and passes it to
 * `buildCopilotGraph()`.  The graph is compiled once and reused.
 *
 * ⚠️  `getCheckpointer()` requires Mongoose to be connected.  Call this after
 *    `connectDB()` has resolved (e.g. in server.js after DB init).
 *
 * @returns {Promise<import('@langchain/langgraph').CompiledStateGraph>}
 */
async function buildCopilotGraphWithCheckpointer() {
  if (_cachedCheckpointedGraph) return _cachedCheckpointedGraph

  const { getCheckpointer } = require('./checkpointer')
  const checkpointer = await getCheckpointer()

  // Note: we DON'T use buildCopilotGraph() here because the singleton
  // checkpointed graph can be safely shared — MongoDB serialises concurrent
  // checkpoint writes.  Per-request isolation of `consecutiveErrors` is still
  // desirable, so we call the factory each time IF you need that guarantee.
  // For simplicity in most deployments, a single compiled instance is fine.
  _cachedCheckpointedGraph = buildCopilotGraph(checkpointer)
  return _cachedCheckpointedGraph
}

/**
 * Resets the checkpointed graph singleton (for tests).
 */
function resetCheckpointedGraph() {
  _cachedCheckpointedGraph = null
}

/**
 * Resets the singleton (for tests — forces a fresh compile + clean error counter).
 */
function resetCopilotGraph() {
  _cachedGraph = null
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  /** Build a fresh compiled graph (recommended for request handlers). */
  buildCopilotGraph,

  /** Get the shared singleton compiled graph (for tests / scripts). */
  getCopilotGraph,

  /** Reset the singleton (for tests). */
  resetCopilotGraph,

  /**
   * [Phase 4] Build (or return cached) graph compiled with MongoDB checkpointing.
   * Requires Mongoose to be connected before first call.
   */
  buildCopilotGraphWithCheckpointer,

  /** Reset the checkpointed singleton (for tests). */
  resetCheckpointedGraph,

  /** Expose tuning constant for assertions in tests. */
  MAX_CONSECUTIVE_ERRORS,
}
