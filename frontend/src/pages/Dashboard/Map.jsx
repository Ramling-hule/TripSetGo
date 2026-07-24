// src/pages/Dashboard/Map.jsx
// TripSetGo — Spatial Planning Workspace
// Integrates Mapbox GL with Redux trip itineraries, daily routing, and nearby POI editing.
import { useState, useCallback, useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  MapPin, Navigation, Compass, Layers, Calendar, DollarSign, 
  Sun, Cloud, CloudRain, Plus, Trash2, Clock, Check, AlertCircle, 
  ChevronDown, ChevronUp, Sliders, Map as MapIcon, HelpCircle, 
  Search, Thermometer, User, Compass as DiscoverIcon, Info, ExternalLink
} from 'lucide-react'
import { useMapbox } from '@/hooks/useMapbox'
import MapContainer from '@/components/map/MapContainer'
import MapMarker from '@/components/map/MapMarker'
import MapPopup from '@/components/map/MapPopup'
import RouteLayer from '@/components/map/RouteLayer'
import api from '@/services/api'
import { 
  fetchMyTrips, fetchTrip, selectTrips, selectCurrentTrip, 
  clearCurrentTrip 
} from '@/features/trips/tripsSlice'
import { selectUser } from '@/features/auth/authSlice'

const LAYER_DEFAULTS = { Hotel: false, Restaurant: false, Attraction: false }

const DEFAULT_IMAGES = {
  Hotel: 'https://placehold.co/400x400/161d27/96a6b8?text=Hotel',
  Restaurant: 'https://placehold.co/400x400/161d27/96a6b8?text=Restaurant',
  Attraction: 'https://placehold.co/400x400/161d27/96a6b8?text=Attraction'
}

// Normalize nearby POIs to front-end marker model
function normaliseHotel(h, idx) {
  if (!h?.coordinates?.lat || !h?.coordinates?.lon) return null
  return {
    _id: h.providerPlaceId || h.id || `hotel-${idx}`,
    _entityType: 'Hotel',
    name: h.name || 'Unknown Hotel',
    location: { type: 'Point', coordinates: [h.coordinates.lon, h.coordinates.lat] },
    address: h.address || '',
    city: h.city || '',
    averageRating: h.rating ?? 0,
    image: h.image || h.photos?.[0] || DEFAULT_IMAGES.Hotel,
    priceInfo: h.priceInfo || null,
    isOpenNow: h.isOpenNow ?? null,
    distanceLabel: h.distanceLabel || null,
    category: h.category || 'Hotel',
  }
}

function normaliseRestaurant(r, idx) {
  if (!r?.coordinates?.lat || !r?.coordinates?.lon) return null
  return {
    _id: r.providerPlaceId || r.id || `restaurant-${idx}`,
    _entityType: 'Restaurant',
    name: r.name || 'Unknown Restaurant',
    location: { type: 'Point', coordinates: [r.coordinates.lon, r.coordinates.lat] },
    address: r.address || '',
    city: r.city || '',
    averageRating: r.rating ?? r.averageRating ?? 0,
    image: r.image || r.photo || r.photos?.[0] || DEFAULT_IMAGES.Restaurant,
    cuisines: r.cuisines || [],
    priceInfo: r.priceInfo || null,
    isOpenNow: r.isOpenNow ?? r.isOpen ?? null,
    distanceLabel: r.distanceLabel || null,
    category: r.category || 'Restaurant',
  }
}

function normaliseAttraction(a, idx) {
  if (!a?.coordinates?.lat || !a?.coordinates?.lon) return null
  return {
    _id: a.xid || a.id || `attraction-${idx}`,
    _entityType: 'Attraction',
    name: a.name || 'Unknown Attraction',
    location: { type: 'Point', coordinates: [a.coordinates.lon, a.coordinates.lat] },
    address: a.address || '',
    city: a.city || '',
    averageRating: a.rating ?? 0,
    image: a.image || a.images?.[0] || DEFAULT_IMAGES.Attraction,
    category: a.category || 'Attraction',
    popularityScore: a.popularityScore ?? null,
  }
}

export default function MapPage() {
  const dispatch = useDispatch()
  const trips = useSelector(selectTrips)
  const currentTrip = useSelector(selectCurrentTrip)
  const currentUser = useSelector(selectUser)

  const [selectedTripId, setSelectedTripId] = useState('')
  const [activeDay, setActiveDay] = useState(0)
  const [activeTab, setActiveTab] = useState('Hotel')
  const [activePanel, setActivePanel] = useState('itinerary') // 'itinerary' | 'explore'

  // Mapbox initialization
  const { mapRef, mapContainerRef, map, userLocation, setUserLocation, mapLoaded, requestLocation, mapError } = useMapbox({
    style: 'mapbox://styles/mapbox/dark-v11', // Default Dark palette
    zoom: 4,
  })

  // Local exploration states
  const [entities, setEntities] = useState({ hotels: [], restaurants: [], attractions: [] })
  const [activeLayers, setActiveLayers] = useState(LAYER_DEFAULTS)
  const [selectedEntity, setSelectedEntity] = useState(null)
  const [loadingExploration, setLoadingExploration] = useState(false)
  const [errors, setErrors] = useState({ hotels: null, restaurants: null, attractions: null })
  const [radius, setRadius] = useState(20)

  // Geocoding states
  const [searchQuery, setSearchQuery] = useState('')
  const [searchingCity, setSearchingCity] = useState(false)
  const [searchError, setSearchError] = useState(null)

  // Weather state
  const [weatherForecast, setWeatherForecast] = useState(null)
  const [loadingWeather, setLoadingWeather] = useState(false)

  // Mobile drawer collapse state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024)

  // Quick Action dropdowns
  const [addingToStop, setAddingToStop] = useState(null)

  // Listen to window size
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Load all user trips on mount
  useEffect(() => {
    dispatch(fetchMyTrips({ page: 1, limit: 100 }))
    return () => {
      dispatch(clearCurrentTrip())
    }
  }, [dispatch])

  // Sync geolocated/searched center on map loads and layout transitions
  useEffect(() => {
    if (map) {
      map.resize()
      const timer = setTimeout(() => {
        map.resize()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [map, mapLoaded, activePanel, currentTrip])

  // Fetch weather forecast when trip or geocode coords change
  const fetchWeather = useCallback(async (destination, lat, lon) => {
    setLoadingWeather(true)
    try {
      const res = await api.get('/api/v1/weather/forecast', { params: { city: destination, lat, lon } })
      if (res.data?.success && res.data?.data) {
        setWeatherForecast(res.data.data)
      } else {
        setWeatherForecast(null)
      }
    } catch {
      setWeatherForecast(null)
    } finally {
      setLoadingWeather(false)
    }
  }, [])

  // Handle active trip selection
  const handleSelectTrip = useCallback((tripId) => {
    setSelectedTripId(tripId)
    setActiveDay(0)
    setWeatherForecast(null)
    if (tripId) {
      dispatch(fetchTrip(tripId))
    } else {
      dispatch(clearCurrentTrip())
    }
  }, [dispatch])

  // Standardize active day activities list
  const getActivitiesForDay = useCallback((trip, dayIdx) => {
    if (!trip) return []
    const isCustomized = trip.itinerary && trip.itinerary.length > 0
    if (isCustomized) {
      const dayItem = trip.itinerary.find(d => d.day === dayIdx + 1)
      if (!dayItem || !dayItem.activities) return []
      return dayItem.activities.map((act, idx) => ({
        _id: act._id || `act-${idx}`,
        name: act.name,
        notes: act.notes || '',
        cost: act.cost || 0,
        startTime: act.startTime || null,
        targetType: act.targetType || 'Custom',
        coordinates: act.coordinates || (act.targetId?.location?.coordinates ? {
          lat: act.targetId.location.coordinates[1],
          lon: act.targetId.location.coordinates[0]
        } : null)
      }))
    } else {
      const dayItem = trip.planData?.itinerary?.[dayIdx]
      if (!dayItem) return []
      const list = []
      ;['morning', 'afternoon', 'evening'].forEach(slot => {
        if (dayItem[slot]?.activities) {
          dayItem[slot].activities.forEach(act => {
            list.push({
              _id: act.name,
              name: act.name,
              notes: act.description || '',
              cost: act.cost || 0,
              slot: slot,
              targetType: 'Attraction',
              coordinates: act.coordinates ? {
                lat: Number(act.coordinates.lat),
                lon: Number(act.coordinates.lon)
              } : null
            })
          })
        }
      })
      return list
    }
  }, [])

  const activeActivities = currentTrip ? getActivitiesForDay(currentTrip, activeDay) : []

  // Extract coordinates for current active day itinerary stops
  const routeCoords = activeActivities
    .map(act => act.coordinates ? [act.coordinates.lon, act.coordinates.lat] : null)
    .filter(Boolean)

  // Fit map viewport to route bounds or fallback geolocations
  useEffect(() => {
    if (!map || !mapLoaded) return

    if (routeCoords.length > 0) {
      if (routeCoords.length === 1) {
        map.easeTo({
          center: routeCoords[0],
          zoom: 13,
          duration: 800
        })
      } else {
        const bounds = new mapboxgl.LngLatBounds()
        routeCoords.forEach(coord => bounds.extend(coord))
        map.fitBounds(bounds, {
          padding: isMobile 
            ? { top: 40, bottom: 180, left: 40, right: 40 } 
            : { top: 60, bottom: 60, left: 60, right: 420 },
          maxZoom: 14,
          duration: 800
        })
      }

      // Fetch weather based on first stop coordinates
      const firstStop = routeCoords[0]
      if (currentTrip && firstStop) {
        fetchWeather(currentTrip.destination, firstStop[1], firstStop[0])
      }
    } else if (currentTrip?.destination) {
      // Fallback destination coordinates geocoding
      const dest = currentTrip.destination.toLowerCase()
      const coordsMap = {
        goa: [73.818, 15.2993],
        mumbai: [72.8777, 19.076],
        delhi: [77.1025, 28.7041],
        kolkata: [88.3639, 22.5726],
        bangalore: [77.5946, 12.9716],
        chennai: [80.2707, 13.0827],
        hyderabad: [78.4867, 17.3850],
        jaipur: [75.7873, 26.9124],
        agra: [78.0081, 27.1767],
        kyoto: [135.7681, 35.0116],
        tokyo: [139.6503, 35.6762],
        singapore: [103.8519, 1.29025],
        dubai: [55.2708, 25.2048],
        bali: [115.1889, -8.4095],
        paris: [2.3522, 48.8566],
        london: [-0.1278, 51.5074],
        newyork: [-74.006, 40.7128],
        manali: [77.1887, 32.2396],
        kerala: [76.2711, 9.9312],
      }

      let center = [78.9629, 20.5937]
      let zoom = 4
      Object.keys(coordsMap).forEach(key => {
        if (dest.includes(key)) {
          center = coordsMap[key]
          zoom = 11
        }
      })

      map.easeTo({
        center: center,
        zoom: zoom,
        duration: 800
      })
      setUserLocation(center)
      fetchWeather(currentTrip.destination, center[1], center[0])
    }
  }, [map, mapLoaded, activeDay, selectedTripId, currentTrip?.destination])

  // Geocode Search City
  const handleSearchCity = async (e) => {
    if (e) e.preventDefault()
    if (!searchQuery.trim()) return
    setSearchingCity(true)
    setSearchError(null)
    try {
      const res = await api.get('/api/v1/travel/attractions/geocode', {
        params: { q: searchQuery.trim() }
      })
      if (res.data?.success && res.data?.data) {
        const { lat, lon } = res.data.data
        setUserLocation([lon, lat])
        fetchWeather(searchQuery.trim(), lat, lon)
        if (map) {
          map.flyTo({ center: [lon, lat], zoom: 12, speed: 1.5 })
        }
      } else {
        setSearchError('City not found')
      }
    } catch (err) {
      setSearchError(err.response?.data?.message || 'Could not find city')
    } finally {
      setSearchingCity(false)
    }
  }

  // Fetch nearby POIs based on search center / userLocation
  const fetchIdRef = useRef(0)
  useEffect(() => {
    if (!userLocation) return

    const [lng, lat] = userLocation
    const radiusM = radius * 1000
    const fetchId = ++fetchIdRef.current

    const fetchActiveEntities = async () => {
      setLoadingExploration(true)
      const promises = []

      if (activeLayers.Hotel) {
        promises.push(
          api.get(`/api/v1/hotels/nearby`, { params: { lat, lon: lng, radius: radiusM, limit: 15 } })
            .then(res => ({ type: 'hotels', success: true, data: res.data?.data?.hotels || [] }))
            .catch(err => ({ type: 'hotels', success: false, error: err.response?.data?.message || 'Hotels unavailable' }))
        )
      } else {
        setEntities(prev => ({ ...prev, hotels: [] }))
        setErrors(prev => ({ ...prev, hotels: null }))
      }

      if (activeLayers.Restaurant) {
        promises.push(
          api.get(`/api/v1/restaurants/nearby`, { params: { lat, lon: lng, radius: radiusM, limit: 15 } })
            .then(res => ({ type: 'restaurants', success: true, data: res.data?.data?.restaurants || [] }))
            .catch(err => ({ type: 'restaurants', success: false, error: err.response?.data?.message || 'Restaurants unavailable' }))
        )
      } else {
        setEntities(prev => ({ ...prev, restaurants: [] }))
        setErrors(prev => ({ ...prev, restaurants: null }))
      }

      if (activeLayers.Attraction) {
        promises.push(
          api.get(`/api/v1/attractions/nearby`, { params: { lat, lon: lng, radius: radiusM, limit: 15 } })
            .then(res => ({ type: 'attractions', success: true, data: res.data?.data?.attractions || [] }))
            .catch(err => ({ type: 'attractions', success: false, error: err.response?.data?.message || 'Attractions unavailable' }))
        )
      } else {
        setEntities(prev => ({ ...prev, attractions: [] }))
        setErrors(prev => ({ ...prev, attractions: null }))
      }

      if (promises.length === 0) {
        setLoadingExploration(false)
        return
      }

      const results = await Promise.all(promises)

      if (fetchId !== fetchIdRef.current) return // Stale request

      setEntities(prev => {
        const next = { ...prev }
        results.forEach(res => {
          if (res.success) {
            if (res.type === 'hotels') next.hotels = res.data.map(normaliseHotel).filter(Boolean)
            if (res.type === 'restaurants') next.restaurants = res.data.map(normaliseRestaurant).filter(Boolean)
            if (res.type === 'attractions') next.attractions = res.data.map(normaliseAttraction).filter(Boolean)
          } else {
            if (res.type === 'hotels') next.hotels = []
            if (res.type === 'restaurants') next.restaurants = []
            if (res.type === 'attractions') next.attractions = []
          }
        })
        return next
      })

      setErrors(prev => {
        const next = { ...prev }
        results.forEach(res => {
          if (!res.success) {
            if (res.type === 'hotels') next.hotels = res.error
            if (res.type === 'restaurants') next.restaurants = res.error
            if (res.type === 'attractions') next.attractions = res.error
          } else {
            if (res.type === 'hotels') next.hotels = null
            if (res.type === 'restaurants') next.restaurants = null
            if (res.type === 'attractions') next.attractions = null
          }
        })
        return next
      })

      setLoadingExploration(false)
    }

    fetchActiveEntities()
  }, [userLocation, radius, activeLayers.Hotel, activeLayers.Restaurant, activeLayers.Attraction])

  const toggleLayer = (type) => {
    setActiveLayers(prev => ({ ...prev, [type]: !prev[type] }))
  }

  const handleMarkerClick = useCallback((entity) => {
    setSelectedEntity(entity)
  }, [])

  const handleClosePopup = useCallback(() => {
    setSelectedEntity(null)
  }, [])

  const focusOnEntity = useCallback((entity) => {
    setSelectedEntity(entity)
    const coords = entity.location?.coordinates
    if (coords && map) {
      map.flyTo({
        center: coords,
        zoom: 14,
        essential: true
      })
    }
  }, [map])

  // Custom addition of POI to active trip itinerary
  const handleAddPlaceToTrip = async (entity, dayNum, slotKey) => {
    if (!currentTrip) return
    
    const isCustomized = currentTrip.itinerary && currentTrip.itinerary.length > 0
    let targetTrip = { ...currentTrip }

    try {
      setLoadingExploration(true)

      // Initialize itinerary database schema if still in static planData
      if (!isCustomized) {
        const plan = currentTrip.planData
        const converted = plan.itinerary.map(d => {
          const dayActivities = []
          ;['morning', 'afternoon', 'evening'].forEach(slot => {
            if (d[slot]?.activities) {
              d[slot].activities.forEach(act => {
                dayActivities.push({
                  targetType: 'Custom',
                  name: act.name,
                  notes: act.description || '',
                  cost: act.cost || 0,
                  coordinates: act.coordinates ? {
                    lat: Number(act.coordinates.lat),
                    lon: Number(act.coordinates.lon)
                  } : null
                })
              })
            }
          })
          return {
            day: d.day,
            date: currentTrip.startDate ? new Date(new Date(currentTrip.startDate).getTime() + (d.day - 1) * 24 * 60 * 60 * 1000) : new Date(),
            activities: dayActivities
          }
        })
        const initRes = await api.put(`/api/v1/trips/${currentTrip._id}/itinerary`, { itinerary: converted })
        targetTrip = initRes.data.data
      }

      // Add the chosen POI stop to the target day
      const targetDayNum = dayNum + 1
      const dayEntry = targetTrip.itinerary.find(d => d.day === targetDayNum)
      if (!dayEntry) return

      const newActivity = {
        targetType: entity._entityType === 'Hotel' ? 'Hotel' : entity._entityType === 'Restaurant' ? 'Restaurant' : 'Attraction',
        targetId: entity._id,
        name: entity.name,
        notes: entity.address || entity.city || '',
        cost: 0,
        startTime: slotKey === 'morning' 
          ? new Date(new Date().setHours(9, 0, 0)) 
          : slotKey === 'afternoon' 
            ? new Date(new Date().setHours(13, 0, 0)) 
            : new Date(new Date().setHours(18, 0, 0)),
        coordinates: {
          lat: entity.location.coordinates[1],
          lon: entity.location.coordinates[0]
        }
      }

      const updatedActivities = [...(dayEntry.activities || []), newActivity]
      const saveRes = await api.put(`/api/v1/trips/${currentTrip._id}/itinerary/day/${targetDayNum}`, { activities: updatedActivities })
      
      // Update local Redux store
      dispatch(fetchTrip(currentTrip._id))
      setAddingToStop(null)
      setSelectedEntity(null)

      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { type: 'success', message: `${entity.name} added to Day ${targetDayNum}!` } 
      }))
    } catch (err) {
      console.error(err)
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { type: 'error', message: 'Failed to add place to trip itinerary.' } 
      }))
    } finally {
      setLoadingExploration(false)
    }
  }

  // Delete activity from trip itinerary day
  const handleDeleteActivity = async (dayNum, actIdx) => {
    if (!currentTrip) return
    const dayEntry = currentTrip.itinerary?.find(d => d.day === dayNum)
    if (!dayEntry) return

    const updatedActivities = dayEntry.activities.filter((_, idx) => idx !== actIdx)
    try {
      setLoadingExploration(true)
      await api.put(`/api/v1/trips/${currentTrip._id}/itinerary/day/${dayNum}`, { activities: updatedActivities })
      dispatch(fetchTrip(currentTrip._id))
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { type: 'success', message: 'Activity removed from itinerary!' } 
      }))
    } catch {
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { type: 'error', message: 'Failed to remove activity.' } 
      }))
    } finally {
      setLoadingExploration(false)
    }
  }

  // Calculate live budget stats locally
  const totalDays = currentTrip 
    ? (currentTrip.planData?.meta?.total_days || Math.ceil((new Date(currentTrip.endDate) - new Date(currentTrip.startDate)) / (1000 * 60 * 60 * 24)) + 1 || 1) 
    : 1

  const localSelectionsCost = currentTrip ? (() => {
    const opts = currentTrip.selectedOptions || {}
    const transport = opts.transport?.total_cost || currentTrip.planData?.transport_options?.[0]?.total_cost || 0
    const hotel = (opts.hotel?.price_per_night || 0) * totalDays
    const food = opts.food?.total_cost || 0
    
    // Sum active itinerary costs
    let itineraryCost = 0
    if (currentTrip.itinerary && currentTrip.itinerary.length > 0) {
      currentTrip.itinerary.forEach(d => {
        d.activities?.forEach(act => {
          itineraryCost += (act.cost || 0)
        })
      })
    } else if (currentTrip.planData?.itinerary) {
      currentTrip.planData.itinerary.forEach(d => {
        ;['morning', 'afternoon', 'evening'].forEach(slot => {
          d[slot]?.activities?.forEach(act => {
            itineraryCost += (act.cost || 0)
          })
        })
      })
    }
    return transport + hotel + food + itineraryCost
  })() : 0

  const budgetRatio = currentTrip ? (localSelectionsCost / currentTrip.budget) : 0
  const budgetColorClass = budgetRatio <= 0.8 
    ? 'bg-emerald-500' 
    : budgetRatio <= 1.0 
      ? 'bg-amber-500' 
      : 'bg-rose-500'

  const allMarkers = [
    ...(activeLayers.Hotel ? entities.hotels || [] : []),
    ...(activeLayers.Restaurant ? entities.restaurants || [] : []),
    ...(activeLayers.Attraction ? entities.attractions || [] : []),
  ]

  const activeList = activeTab === 'Hotel'
    ? entities.hotels
    : activeTab === 'Restaurant'
      ? entities.restaurants
      : entities.attractions

  // Map Controls Styles
  const changeMapStyle = (styleUrl) => {
    if (map) {
      map.setStyle(styleUrl)
    }
  }

  return (
    <div className="flex flex-col lg:flex-row w-full overflow-hidden bg-surface-base text-text-primary" style={{ height: 'calc(100vh - 64px)' }}>
      
      {/* ── Interactive Map Canvas Container (Left/Middle) ── */}
      <div className="flex-1 h-full min-w-0 flex flex-col relative overflow-hidden">
        
        {/* Floating Mobile Top Selector Header */}
        {isMobile && (
          <div className="absolute top-4 left-4 right-4 z-20 flex gap-2 shrink-0 bg-surface-glass border border-border backdrop-blur-md p-3.5 rounded-2xl shadow-lg">
            <select
              value={selectedTripId}
              onChange={e => handleSelectTrip(e.target.value)}
              className="flex-1 bg-surface-raised border border-border rounded-xl text-text-primary font-sans text-xs px-3.5 py-2 outline-none cursor-pointer appearance-none"
            >
              <option value="">-- Choose a Trip --</option>
              {trips.map(trip => (
                <option key={trip._id} value={trip._id}>✈️ {trip.destination}</option>
              ))}
            </select>
            
            {selectedTripId && (
              <button
                onClick={() => setDrawerOpen(true)}
                className="bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-[0_2px_8px_rgba(99,102,241,0.4)] cursor-pointer whitespace-nowrap"
              >
                Show Steps ({activeActivities.length})
              </button>
            )}
          </div>
        )}

        {/* Mapbox Canvas */}
        <div className="w-full h-full relative">
          {mapError && (
            <div className="absolute inset-0 bg-red-950/20 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-50 gap-2">
              <span className="text-2xl">⚠</span>
              <p className="text-xs font-bold text-red-400">{mapError}</p>
              <p className="text-[10px] text-text-muted">Please check your internet connection or browser settings.</p>
            </div>
          )}

          <MapContainer ref={mapContainerRef} className="h-full w-full">
            
            {/* Sequence markers for current active itinerary day */}
            {map && mapLoaded && routeCoords.map((coord, idx) => (
              <MapMarker
                key={`stop-${idx}`}
                map={map}
                coordinates={coord}
                type="Attraction"
                data={{
                  name: `${idx + 1}. ${activeActivities[idx].name}`,
                  _entityType: 'Attraction',
                  address: activeActivities[idx].notes,
                  city: currentTrip?.destination || '',
                  location: { coordinates: coord }
                }}
                onClick={handleMarkerClick}
              />
            ))}

            {/* Exploratory nearby pins */}
            {map && mapLoaded && allMarkers.map((entity) => {
              const [lng, lat] = entity.location?.coordinates || []
              if (!lng || !lat) return null
              
              // Skip if there's an itinerary stop matching coordinates to prevent duplicate pin overlap
              const match = routeCoords.some(c => Math.abs(c[0] - lng) < 0.0001 && Math.abs(c[1] - lat) < 0.0001)
              if (match) return null

              return (
                <MapMarker
                  key={entity._id}
                  map={map}
                  coordinates={[lng, lat]}
                  type={entity._entityType}
                  data={entity}
                  onClick={handleMarkerClick}
                />
              )
            })}

            {/* Current Selected popup */}
            {map && mapLoaded && selectedEntity && (
              <MapPopup
                map={map}
                entity={selectedEntity}
                onClose={handleClosePopup}
              />
            )}

            {/* Route layer connecting the current day's stops sequentially */}
            {map && mapLoaded && routeCoords.length >= 2 && (
              <RouteLayer
                mapRef={mapRef}
                mapLoaded={mapLoaded}
                coordinates={routeCoords}
                color="var(--color-indigo-400)"
              />
            )}

          </MapContainer>
        </div>

        {/* Floating Custom Map Controls */}
        <div className={`absolute bottom-4 left-4 z-20 flex flex-col gap-2 shrink-0 ${isMobile ? 'bottom-20' : ''}`}>
          
          {/* Style Toggles */}
          <div className="flex flex-col bg-surface-glass border border-border backdrop-blur-md p-1.5 rounded-xl shadow-lg gap-1.5">
            <button
              onClick={() => changeMapStyle('mapbox://styles/mapbox/dark-v11')}
              className="p-2 hover:bg-surface-hover rounded-lg transition-colors text-text-primary"
              title="Dark Mode Map"
            >
              🌑
            </button>
            <button
              onClick={() => changeMapStyle('mapbox://styles/mapbox/streets-v12')}
              className="p-2 hover:bg-surface-hover rounded-lg transition-colors text-text-primary"
              title="Streets Mode Map"
            >
              🗺️
            </button>
            <button
              onClick={() => changeMapStyle('mapbox://styles/mapbox/satellite-v9')}
              className="p-2 hover:bg-surface-hover rounded-lg transition-colors text-text-primary"
              title="Satellite Mode Map"
            >
              🛰️
            </button>
          </div>

          {/* User Locate Trigger */}
          <button
            id="btn-locate-me"
            onClick={requestLocation}
            className="flex items-center justify-center p-3 bg-surface-glass border border-border backdrop-blur-md text-text-primary rounded-xl shadow-lg hover:bg-surface-hover hover:border-border-interactive transition-all"
            title="Locate Me"
          >
            📍
          </button>
        </div>

      </div>

      {/* ── Desktop Split Right Panel / Mobile Bottom Sheet ── */}
      <AnimatePresence>
        {(!isMobile || drawerOpen) && (
          <motion.aside
            initial={isMobile ? { y: '100%' } : { x: 380, opacity: 0 }}
            animate={isMobile ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={isMobile ? { y: '100%' } : { x: 380, opacity: 0 }}
            transition={{ type: 'tween', ease: 'easeInOut', duration: 0.25 }}
            className={`
              z-30 flex flex-col bg-surface-glass border-border backdrop-blur-md overflow-hidden shrink-0 shadow-lg
              ${isMobile 
                ? 'fixed inset-x-0 bottom-0 rounded-t-2xl border-t h-[75vh]' 
                : 'w-[380px] border-l h-full'
              }
            `}
          >
            {/* Mobile Swipe Drawer Drag Indicator */}
            {isMobile && (
              <div 
                className="w-full flex justify-center py-3 cursor-pointer shrink-0 border-b border-border-subtle"
                onClick={() => setDrawerOpen(false)}
              >
                <div className="w-12 h-1.5 bg-border rounded-full" />
              </div>
            )}

            {/* Selector & Geocoder Header */}
            <div className="p-4 border-b border-border flex flex-col gap-3 shrink-0">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-extrabold tracking-tight font-display text-text-primary">
                  Spatial <span className="text-indigo-400">Workspace</span>
                </h1>
                
                {isMobile && (
                  <button 
                    onClick={() => setDrawerOpen(false)}
                    className="text-xs text-text-muted hover:text-text-primary transition-colors px-2 py-1 bg-surface-hover rounded-lg"
                  >
                    Hide Map
                  </button>
                )}
              </div>

              {/* Select Active Trip Dropdown */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Active Trip</label>
                <div className="relative">
                  <select
                    id="select-trip-dropdown"
                    value={selectedTripId}
                    onChange={e => handleSelectTrip(e.target.value)}
                    className="w-full bg-surface-raised border border-border rounded-xl text-text-primary font-sans text-xs px-3.5 py-2.5 outline-none transition-all focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.2)] appearance-none cursor-pointer"
                  >
                    <option value="">-- Choose a Trip --</option>
                    {trips.map(trip => (
                      <option key={trip._id} value={trip._id}>
                        ✈️ {trip.destination} ({trip.planData?.meta?.total_days || 'AI Plan'} Days)
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" size={14} />
                </div>
              </div>

              {/* Mode Tabs: Itinerary vs Exploration */}
              <div className="flex bg-surface-default border border-border p-0.5 rounded-xl text-xs font-semibold gap-0.5">
                <button
                  id="tab-itinerary"
                  onClick={() => setActivePanel('itinerary')}
                  className={`flex-1 py-1.5 rounded-lg text-center transition-colors cursor-pointer ${activePanel === 'itinerary' ? 'bg-surface-raised text-text-primary border border-border/30' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  📍 Itinerary Stops
                </button>
                <button
                  id="tab-explore"
                  onClick={() => setActivePanel('explore')}
                  className={`flex-1 py-1.5 rounded-lg text-center transition-colors cursor-pointer ${activePanel === 'explore' ? 'bg-surface-raised text-text-primary border border-border/30' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  🔍 Nearby POI Search
                </button>
              </div>
            </div>

            {/* Sidebar Scrollable Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
              
              {/* ── TAB 1: ITINERARY PANEL ── */}
              {activePanel === 'itinerary' && (
                <>
                  {!currentTrip ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center text-text-muted gap-3">
                      <div className="w-12 h-12 bg-surface-default rounded-full flex items-center justify-center border border-border/40">
                        <MapIcon size={20} className="text-text-muted" />
                      </div>
                      <p className="text-xs font-medium max-w-[240px]">Please select a trip from the dropdown above to load your spatial itinerary legs.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4 animate-fadeIn">
                      
                      {/* Trip Meta Information */}
                      <div className="p-3 bg-surface-default border border-border rounded-xl flex flex-col gap-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-extrabold text-sm text-text-primary font-display">{currentTrip.destination}</h3>
                            <p className="text-[10px] text-text-muted mt-0.5">
                              from {currentTrip.source} • {totalDays} Days • {currentTrip.groupType}
                            </p>
                          </div>
                          
                          <Link 
                            to={`/trips/${currentTrip._id}`} 
                            className="text-text-link hover:text-text-link-hover text-[10px] font-bold flex items-center gap-0.5 transition-colors"
                          >
                            Details <ExternalLink size={10} />
                          </Link>
                        </div>

                        {/* Live Budget Counter */}
                        <div className="mt-1 flex flex-col gap-1">
                          <div className="flex justify-between text-[10px] font-semibold">
                            <span className="text-text-secondary">Spend Progress</span>
                            <span className={budgetRatio > 1.0 ? 'text-rose-400 font-bold animate-pulse' : 'text-text-primary'}>
                              ₹{localSelectionsCost.toLocaleString()} / ₹{Number(currentTrip.budget).toLocaleString()}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-surface-raised rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all duration-300 ${budgetColorClass}`} 
                              style={{ width: `${Math.min(100, budgetRatio * 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Weather Forecast Preview */}
                        {loadingWeather ? (
                          <div className="mt-1 flex items-center justify-center gap-2 py-1.5 bg-surface-raised rounded-lg">
                            <div className="animate-spin rounded-full h-3 w-3 border border-border border-t-indigo-400" />
                            <span className="text-[10px] text-text-muted">Loading weather...</span>
                          </div>
                        ) : weatherForecast ? (
                          <div className="mt-1.5 p-2 bg-surface-raised border border-border/20 rounded-lg flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-2">
                              {weatherForecast.forecast?.[0]?.condition?.toLowerCase().includes('rain') ? (
                                <CloudRain size={14} className="text-indigo-300" />
                              ) : weatherForecast.forecast?.[0]?.condition?.toLowerCase().includes('cloud') ? (
                                <Cloud size={14} className="text-sky-300" />
                              ) : (
                                <Sun size={14} className="text-amber-400 animate-pulse-slow" />
                              )}
                              <div>
                                <span className="font-bold text-text-primary">
                                  {weatherForecast.forecast?.[0]?.temp ?? weatherForecast.temp ?? '—'}°C
                                </span>
                                <span className="text-text-secondary ml-1.5 capitalize text-[10px]">
                                  {weatherForecast.forecast?.[0]?.condition ?? 'Sunny'}
                                </span>
                              </div>
                            </div>
                            <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Live Forecast</span>
                          </div>
                        ) : null}
                      </div>

                      {/* Day Tab Switcher */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Itinerary Day</label>
                        <div className="flex gap-1 overflow-x-auto pb-1 custom-scrollbar shrink-0 max-w-full">
                          {Array.from({ length: totalDays }).map((_, idx) => (
                            <button
                              key={idx}
                              id={`day-tab-${idx}`}
                              onClick={() => setActiveDay(idx)}
                              className={`
                                text-[10px] font-bold px-3 py-1.5 rounded-lg cursor-pointer whitespace-nowrap transition-colors border
                                ${activeDay === idx 
                                  ? 'bg-indigo-600 text-white border-transparent shadow-[0_2px_8px_rgba(99,102,241,0.3)]' 
                                  : 'bg-surface-raised border-border text-text-secondary hover:text-text-primary'
                                }
                              `}
                            >
                              Day {idx + 1}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Stop Sequence List */}
                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Scheduled Stops</label>
                          <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/10">
                            {activeActivities.length} Stops
                          </span>
                        </div>

                        <div className="flex flex-col gap-2">
                          {activeActivities.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-6 border border-dashed border-border rounded-xl bg-surface-default text-center text-text-muted gap-2">
                              <Compass size={18} className="text-text-muted/60 animate-pulse" />
                              <p className="text-[10px] font-medium max-w-[200px]">No stops scheduled for Day {activeDay + 1}.</p>
                              <button 
                                onClick={() => setActivePanel('explore')}
                                className="text-[10px] font-bold text-indigo-400 hover:underline cursor-pointer"
                              >
                                Search nearby places →
                              </button>
                            </div>
                          ) : (
                            activeActivities.map((act, index) => {
                              const timeStr = act.startTime 
                                ? new Date(act.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                                : act.slot 
                                  ? act.slot.toUpperCase() 
                                  : `STOP ${index + 1}`

                              return (
                                <div
                                  key={act._id || index}
                                  onClick={() => act.coordinates && focusOnEntity({
                                    location: { coordinates: [act.coordinates.lon, act.coordinates.lat] },
                                    name: act.name,
                                    address: act.notes,
                                    _entityType: act.targetType
                                  })}
                                  className="flex gap-3 p-3 rounded-xl border border-border bg-surface-default hover:bg-surface-hover hover:border-border-interactive transition-all cursor-pointer group"
                                >
                                  {/* Stop Index Indicator */}
                                  <div className="w-6 h-6 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-extrabold flex items-center justify-center shrink-0">
                                    {index + 1}
                                  </div>
                                  
                                  {/* Stop Info */}
                                  <div className="flex-1 min-w-0 flex flex-col gap-0.5 justify-center">
                                    <div className="flex justify-between items-start gap-1">
                                      <h4 className="font-bold text-xs text-text-primary truncate">{act.name}</h4>
                                      <span className="text-[9px] font-bold text-indigo-400 shrink-0 uppercase tracking-wide bg-indigo-500/5 px-1.5 py-0.5 rounded">
                                        {timeStr}
                                      </span>
                                    </div>
                                    {act.notes && (
                                      <p className="text-[10px] text-text-muted truncate">{act.notes}</p>
                                    )}
                                    {act.cost > 0 && (
                                      <p className="text-[10px] text-emerald-400 font-bold mt-0.5">₹{act.cost.toLocaleString()}</p>
                                    )}
                                  </div>

                                  {/* Delete Trigger */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDeleteActivity(activeDay + 1, index)
                                    }}
                                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-rose-400 transition-opacity p-1.5 shrink-0 self-center"
                                    title="Remove Stop"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>

                    </div>
                  )}
                </>
              )}

              {/* ── TAB 2: EXPLORATION PANEL ── */}
              {activePanel === 'explore' && (
                <div className="flex flex-col gap-4 animate-fadeIn">
                  
                  {/* City Search Geocoder input */}
                  <form onSubmit={handleSearchCity} className="relative flex items-center">
                    <input
                      type="text"
                      placeholder="Search city (e.g. London, Tokyo...)"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full bg-surface-raised border border-border rounded-xl text-text-primary font-sans text-xs px-4 py-2.5 outline-none transition-all duration-150 focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.2)]"
                    />
                    <button
                      type="submit"
                      disabled={searchingCity}
                      className="absolute right-3 text-text-secondary hover:text-text-primary disabled:opacity-50 cursor-pointer text-sm"
                    >
                      {searchingCity ? '⌛' : '🔍'}
                    </button>
                  </form>
                  {searchError && (
                    <div className="text-[10px] text-rose-400 font-semibold mt-[-0.5rem] flex items-center gap-1">
                      <AlertCircle size={10} /> {searchError}
                    </div>
                  )}

                  {/* Layers settings */}
                  <div className="flex flex-col gap-2.5">
                    <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">POI Layers</label>
                    <div className="flex flex-col gap-1.5">
                      {[
                        { key: 'Hotel', emoji: '🏨', label: 'Hotels', color: 'border-indigo-500/30 text-indigo-400 bg-indigo-500/5', errorKey: 'hotels' },
                        { key: 'Restaurant', emoji: '🍽️', label: 'Dining', color: 'border-amber-500/30 text-amber-400 bg-amber-500/5', errorKey: 'restaurants' },
                        { key: 'Attraction', emoji: '🎯', label: 'Sights', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5', errorKey: 'attractions' },
                      ].map(({ key, emoji, label, color, errorKey }) => {
                        const active = activeLayers[key]
                        const layerError = errors[errorKey]
                        return (
                          <div key={key} className="flex flex-col">
                            <button
                              id={`toggle-${key.toLowerCase()}`}
                              onClick={() => toggleLayer(key)}
                              className={`
                                flex items-center justify-between w-full px-3 py-2 border rounded-xl font-sans text-xs font-semibold cursor-pointer transition-all duration-150
                                ${active 
                                  ? `${color} border-interactive shadow-sm` 
                                  : 'bg-surface-raised border-border text-text-secondary hover:text-text-primary'
                                }
                              `}
                            >
                              <span className="flex items-center gap-2">
                                <span>{emoji}</span> {label}
                              </span>
                              <span className="text-[10px] text-text-muted">
                                ({entities[errorKey]?.length || 0})
                              </span>
                            </button>
                            {layerError && (
                              <p className="text-[9px] text-rose-400 mt-1 pl-2">⚠ {layerError}</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Radius slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-[10px] font-semibold text-text-secondary">
                      <span>Search Radius</span>
                      <span>{radius} km</span>
                    </div>
                    <input
                      id="range-radius"
                      type="range" min="5" max="50" step="5"
                      value={radius}
                      onChange={e => setRadius(Number(e.target.value))}
                      className="w-full h-1 bg-surface-raised rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  {/* Exploration search Spinner */}
                  {loadingExploration && (
                    <div className="flex justify-center items-center gap-2 py-3">
                      <div className="animate-spin rounded-full h-4.5 w-4.5 border-2 border-border border-t-indigo-500" />
                      <span className="text-[11px] text-text-muted">Scanning coordinates...</span>
                    </div>
                  )}

                  {/* Places Nearby lists */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Places Nearby</label>
                    <div className="flex border-b border-border text-[11px] gap-1 shrink-0">
                      {[
                        { key: 'Hotel', emoji: '🏨', label: 'Hotels' },
                        { key: 'Restaurant', emoji: '🍽️', label: 'Dining' },
                        { key: 'Attraction', emoji: '🎯', label: 'Sights' },
                      ].map(t => (
                        <button
                          key={t.key}
                          onClick={() => setActiveTab(t.key)}
                          className={`
                            flex-1 pb-2 font-bold cursor-pointer transition-colors text-center border-b-2
                            ${activeTab === t.key 
                              ? 'border-indigo-500 text-text-primary' 
                              : 'border-transparent text-text-muted hover:text-text-secondary'
                            }
                          `}
                        >
                          {t.emoji} {t.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-col gap-2.5 mt-2">
                      {activeList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 border border-dashed border-border rounded-xl bg-surface-default text-center text-text-muted gap-2">
                          <Compass size={18} className="text-text-muted/60" />
                          <p className="text-[10px] font-medium max-w-[200px]">No places found. Enable the POI check layer above or increase the radius.</p>
                        </div>
                      ) : (
                        activeList.map((item, index) => {
                          const isSelected = selectedEntity?._id === item._id
                          const isAdding = addingToStop === item._id

                          return (
                            <div
                              key={item._id || index}
                              onClick={() => focusOnEntity(item)}
                              className={`
                                flex flex-col p-2.5 rounded-xl border transition-all duration-200 cursor-pointer
                                ${isSelected 
                                  ? 'border-indigo-500/50 bg-indigo-500/10 shadow-[0_0_12px_rgba(99,102,241,0.15)]' 
                                  : 'border-border/40 hover:border-border hover:bg-surface-hover'
                                }
                              `}
                            >
                              <div className="flex gap-3">
                                {item.image ? (
                                  <img
                                    src={item.image}
                                    alt={item.name}
                                    className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                                    onError={(e) => {
                                      e.target.onerror = null;
                                      e.target.src = DEFAULT_IMAGES[item._entityType];
                                    }}
                                  />
                                ) : (
                                  <div className="w-14 h-14 rounded-lg bg-surface-raised flex items-center justify-center flex-shrink-0 text-lg border border-border/20">
                                    {item._entityType === 'Hotel' ? '🏨' : item._entityType === 'Restaurant' ? '🍽️' : '🎯'}
                                  </div>
                                )}
                                
                                <div className="flex-1 min-w-0 flex flex-col justify-between">
                                  <div>
                                    <h4 className="font-bold text-xs text-text-primary truncate">{item.name}</h4>
                                    <p className="text-[10px] text-text-muted truncate mt-0.5">
                                      {item.category && item.category !== item._entityType ? item.category : item._entityType}
                                      {item.distanceLabel ? ` • ${item.distanceLabel}` : ''}
                                    </p>
                                  </div>
                                  <div className="flex items-center justify-between mt-1">
                                    {item.averageRating > 0 ? (
                                      <span className="text-[10px] font-bold text-amber-400">★ {item.averageRating.toFixed(1)}</span>
                                    ) : (
                                      <span className="text-[9px] text-text-muted/40">No reviews</span>
                                    )}
                                    {item.isOpenNow !== null && (
                                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${item.isOpenNow ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                        {item.isOpenNow ? 'Open' : 'Closed'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Action: Add to Itinerary leg */}
                              {currentTrip && isSelected && (
                                <div className="mt-2.5 pt-2.5 border-t border-border-subtle flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
                                  {!isAdding ? (
                                    <button
                                      onClick={() => setAddingToStop(item._id)}
                                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-semibold text-[10px] py-1.5 rounded-lg transition-colors cursor-pointer text-center"
                                    >
                                      + Add to Trip Itinerary
                                    </button>
                                  ) : (
                                    <div className="flex flex-col gap-1.5 animate-fadeIn">
                                      <div className="flex justify-between items-center">
                                        <span className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Select Stop Schedule</span>
                                        <button 
                                          onClick={() => setAddingToStop(null)} 
                                          className="text-[9px] text-rose-400 hover:underline"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                      
                                      <div className="grid grid-cols-3 gap-1">
                                        {['morning', 'afternoon', 'evening'].map(slot => (
                                          <button
                                            key={slot}
                                            onClick={() => handleAddPlaceToTrip(item, activeDay, slot)}
                                            className="bg-surface-raised border border-border hover:border-indigo-500/40 text-[9px] font-bold py-1 rounded-lg text-center transition-colors capitalize text-text-primary"
                                          >
                                            {slot}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>

                </div>
              )}

            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}