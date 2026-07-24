// backend/src/services/travel/middleware/rateLimiter.js
// ─────────────────────────────────────────────────────────────────────────────
// Per-provider rate limiter supporting three strategies:
//
//  • token-bucket    — for per-second APIs (Overpass, Amadeus, Nominatim)
//                      Uses an in-memory token bucket; refills at the window rate.
//
//  • sliding-window  — for per-minute APIs (OpenWeather)
//                      Uses Redis ZADD/ZREMRANGEBYSCORE/ZCARD in a Lua script
//                      for atomic, distributed enforcement.
//
//  • daily-counter   — for per-day APIs (Foursquare free tier)
//                      Stores a daily counter key in Redis with midnight TTL.
//
// If Redis is unavailable, falls back to in-memory token-bucket for all
// strategies (acceptable for single-instance dev; Redis required for prod).
// ─────────────────────────────────────────────────────────────────────────────
const travelLogger = require('../utils/travelLogger')

// ── In-Memory Token Bucket ────────────────────────────────────────────────
class TokenBucket {
  constructor(maxRequests, windowMs) {
    this.maxTokens = maxRequests
    this.refillRateMs = windowMs / maxRequests // ms per token
    this.tokens = maxRequests
    this.lastRefillTime = Date.now()
  }

  /**
   * Attempt to consume one token.
   * @returns {{ allowed: boolean, waitMs: number }}
   */
  consume() {
    const now = Date.now()
    const elapsed = now - this.lastRefillTime
    const refilled = Math.floor(elapsed / this.refillRateMs)

    if (refilled > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + refilled)
      this.lastRefillTime = now - (elapsed % this.refillRateMs)
    }

    if (this.tokens >= 1) {
      this.tokens -= 1
      return { allowed: true, waitMs: 0 }
    }

    // Time until next token
    const waitMs = Math.ceil(this.refillRateMs - (now - this.lastRefillTime))
    return { allowed: false, waitMs }
  }
}

// ── In-Memory Daily Counter (fallback) ────────────────────────────────────
class DailyCounter {
  constructor(maxRequests) {
    this.maxRequests = maxRequests
    this.count = 0
    this.resetAt = this._nextMidnight()
  }

  _nextMidnight() {
    const d = new Date()
    d.setHours(24, 0, 0, 0)
    return d.getTime()
  }

  consume() {
    const now = Date.now()
    if (now >= this.resetAt) {
      this.count = 0
      this.resetAt = this._nextMidnight()
    }
    if (this.count < this.maxRequests) {
      this.count++
      return { allowed: true, waitMs: 0 }
    }
    const waitMs = this.resetAt - now
    return { allowed: false, waitMs }
  }
}

// ── RateLimiter (main class) ───────────────────────────────────────────────
class RateLimiter {
  /**
   * @param {string} providerName
   * @param {{ strategy: string, maxRequests: number, windowMs: number }} config
   */
  constructor(providerName, config) {
    this.providerName = providerName
    this.config = config
    this.redisClient = null // injected lazily

    // All strategies get an in-memory fallback bucket
    this._memBucket = config.strategy === 'daily-counter'
      ? new DailyCounter(config.maxRequests)
      : new TokenBucket(config.maxRequests, config.windowMs)
  }

  /**
   * Lazily acquire the shared Redis client from global scope.
   * Returns null if Redis is not connected.
   */
  _redis() {
    if (!this.redisClient && global.__redisClient) {
      this.redisClient = global.__redisClient
    }
    return this.redisClient
  }

  /**
   * Check and consume one rate-limit token/slot for this provider.
   *
   * @returns {Promise<{ allowed: boolean, waitMs: number }>}
   */
  async check() {
    const redis = this._redis()

    if (!redis) {
      // No Redis — use in-memory fallback
      return this._memBucket.consume()
    }

    const { strategy, maxRequests, windowMs } = this.config

    try {
      if (strategy === 'token-bucket' || strategy === 'sliding-window') {
        return await this._slidingWindowRedis(redis, maxRequests, windowMs)
      }

      if (strategy === 'daily-counter') {
        return await this._dailyCounterRedis(redis, maxRequests)
      }
    } catch (err) {
      travelLogger.warn(this.providerName, `Rate limiter Redis error — using in-memory fallback: ${err.message}`)
      return this._memBucket.consume()
    }

    return { allowed: true, waitMs: 0 }
  }

  /**
   * Redis sliding window via sorted set (timestamp as score).
   * Lua script ensures atomicity.
   */
  async _slidingWindowRedis(redis, maxRequests, windowMs) {
    const key = `rl:${this.providerName.toLowerCase()}:sw`
    const now = Date.now()
    const windowStart = now - windowMs

    // Lua: remove old entries, count current, conditionally add
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local windowStart = tonumber(ARGV[2])
      local max = tonumber(ARGV[3])
      local ttl = tonumber(ARGV[4])

      redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
      local count = redis.call('ZCARD', key)
      if count < max then
        redis.call('ZADD', key, now, now)
        redis.call('PEXPIRE', key, ttl)
        return {1, 0}
      end

      -- Find oldest entry to calculate wait time
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local waitMs = 0
      if #oldest >= 2 then
        waitMs = math.ceil(tonumber(oldest[2]) + ttl - now)
      end
      return {0, waitMs}
    `

    const result = await redis.eval(luaScript, 1, key,
      String(now), String(windowStart), String(maxRequests), String(windowMs))

    return {
      allowed: result[0] === 1,
      waitMs: Math.max(0, Number(result[1])),
    }
  }

  /**
   * Redis daily counter with midnight TTL.
   */
  async _dailyCounterRedis(redis, maxRequests) {
    const today = new Date().toISOString().split('T')[0]
    const key = `rl:${this.providerName.toLowerCase()}:daily:${today}`

    const luaScript = `
      local key = KEYS[1]
      local max = tonumber(ARGV[1])
      local count = redis.call('INCR', key)
      if count == 1 then
        -- Set TTL to expire at next midnight (86400s max)
        redis.call('EXPIRE', key, 86400)
      end
      if count <= max then
        return {1, 0}
      end
      return {0, 86400000}
    `

    const result = await redis.eval(luaScript, 1, key, String(maxRequests))
    return {
      allowed: result[0] === 1,
      waitMs: Number(result[1]),
    }
  }

  /**
   * Block until a token is available (up to maxWaitMs).
   * Returns false if wait exceeds limit.
   */
  async waitForSlot(maxWaitMs = 500) {
    const result = await this.check()
    if (result.allowed) return true

    if (result.waitMs <= maxWaitMs) {
      travelLogger.debug(this.providerName, `Rate limited — waiting ${result.waitMs}ms for slot`)
      await new Promise(r => setTimeout(r, result.waitMs))
      return true
    }

    travelLogger.warn(this.providerName, `Rate limit exceeded — wait ${result.waitMs}ms > max ${maxWaitMs}ms`, {
      waitMs: result.waitMs,
      maxWaitMs,
    })
    return false
  }
}

module.exports = RateLimiter
