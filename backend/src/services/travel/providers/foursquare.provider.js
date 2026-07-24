// backend/src/services/travel/providers/foursquare.provider.js
// ─────────────────────────────────────────────────────────────────────────────
// Foursquare Places v3 provider — secondary source for attraction data.
// Used when Overpass lacks results or as enrichment with photos + ratings.
//
// API: GET /places/search
//   Headers: Authorization: <api_key>
//   Params:  ll, categories, limit, fields
//
// Free tier: ~950 req/day — treated as secondary provider to conserve quota.
// ─────────────────────────────────────────────────────────────────────────────
const BaseProvider = require('./BaseProvider')
const adapter      = require('../adapters/foursquare.adapter')
const travelLogger = require('../utils/travelLogger')
const providersCfg = require('../../../config/travelProviders.config')

// FSQ category IDs for travel-relevant places
// 16000 = Outdoors & Recreation, 10000 = Arts & Entertainment,
// 15000 = Landmarks & Outdoors (travel), 19000 = Religion
const FSQ_CATEGORIES = '16000,10000,15000,19000'

// Fields to request (minimise response size to conserve quota)
const FSQ_FIELDS = [
  'fsq_place_id', 'name', 'categories', 'latitude', 'longitude', 'location',
  'distance', 'rating', 'stats', 'photos', 'price',
].join(',')

class FoursquareProvider extends BaseProvider {
  constructor() {
    super(providersCfg.foursquare)
  }

  /**
   * Foursquare v3 uses bearer token in Authorization header — not a query param.
   * Override request to inject the header.
   */
  async request(path, params = {}, headers = {}) {
    const key = this.keyRotator.next()
    if (key) headers.Authorization = key
    headers['X-Places-Api-Version'] = '2025-06-17'
    return super.request(path, params, headers)
  }

  // ── Attractions ───────────────────────────────────────────────────────────

  /**
   * Fetch nearby venues from Foursquare.
   *
   * @param {Object} params
   * @param {number} params.lat
   * @param {number} params.lon
   * @param {number} [params.radiusM=10000]
   * @param {number} [params.limit=15]
   * @param {string} [params.categories]
   * @returns {Promise<NormalisedAttraction[]>}
   */
  async fetchAttractions({ lat, lon, radiusM = 10000, limit = 15, categories = FSQ_CATEGORIES }) {
    if (!this.config.enabled) return []

    const cacheRaw = `fsq:attr:${lat},${lon},${radiusM},${limit}`
    return this.fetchWithCache('travel:attractions', cacheRaw, async () => {
      travelLogger.info(this.name, `Fetching venues near (${lat}, ${lon})`)

      try {
        const raw = await this.request('/places/search', {
          ll: `${lat},${lon}`,
          categories,
          radius: radiusM,
          limit,
          fields: FSQ_FIELDS,
          sort: 'RATING',
        })

        const places = adapter.normaliseMany(raw?.results || [])

        travelLogger.info(this.name, `✅ Returning ${places.length} venues`)
        return places
      } catch (err) {
        travelLogger.warn(this.name, `fetchAttractions failed: ${err.message}`)
        return []
      }
    })
  }

  // ── Hotels & Weather ──────────────────────────────────────────────────────
  // Foursquare is not used for hotels or weather in this architecture.

  async fetchHotels() { return [] }
  async fetchWeather() { return null }
}

module.exports = new FoursquareProvider()
