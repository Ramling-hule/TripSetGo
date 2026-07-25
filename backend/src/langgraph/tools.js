// src/langgraph/tools.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — TripSetGo Copilot: LangChain Tool Definitions
//
// Defines three deterministic tools the Copilot agent uses for dynamic RAG.
// Each tool wraps a REAL service call into your existing backend infrastructure
// (Elasticsearch ↔ MongoDB for `search_places`; pure state reads for the
// other two).
//
// Tool philosophy:
//   • Every input is validated by a strict Zod schema BEFORE the tool body
//     runs. Invalid AI-generated arguments are rejected immediately, preventing
//     hallucination errors from propagating into ES / DB calls.
//   • Every tool returns a PLAIN STRING (JSON.stringify). LangGraph's ToolNode
//     wraps this in a ToolMessage automatically.
//   • Tools NEVER throw — they return a structured error JSON instead, so the
//     agent can decide to retry or inform the user gracefully.
//   • Tool implementations are isolated from the agent node, making each
//     individually testable with jest.
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const { tool }   = require('@langchain/core/tools')
const { z }      = require('zod')
const logger     = require('../utils/logger')

// ─────────────────────────────────────────────────────────────────────────────
// Lazy service loaders
//
// We import ES / service modules lazily (inside tool bodies) rather than at
// module-load time for two reasons:
//   1. These services connect to external systems (Redis, ES, Foursquare).
//      Importing them eagerly causes startup failures in test environments.
//   2. It mirrors how the existing controllers already handle it (e.g.
//      itinerary.worker.js lazy-requires recommendation.service).
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared result normaliser ───────────────────────────────────────────────────
// Strips heavy / irrelevant fields before returning to the LLM.
// Fewer tokens = cheaper, faster, less likely to confuse the model.

function normaliseHotel(h) {
  return {
    name:          h.name             || 'Unknown',
    address:       h.address          || h.city || null,
    rating:        h.rating           ?? h.averageRating ?? null,
    pricePerNight: h.pricePerNight    ?? h.priceLevel    ?? null,
    category:      h.category         || null,
    amenities:     Array.isArray(h.amenities) ? h.amenities.slice(0, 6) : [],
    distanceLabel: h.distanceLabel    || null,
  }
}

function normaliseRestaurant(r) {
  return {
    name:          r.name             || 'Unknown',
    address:       r.address          || r.city || null,
    rating:        r.rating           ?? r.averageRating ?? null,
    cuisines:      Array.isArray(r.cuisines) ? r.cuisines.slice(0, 4) : [],
    priceLevel:    r.priceLevel       ?? null,   // 1 (cheap) → 4 (expensive)
    distanceLabel: r.distanceLabel    || null,
    openNow:       r.openNow          ?? null,
  }
}

function normaliseAttraction(a) {
  return {
    name:        a.name              || 'Unknown',
    category:    a.category          || null,
    description: a.description
      ? String(a.description).slice(0, 140)
      : null,
    rating:      a.rating            ?? a.averageRating ?? null,
    entryFee:    a.entryFee          ?? null,
    distanceLabel: a.distanceLabel   || null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 1 — search_places
//
// Searches for real hotels, restaurants, or attractions in a given city using
// the existing service layer (Foursquare API + Redis cache + Overpass fallback).
// Falls back to Elasticsearch fullTextSearch if the high-level service returns
// no results (e.g. API quota exhausted).
//
// Zod schema design decisions:
//   • `city`     — min 2 chars prevents empty/garbage queries
//   • `category` — exact enum prevents the model inventing new categories
//   • `query`    — optional free-text for narrowing ("budget", "vegetarian", ...)
//   • `limit`    — capped at 8: more results = more tokens = more hallucination risk
//   • `minRating`— optional float filter applied post-fetch
// ─────────────────────────────────────────────────────────────────────────────

const searchPlacesSchema = z.object({
  city: z
    .string()
    .min(2, 'city must be at least 2 characters')
    .max(100, 'city is too long')
    .describe('The city or destination to search in. Use the canonical English name (e.g. "Goa", "Jaipur", "Mumbai").'),

  category: z
    .enum(['hotel', 'restaurant', 'attraction'])
    .describe('The type of place to search for. Must be exactly one of: hotel, restaurant, attraction.'),

  query: z
    .string()
    .max(200, 'query is too long')
    .optional()
    .describe('Optional free-text to narrow the search (e.g. "budget hotel", "vegetarian", "heritage site"). Leave empty for a broad search.'),

  limit: z
    .number()
    .int('limit must be a whole number')
    .min(1, 'limit must be at least 1')
    .max(8, 'limit must not exceed 8 — keep context concise')
    .default(5)
    .describe('Maximum number of results to return. Keep this low (3–5) to reduce token usage.'),

  minRating: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe('Optional minimum rating filter (0–10 scale). Omit to include all results.'),
})

const searchPlaces = tool(
  async ({ city, category, query, limit, minRating }) => {
    logger.info(`[Tool:search_places] category=${category} city="${city}" query="${query || ''}" limit=${limit}`)

    try {
      let results = []

      // ── Primary: high-level service (Foursquare → Overpass fallback → Redis) ─
      if (category === 'hotel') {
        const hotelsService = require('../services/hotels.service')
        const { hotels } = await hotelsService.searchByCity(city, { limit: limit + 2 })
        results = hotels || []
      } else if (category === 'restaurant') {
        const restaurantsService = require('../services/restaurants.service')
        const { restaurants } = await restaurantsService.searchByCity(city, undefined, undefined, { limit: limit + 2 })
        results = restaurants || []
      } else if (category === 'attraction') {
        const attractionsService = require('../services/attractions.service')
        const { attractions } = await attractionsService.searchByCity(city, { limit: limit + 2 })
        results = attractions || []
      }

      // ── Fallback: Elasticsearch fullTextSearch if primary returned nothing ──
      if (!results || results.length === 0) {
        logger.warn(`[Tool:search_places] Primary service empty for ${category} in "${city}" — falling back to ES`)
        const { fullTextSearch, INDICES } = require('../services/elasticsearch.service')

        const indexMap = {
          hotel:       INDICES.hotels,
          restaurant:  INDICES.restaurants,
          attraction:  INDICES.attractions,
        }
        const esResult = await fullTextSearch({
          index:  indexMap[category],
          query:  query || city,
          filters: { city },
          fuzzy:  true,
          limit:  limit + 2,
          sort:   'rating',
        })
        results = esResult.data || []
      }

      // ── Post-process: normalise + filter by minRating + cap at limit ────────
      let normalised
      if (category === 'hotel') {
        normalised = results.map(normaliseHotel)
      } else if (category === 'restaurant') {
        normalised = results.map(normaliseRestaurant)
      } else {
        normalised = results.map(normaliseAttraction)
      }

      if (minRating != null) {
        normalised = normalised.filter(
          (item) => item.rating != null && item.rating >= minRating
        )
      }

      const trimmed = normalised.slice(0, limit)

      logger.info(`[Tool:search_places] Returning ${trimmed.length} results for ${category} in "${city}"`)

      return JSON.stringify({
        ok: true,
        category,
        city,
        count: trimmed.length,
        results: trimmed,
      })
    } catch (err) {
      logger.error(`[Tool:search_places] Error: ${err.message}`)
      // Return structured error — do NOT throw. Agent decides what to do next.
      return JSON.stringify({
        ok: false,
        error: `search_places failed for ${category} in "${city}": ${err.message}`,
        results: [],
      })
    }
  },
  {
    name: 'search_places',
    description:
      'Search for real hotels, restaurants, or attractions in a given city. ' +
      'Use this tool when the user asks for accommodation options, restaurant recommendations, ' +
      'or things to do / sightseeing. Always specify the category field precisely. ' +
      'Do NOT call this tool speculatively — only call it when the user explicitly asks for places.',
    schema: searchPlacesSchema,
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 2 — fetch_trip_details
//
// Reads the current trip constraints from the LangGraph State's `tripContext`
// channel.  The agent calls this when it needs a reminder of budget, dates,
// or traveler count before making recommendations.
//
// IMPORTANT: This tool does NOT make a DB round-trip — it reads from the State
// object that is injected at tool-definition time (see `createToolsForState`
// factory below).  This is the correct pattern for read-only State access from
// tools.
//
// Zod schema design decisions:
//   • `fields` — explicit allowlist prevents the model asking for fields that
//                don't exist in the State, which would silently return undefined.
// ─────────────────────────────────────────────────────────────────────────────

const fetchTripDetailsSchema = z.object({
  fields: z
    .array(
      z.enum([
        'destination',
        'source',
        'budget',
        'numTravelers',
        'groupType',
        'startDate',
        'endDate',
        'totalDays',
        'preferences',
        'pace',
      ])
    )
    .min(1, 'You must request at least one field')
    .max(10, 'Cannot request more than 10 fields at once')
    .describe(
      'The specific trip fields you need. Pick only what is necessary. ' +
      'Valid values: destination, source, budget, numTravelers, groupType, ' +
      'startDate, endDate, totalDays, preferences, pace.'
    ),
})

/**
 * Creates a `fetch_trip_details` tool that closes over a snapshot of
 * the current `tripContext` from State.
 *
 * The factory pattern is necessary because LangChain tool definitions are
 * immutable once created; we need to re-bind the context object on every
 * agent invocation so the tool always reflects the current graph State.
 *
 * @param {object} tripContext — The tripContext channel from CopilotState
 * @returns {import('@langchain/core/tools').DynamicStructuredTool}
 */
function createFetchTripDetailsTool(tripContext) {
  return tool(
    async ({ fields }) => {
      logger.info(`[Tool:fetch_trip_details] fields=${fields.join(', ')}`)

      if (!tripContext || Object.keys(tripContext).length === 0) {
        return JSON.stringify({
          ok:      false,
          message: 'No trip is currently linked to this conversation. The user has not selected a trip yet.',
          data:    {},
        })
      }

      // Build response with only the requested fields.
      // Unknown field names return undefined which is safe — the model will see
      // null in the JSON and understand the field is not set.
      const data = {}
      for (const field of fields) {
        const value = tripContext[field]

        // Format dates as human-readable strings for the model's benefit
        if ((field === 'startDate' || field === 'endDate') && value) {
          data[field] = new Date(value).toDateString()
        } else {
          data[field] = value !== undefined ? value : null
        }
      }

      return JSON.stringify({
        ok:   true,
        data,
      })
    },
    {
      name: 'fetch_trip_details',
      description:
        'Retrieve specific details about the user\'s current trip (budget, destination, dates, traveler count, etc.). ' +
        'Use this when you need to recall trip constraints before making a recommendation or budget calculation. ' +
        'Specify only the fields you actually need to keep the response concise.',
      schema: fetchTripDetailsSchema,
    }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 3 — calculate_budget_impact
//
// Calculates the cost impact of a proposed activity, accommodation, or transport
// on the user's remaining trip budget.  Performs all arithmetic server-side to
// prevent the LLM from doing floating-point math (a known hallucination vector).
//
// Zod schema design decisions:
//   • `proposedCost`   — must be > 0 (negative costs are meaningless)
//   • `costCategory`   — allowlist forces the model to categorise spending;
//                        helps produce clearer breakdowns for users
//   • `numTravelers`   — optional override so the model can calculate per-person
//                        costs when the user asks "how much per person?"
//   • `alreadySpent`   — cumulative spending so far, allowing accurate "remaining"
//                        calculation even mid-conversation
// ─────────────────────────────────────────────────────────────────────────────

const calculateBudgetImpactSchema = z.object({
  proposedCost: z
    .number()
    .positive('proposedCost must be a positive number')
    .describe('The cost of the proposed activity, accommodation, or item in Indian Rupees (₹). Must be > 0.'),

  costCategory: z
    .enum(['accommodation', 'transport', 'food', 'activity', 'shopping', 'misc'])
    .describe(
      'The spending category for this cost. Must be one of: ' +
      'accommodation, transport, food, activity, shopping, misc.'
    ),

  numTravelers: z
    .number()
    .int('numTravelers must be a whole number')
    .min(1, 'numTravelers must be at least 1')
    .max(50, 'numTravelers cannot exceed 50')
    .optional()
    .describe(
      'Number of travelers to split the cost across. Omit to use the trip\'s default numTravelers. ' +
      'Provide this explicitly if the user asks for a per-person breakdown.'
    ),

  alreadySpent: z
    .number()
    .min(0, 'alreadySpent cannot be negative')
    .default(0)
    .describe(
      'Total amount already spent / committed from the budget in ₹. ' +
      'Use 0 if this is the first expense being considered.'
    ),
})

/**
 * Creates a `calculate_budget_impact` tool that closes over `tripContext`
 * so it can access `budget` and `numTravelers` from State without a DB call.
 *
 * @param {object} tripContext — The tripContext channel from CopilotState
 * @returns {import('@langchain/core/tools').DynamicStructuredTool}
 */
function createCalculateBudgetImpactTool(tripContext) {
  return tool(
    async ({ proposedCost, costCategory, numTravelers, alreadySpent }) => {
      logger.info(
        `[Tool:calculate_budget_impact] cost=₹${proposedCost} category=${costCategory} ` +
        `alreadySpent=₹${alreadySpent} travelers=${numTravelers ?? 'default'}`
      )

      // Resolve total budget from State — fail clearly if not set
      const totalBudget = tripContext?.budget
      if (!totalBudget || totalBudget <= 0) {
        return JSON.stringify({
          ok:      false,
          message: 'No budget is set for this trip. Ask the user to specify their total budget first.',
        })
      }

      // Resolve traveler count — prefer argument override, then State, then 1
      const travelers = numTravelers ?? tripContext?.numTravelers ?? 1

      // ── Core arithmetic ────────────────────────────────────────────────────
      const costPerPerson      = Math.round(proposedCost / travelers)
      const totalAfterSpending = alreadySpent + proposedCost
      const remaining          = totalBudget - totalAfterSpending
      const percentUsed        = Math.round((totalAfterSpending / totalBudget) * 100)
      const isOverBudget       = remaining < 0

      // ── Affordability assessment ───────────────────────────────────────────
      // Give the model a clear signal rather than making it infer from numbers.
      let affordability
      if (isOverBudget) {
        affordability = 'over_budget'
      } else if (percentUsed >= 90) {
        affordability = 'tight'     // < 10% remaining
      } else if (percentUsed >= 70) {
        affordability = 'manageable' // 10–30% remaining
      } else {
        affordability = 'comfortable' // > 30% remaining
      }

      return JSON.stringify({
        ok:                true,
        costCategory,
        totalBudget:       totalBudget,
        proposedCost:      proposedCost,
        costPerPerson:     costPerPerson,
        numTravelers:      travelers,
        alreadySpent:      alreadySpent,
        totalAfterSpending,
        remainingBudget:   remaining,
        percentBudgetUsed: percentUsed,
        affordability,
        isOverBudget,
        // Human-friendly summary for the model to quote directly to the user
        summary:
          `Proposed ${costCategory} cost: ₹${proposedCost.toLocaleString('en-IN')} ` +
          `(₹${costPerPerson.toLocaleString('en-IN')}/person for ${travelers} traveller${travelers !== 1 ? 's' : ''}). ` +
          `After this expense: ₹${Math.abs(remaining).toLocaleString('en-IN')} ` +
          `${isOverBudget ? 'OVER budget' : 'remaining'} ` +
          `(${percentUsed}% of ₹${totalBudget.toLocaleString('en-IN')} total budget used).`,
      })
    },
    {
      name: 'calculate_budget_impact',
      description:
        'Calculate the financial impact of a proposed expense on the trip\'s total budget. ' +
        'Use this whenever the user asks if they can afford something, wants a cost breakdown, ' +
        'or asks how much budget remains after a proposed activity. ' +
        'Always use this tool for budget math — never calculate amounts yourself.',
      schema: calculateBudgetImpactSchema,
    }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 4 — save_user_preference
//
// Extracts and saves long-term user preferences to the user's database record.
// ─────────────────────────────────────────────────────────────────────────────

const saveUserPreferenceSchema = z.object({
  preference: z
    .string()
    .min(3, 'preference must be at least 3 characters')
    .max(200, 'preference is too long')
    .describe('The user preference to save in a concise format, e.g., "Prefers vegetarian food", "Travels on a tight budget".'),
})

/**
 * Creates a `save_user_preference` tool that closes over `userContext`
 * so it can access `userId` from State to update the User model.
 *
 * @param {object} userContext — The userContext channel from CopilotState
 * @returns {import('@langchain/core/tools').DynamicStructuredTool}
 */
function createSaveUserPreferenceTool(userContext) {
  return tool(
    async ({ preference }) => {
      logger.info(`[Tool:save_user_preference] preference="${preference}"`)

      if (!userContext || !userContext.userId) {
        return JSON.stringify({
          ok: false,
          message: 'No user is currently linked to this conversation. Cannot save preference.',
        })
      }

      try {
        const User = require('../models/User.model')
        const user = await User.findById(userContext.userId)

        if (!user) {
          return JSON.stringify({
            ok: false,
            message: 'User not found in the database.',
          })
        }

        if (!user.preferences) {
          user.preferences = []
        }

        user.preferences.push(preference)
        await user.save()

        return JSON.stringify({
          ok: true,
          message: `Preference saved successfully: "${preference}"`,
        })
      } catch (err) {
        logger.error(`[Tool:save_user_preference] Error: ${err.message}`)
        return JSON.stringify({
          ok: false,
          error: `Failed to save preference: ${err.message}`,
        })
      }
    },
    {
      name: 'save_user_preference',
      description:
        'Save a long-term user preference to the database (e.g., "I prefer vegetarian food", "I travel on a tight budget"). ' +
        'Call this tool whenever the user explicitly states a preference about how they travel, eat, or stay. ' +
        'These preferences are remembered across all future conversations.',
      schema: saveUserPreferenceSchema,
    }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Factory — createCopilotTools(state)
//
// Creates the full tool array for a single agent invocation, binding the
// current graph State to the two context-dependent tools.
//
// Call this ONCE per `callModel` invocation (not at module load time) so the
// tools always reflect the latest State values.
//
// @param {object} state — The full CopilotState snapshot at the current step
// @returns {DynamicStructuredTool[]} Array of 3 tools ready for model.bindTools()
// ─────────────────────────────────────────────────────────────────────────────

function createCopilotTools(state) {
  const tripContext = state?.tripContext || {}
  const userContext = state?.userContext || {}

  return [
    searchPlaces,                                  // stateless — always the same instance
    createFetchTripDetailsTool(tripContext),        // re-created with fresh tripContext
    createCalculateBudgetImpactTool(tripContext),   // re-created with fresh tripContext
    createSaveUserPreferenceTool(userContext),      // re-created with fresh userContext
  ]
}

module.exports = {
  createCopilotTools,
  // Export individual creators for unit testing
  searchPlaces,
  createFetchTripDetailsTool,
  createCalculateBudgetImpactTool,
  createSaveUserPreferenceTool,
}
