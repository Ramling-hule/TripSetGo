// backend/src/services/travel/providers/foursquare.hotel.provider.js
// ─────────────────────────────────────────────────────────────────────────────
// Foursquare Places v3 — Hotel Discovery Provider.
//
// Dedicated hotel provider, separate from restaurants/attractions to:
//   1. Use hotel-specific category IDs (19014 = Hotels)
//   2. Request hotel-specific fields (price, hours, website, tel)
//   3. Preserve FSQ daily quota (950/day) — hotels have their own rate budget
//
// API: Foursquare Places Search v3
//   GET /places/search
//   GET /places/{fsq_id}
//   Headers: Authorization: <api_key>
//
// Caching: hotels:city (30min), hotels:nearby (15min), hotels:detail (2h)
// ─────────────────────────────────────────────────────────────────────────────
const BaseProvider = require('./BaseProvider')
const adapter      = require('../adapters/foursquare.hotel.adapter')
const travelLogger = require('../utils/travelLogger')
const providersCfg = require('../../../config/travelProviders.config')

// ── FSQ Category IDs ─────────────────────────────────────────────────────────
// 19014 = Hotels (covers all hotel sub-types)
// See: https://docs.foursquare.com/docs/categories
const FSQ_HOTEL_CATEGORIES = '19014'

// ── Fields Requested ─────────────────────────────────────────────────────────
const FSQ_LIST_FIELDS = [
  'fsq_place_id',
  'name',
  'categories',
  'latitude',
  'longitude',
  'location',
  'distance',
  'rating',
  'stats',
  'photos',
  'hours',
  'price',
  'tel',
  'website',
  'popularity',
].join(',')

const FSQ_DETAIL_FIELDS = [
  ...FSQ_LIST_FIELDS.split(','),
  'description',
  'hours_popular',
  'attributes',
  'tips',
].join(',')

class FoursquareHotelProvider extends BaseProvider {
  constructor() {
    // Reuse the foursquare config (same API key pool, same rate limits)
    super(providersCfg.foursquare)
    this.name = 'Foursquare[Hotels]'
  }

  // ── Auth override — FSQ v3 uses Bearer token header ───────────────────────

  async request(path, params = {}, headers = {}) {
    const key = this.keyRotator.next()
    if (key) headers.Authorization = key
    headers['X-Places-Api-Version'] = '2025-06-17'
    return super.request(path, params, headers)
  }

  // ── searchHotels ──────────────────────────────────────────────────────────

  /**
   * Search hotels near given coordinates.
   *
   * @param {Object} params
   * @param {number}  params.lat
   * @param {number}  params.lon
   * @param {number}  [params.radiusM=5000]   — meters (max 100000)
   * @param {number}  [params.limit=20]
   * @param {string}  [params.sort='RATING']  — RELEVANCE | RATING | DISTANCE | POPULARITY
   * @returns {Promise<NormalisedHotel[]>}
   */
  async searchHotels({ lat, lon, radiusM = 5000, limit = 20, sort = 'RATING' } = {}) {
    if (!this.config.enabled) {
      travelLogger.warn(this.name, 'Provider disabled — FOURSQUARE_API_KEY_1 not set')
      return []
    }

    const clampedRadius = Math.min(radiusM, 100000)
    const clampedLimit  = Math.min(limit, 50)

    travelLogger.info(this.name, `Searching hotels near (${lat}, ${lon}) r=${clampedRadius}m`)

    try {
      const raw = await this.request('/places/search', {
        ll:         `${lat},${lon}`,
        categories: FSQ_HOTEL_CATEGORIES,
        radius:     clampedRadius,
        limit:      clampedLimit,
        fields:     FSQ_LIST_FIELDS,
        sort,
      })

      const hotels = adapter.normaliseMany(raw?.results || [])
      await this.circuitBreaker.recordSuccess()
      travelLogger.info(this.name, `✅ Found ${hotels.length} hotels near (${lat}, ${lon})`)
      return hotels
    } catch (err) {
      travelLogger.warn(this.name, `searchHotels failed: ${err.message}`)
      await this.circuitBreaker.recordFailure(err)
      return []
    }
  }

  // ── searchByCity ──────────────────────────────────────────────────────────

  /**
   * Search hotels by city name + geocoded coordinates.
   *
   * @param {Object} params
   * @param {number}  params.lat
   * @param {number}  params.lon
   * @param {string}  params.city
   * @param {number}  [params.radiusM=5000]
   * @param {number}  [params.limit=20]
   * @returns {Promise<NormalisedHotel[]>}
   */
  async searchByCity({ lat, lon, city, radiusM = 5000, limit = 20 } = {}) {
    return this.searchHotels({ lat, lon, radiusM, limit, sort: 'RATING' })
  }

  // ── searchNearby ──────────────────────────────────────────────────────────

  /**
   * Search hotels near user coordinates (e.g. from browser geolocation).
   *
   * @param {number} lat
   * @param {number} lon
   * @param {Object} [opts]
   * @param {number}  [opts.radiusM=2000]
   * @param {number}  [opts.limit=20]
   * @returns {Promise<NormalisedHotel[]>}
   */
  async searchNearby(lat, lon, { radiusM = 2000, limit = 20 } = {}) {
    return this.searchHotels({ lat, lon, radiusM, limit, sort: 'DISTANCE' })
  }

  // ── getHotelDetail ────────────────────────────────────────────────────────

  /**
   * Fetch full hotel details by Foursquare ID.
   *
   * @param {string} fsqId — Foursquare place ID
   * @returns {Promise<NormalisedHotel | null>}
   */
  async getHotelDetail(fsqId) {
    if (!this.config.enabled) return null
    if (!fsqId?.trim()) return null

    travelLogger.info(this.name, `Fetching detail for hotel fsqId="${fsqId}"`)

    try {
      const detail = await this.request(`/places/${encodeURIComponent(fsqId)}`, {
        fields: FSQ_DETAIL_FIELDS,
      })

      if (!detail?.fsq_id) {
        travelLogger.warn(this.name, `Empty detail response for fsqId="${fsqId}"`)
        return null
      }

      const normalised = adapter.normalise(detail)
      await this.circuitBreaker.recordSuccess()
      travelLogger.info(this.name, `✅ Hotel detail fetched for "${normalised?.name || fsqId}"`)
      return normalised
    } catch (err) {
      travelLogger.warn(this.name, `getHotelDetail failed for "${fsqId}": ${err.message}`)
      await this.circuitBreaker.recordFailure(err)
      return null
    }
  }

  // ── BaseProvider abstract stubs ────────────────────────────────────────────
  async fetchAttractions() { return [] }
  async fetchWeather()     { return null }
}

module.exports = new FoursquareHotelProvider()
