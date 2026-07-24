// backend/src/services/travel/providerRegistry.js
// ─────────────────────────────────────────────────────────────────────────────
// Runtime provider registry with priority-ordered chains per data domain.
//
// Defines:
//   attractions: Overpass (primary) → Foursquare[Attractions] (secondary)
//   hotels:      Foursquare[Hotels] (sole provider, replaces Amadeus)
//   weather:     OpenWeather (sole provider)
//
// The registry is the single place where provider priority and routing logic
// is declared. travelApi.service.js and planEnricher import from here.
// ─────────────────────────────────────────────────────────────────────────────
const overpassProvider      = require('./providers/overpass.provider')
const fsqAttrProvider       = require('./providers/foursquare.attraction.provider')
const fsqHotelProvider      = require('./providers/foursquare.hotel.provider')
const openWeatherProvider   = require('./providers/openWeather.provider')
const aviationStackProvider = require('./providers/aviationstack.provider')
const travelLogger          = require('./utils/travelLogger')

const registry = {
  /**
   * Attraction provider chain (primary → secondary).
   * Secondary is invoked only if primary returns < minResults attractions.
   */
  attractions: {
    primary:    overpassProvider,
    secondary:  fsqAttrProvider,
    minResults: 5,
  },

  /**
   * Hotel provider chain (Foursquare Places — replaces Amadeus).
   * Uses coordinate-based search (geocoded from city name).
   */
  hotels: {
    primary: fsqHotelProvider,
  },

  /**
   * Weather provider chain (single provider).
   */
  weather: {
    primary: openWeatherProvider,
  },

  /**
   * Flight provider chain (single provider).
   * Used only for health reporting; flights.service.js calls the provider directly.
   */
  flights: {
    primary: aviationStackProvider,
  },
}

// ── fetchAttractions ──────────────────────────────────────────────────────────

/**
 * Fetch attractions using the primary → secondary fallback chain.
 *
 * @param {Object} params — { lat, lon, radiusM, limit, kinds }
 * @returns {Promise<{ primary: NormalisedAttraction[], secondary: NormalisedAttraction[] }>}
 */
async function fetchAttractions(params) {
  const { primary, secondary, minResults } = registry.attractions
  let results = []

  // Try primary (Overpass)
  try {
    results = await primary.fetchAttractions(params)
    travelLogger.info('Registry', `Primary (${primary.name}): ${results.length} attractions`)
  } catch (err) {
    travelLogger.warn('Registry', `Primary attractions provider failed: ${err.message}`, {
      provider: primary.name,
    })
  }

  // Try secondary (Foursquare) if primary returned too few results
  if (results.length < minResults && secondary?.config?.enabled) {
    travelLogger.info('Registry', `Invoking secondary (${secondary.name}) — primary returned ${results.length}/${minResults}`)
    try {
      const secondaryResults = await secondary.fetchAttractions(params)
      return { primary: results, secondary: secondaryResults }
    } catch (err) {
      travelLogger.warn('Registry', `Secondary attractions provider failed: ${err.message}`, {
        provider: secondary.name,
      })
    }
  }

  return { primary: results, secondary: [] }
}

// ── fetchHotels ───────────────────────────────────────────────────────────────

/**
 * Fetch hotels via Foursquare Places.
 * Accepts geocoded coordinates (travelApi resolves city → lat/lon before calling).
 *
 * @param {Object} params — { lat, lon, city, radiusM?, limit?, budget?, nights? }
 * @returns {Promise<NormalisedHotel[]>}
 */
async function fetchHotels(params) {
  try {
    const { lat, lon, city, radiusM = 5000, limit = 10 } = params
    if (!lat || !lon) {
      travelLogger.warn('Registry', 'fetchHotels: lat/lon required — skipping FSQ call')
      return []
    }
    return await registry.hotels.primary.searchByCity({ lat, lon, city, radiusM, limit })
  } catch (err) {
    travelLogger.warn('Registry', `Hotel provider failed: ${err.message}`)
    return []
  }
}

// ── fetchRestaurants ─────────────────────────────────────────────────────────

/**
 * Fetch restaurants via Foursquare Places.
 * Accepts geocoded coordinates (travelApi resolves city → lat/lon before calling).
 *
 * @param {Object} params — { lat, lon, city, radiusM?, limit?, cuisine?, budget? }
 * @returns {Promise<NormalisedRestaurant[]>}
 */
async function fetchRestaurants(params) {
  try {
    const { lat, lon, city, radiusM = 5000, limit = 10 } = params
    if (!lat || !lon) {
      travelLogger.warn('Registry', 'fetchRestaurants: lat/lon required — skipping FSQ call')
      return []
    }
    const fsqRestProvider = require('./providers/foursquare.restaurant.provider')
    return await fsqRestProvider.searchByCity({ lat, lon, city, radiusM, limit })
  } catch (err) {
    travelLogger.warn('Registry', `Restaurant provider failed: ${err.message}`)
    return []
  }
}

// ── fetchWeather ──────────────────────────────────────────────────────────────

/**
 * Fetch weather via OpenWeather.
 *
 * @param {Object} params — { city, lat, lon }
 * @returns {Promise<NormalisedWeather | null>}
 */
async function fetchWeather(params) {
  try {
    return await registry.weather.primary.fetchWeather(params)
  } catch (err) {
    travelLogger.warn('Registry', `Weather provider failed: ${err.message}`)
    return null
  }
}

// ── fetchFlights ──────────────────────────────────────────────────────────────

/**
 * Fetch flights via AviationStack.
 *
 * @param {Object} params — { source, destination, date }
 * @returns {Promise<NormalisedFlight[]>}
 */
async function fetchFlights({ source, destination, date }) {
  if (!source || !destination) return []
  try {
    const avProvider = registry.flights.primary
    // 1. Get IATA codes for source and destination cities
    const [srcAirports, destAirports] = await Promise.all([
      avProvider.searchAirportsByCity(source, 1),
      avProvider.searchAirportsByCity(destination, 1)
    ])
    const depIata = srcAirports[0]?.iataCode
    const arrIata = destAirports[0]?.iataCode
    if (!depIata || !arrIata) return []
    // 2. Fetch flights
    return await avProvider.searchFlights({ depIata, arrIata, flightDate: date, limit: 5 })
  } catch (err) {
    travelLogger.warn('Registry', `Flight provider failed: ${err.message}`)
    return []
  }
}

// ── healthCheck ───────────────────────────────────────────────────────────────

/**
 * Get health status of all registered providers.
 */
async function healthCheck() {
  const providers = [
    overpassProvider,
    fsqAttrProvider,
    fsqHotelProvider,
    openWeatherProvider,
    aviationStackProvider,
  ]

  const statuses = await Promise.allSettled(providers.map(p => p.healthStatus()))
  return statuses.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { name: providers[i].name, error: r.reason?.message }
  )
}

module.exports = { fetchAttractions, fetchHotels, fetchRestaurants, fetchWeather, fetchFlights, healthCheck, registry }
