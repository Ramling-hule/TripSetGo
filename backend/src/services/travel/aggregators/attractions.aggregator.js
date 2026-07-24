// backend/src/services/travel/aggregators/attractions.aggregator.js
// ─────────────────────────────────────────────────────────────────────────────
// Merges and deduplicates attraction results from Overpass + Foursquare.
//
// Strategy:
//   1. Overpass is PRIMARY (broad coverage, free, no daily cap)
//   2. FSQ is SECONDARY (better ratings/photos, 950/day cap — used sparingly)
//   3. Deduplicate by proximity (< 150m apart = same place)
//   4. Prefer FSQ entry when duplicated (better data quality)
//   5. Score and sort: rating weight + mustSee bonus + image bonus
// ─────────────────────────────────────────────────────────────────────────────
const travelLogger = require('../utils/travelLogger')

// Distance threshold for deduplication (metres)
const DEDUP_THRESHOLD_M = 150

// Max attractions to return from the aggregator
const MAX_RESULTS = 12

/**
 * Haversine distance between two coordinates in metres.
 */
function haversineM(a, b) {
  if (!a || !b) return Infinity
  const R = 6371000 // Earth radius in metres
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

/**
 * Score an attraction for ranking.
 */
function score(attraction) {
  let s = 0
  if (attraction.rating != null)  s += attraction.rating * 20        // 0–100
  if (attraction.mustSee)         s += 25
  if (attraction.image)           s += 10
  if (attraction.description)     s += 5
  if (attraction.totalRatings)    s += Math.min(10, Math.log10(attraction.totalRatings) * 5)
  return s
}

/**
 * Merge Overpass + FSQ results, deduplicate, sort by score.
 *
 * @param {NormalisedAttraction[]} primaryList  — From Overpass (OpenStreetMap)
 * @param {NormalisedAttraction[]} fsqList  — From Foursquare
 * @param {number} [limit=MAX_RESULTS]
 * @returns {NormalisedAttraction[]}
 */
function aggregate(primaryList = [], fsqList = [], limit = MAX_RESULTS) {
  const all = [...primaryList, ...fsqList]

  if (all.length === 0) return []

  // Deduplicate: for each pair within DEDUP_THRESHOLD_M, keep FSQ (better data)
  const kept = []
  const dropped = new Set()

  for (let i = 0; i < all.length; i++) {
    if (dropped.has(i)) continue

    const current = all[i]
    let bestIdx = i

    for (let j = i + 1; j < all.length; j++) {
      if (dropped.has(j)) continue
      const dist = haversineM(current.coordinates, all[j].coordinates)
      if (dist < DEDUP_THRESHOLD_M) {
        // Prefer FSQ entry; otherwise keep higher-scored entry
        if (all[j].source === 'Foursquare') {
          dropped.add(bestIdx)
          bestIdx = j
        } else {
          dropped.add(j)
        }
      }
    }

    if (!dropped.has(bestIdx)) kept.push(all[bestIdx])
  }

  // Sort by composite score descending
  const sorted = kept.sort((a, b) => score(b) - score(a)).slice(0, limit)

  travelLogger.info('AttractionsAggregator', `Aggregated ${sorted.length} attractions`, {
    primaryInput: primaryList.length,
    fsqInput: fsqList.length,
    merged:   kept.length,
    returned: sorted.length,
    dropped:  dropped.size,
  })

  return sorted
}

module.exports = { aggregate, haversineM, score }
