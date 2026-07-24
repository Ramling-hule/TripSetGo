// backend/src/services/travel/utils/travelLogger.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin wrapper around the existing Winston logger (utils/logger.js) that adds
// a structured `provider` field to every log entry for easy filtering.
//
// All travel layer code imports THIS file — not logger.js directly — so we
// can swap the underlying logger without touching provider code.
//
// Usage:
//   travelLogger.info('Overpass', 'Fetched 20 attractions', { latencyMs: 123 })
//   travelLogger.warn('Foursquare', 'Rate limit hit', { retryAfterMs: 800 })
//   travelLogger.metric({ event: 'travel:request', destination: 'Goa', ... })
// ─────────────────────────────────────────────────────────────────────────────
const logger = require('../../../utils/logger')

/**
 * Build a structured log object with a `provider` tag.
 */
function buildMeta(providerName, extra = {}) {
  return { provider: providerName, service: 'travel-api', ...extra }
}

const travelLogger = {
  debug(providerName, message, meta = {}) {
    logger.debug(message, buildMeta(providerName, meta))
  },

  info(providerName, message, meta = {}) {
    logger.info(message, buildMeta(providerName, meta))
  },

  warn(providerName, message, meta = {}) {
    logger.warn(message, buildMeta(providerName, meta))
  },

  error(providerName, message, meta = {}) {
    logger.error(message, buildMeta(providerName, meta))
  },

  /**
   * Emit a structured request-lifecycle metric log.
   * Designed for future APM ingestion (Prometheus, Datadog, etc.).
   *
   * @param {Object} data — {
   *   event, destination, providersAttempted, providersSucceeded,
   *   cacheHits, totalLatencyMs, usedFallback, enrichedFields
   * }
   */
  metric(data) {
    logger.info('[travel:metric]', {
      service: 'travel-api',
      ...data,
    })
  },

  /**
   * Log a provider cache event (hit/miss/set).
   */
  cache(providerName, action, namespace, extra = {}) {
    const emoji = { HIT: '🟢', MISS: '🔴', SET: '💾', STALE: '🟡' }[action] || '⚪'
    logger.debug(`${emoji} [Cache ${action}] ${namespace}`, buildMeta(providerName, extra))
  },
}

module.exports = travelLogger
