// src/pages/Dashboard/Explore/index.jsx
// Aurora Design System — Explore Hub
// Real-time travel intelligence workspace. Integrates flight status search,
// weather conditions, and attraction/dining listings with Grid & Mapbox views.
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Plane, CloudRain, MapPin, Utensils, Search, 
  ArrowRight, Thermometer, Wind, Droplets, Calendar, 
  Map as MapIcon, Grid as GridIcon, Star, CheckCircle, Info, Navigation
} from 'lucide-react'
import { travelApi } from '@/services/travelApi'
import Input from '@/components/common/Input'
import Button from '@/components/common/Button'
import Loader from '@/components/common/Loader'
import Badge from '@/components/common/Badge'
import Card from '@/components/common/Card'
import { useMapbox } from '@/hooks/useMapbox'
import MapContainer from '@/components/map/MapContainer'
import MapMarker from '@/components/map/MapMarker'
import MapPopup from '@/components/map/MapPopup'

const TABS = [
  { id: 'flights', label: 'Flights', icon: Plane, color: 'var(--color-indigo-400)' },
  { id: 'weather', label: 'Weather', icon: CloudRain, color: 'var(--color-amber-400)' },
  { id: 'places', label: 'Attractions', icon: MapPin, color: 'var(--color-violet-500)' },
  { id: 'dining', label: 'Dining', icon: Utensils, color: 'var(--color-emerald-400)' },
]

const DEFAULT_IMAGES = {
  Hotel: 'https://placehold.co/400x400/111827/94a3b8?text=Hotel',
  Restaurant: 'https://placehold.co/400x400/111827/94a3b8?text=Restaurant',
  Attraction: 'https://placehold.co/400x400/111827/94a3b8?text=Attraction'
}

export default function Explore() {
  const [activeTab, setActiveTab] = useState('flights')
  
  return (
    <div className="animate-fadeIn max-w-[1200px] mx-auto pb-16 font-sans">
      
      {/* ── Page Header ── */}
      <div className="mb-8 border-b border-border pb-5">
        <h1 className="text-2xl font-extrabold tracking-tight font-display text-text-primary">
          Explore <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">Hub</span>
        </h1>
        <p className="text-xs text-text-muted mt-1">
          Search live flight schedules, current weather forecasts, local attractions, and dining venues
        </p>
      </div>

      {/* ── Premium Capsule Tabs Switcher ── */}
      <div className="flex gap-2.5 mb-6 overflow-x-auto pb-2 scrollbar-none border-b border-border/30">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              id={`tab-trigger-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-xs transition-all duration-200 cursor-pointer border ${
                isActive 
                  ? 'bg-indigo-500/10 text-text-primary border-indigo-500/30' 
                  : 'bg-surface-default hover:bg-surface-hover text-text-secondary border-border/40'
              }`}
            >
              <tab.icon size={14} style={{ color: isActive ? tab.color : 'inherit' }} />
              {tab.label}
              {isActive && (
                <motion.span 
                  layoutId="activeTabGlow"
                  className="absolute inset-0 rounded-full border border-indigo-400/50 shadow-[0_0_12px_rgba(99,102,241,0.25)] pointer-events-none"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* ── Active Content Area ── */}
      <Card variant="raised" padding="lg" className="min-h-[460px] bg-surface-glass border-border/60">
        <AnimatePresence mode="wait">
          {activeTab === 'flights' && <FlightsTab key="flights" />}
          {activeTab === 'weather' && <WeatherTab key="weather" />}
          {activeTab === 'places' && <PlacesTab key="places" type="attractions" />}
          {activeTab === 'dining' && <PlacesTab key="dining" type="restaurants" />}
        </AnimatePresence>
      </Card>
    </div>
  )
}

// ── SUGGESTIONS AUTOCOMPLETE DROPDOWN ──
const RECOMMEND_CITIES = [
  'Delhi', 'Mumbai', 'Bengaluru', 'Goa', 'Jaipur', 'Hyderabad',
  'Srinagar', 'Kochi', 'Varanasi', 'Chennai', 'Kolkata', 'Pune',
  'Ahmedabad', 'Udaipur', 'Agra', 'Amritsar', 'Dehradun', 'Shimla',
  'Dubai', 'Singapore', 'Bangkok', 'Tokyo', 'Bali', 'Maldives',
  'Kuala Lumpur', 'Hong Kong', 'Kathmandu', 'Colombo',
  'London', 'Paris', 'New York', 'Rome', 'Amsterdam', 'Barcelona',
  'Sydney', 'Melbourne', 'Toronto', 'Los Angeles', 'San Francisco'
]

function SuggestionsDropdown({ query, onSelect }) {
  const filtered = RECOMMEND_CITIES.filter(c =>
    c.toLowerCase().includes((query || '').toLowerCase())
  )

  if (filtered.length === 0) return null

  return (
    <Card 
      variant="raised" 
      padding="none" 
      className="absolute top-[105%] left-0 right-0 max-h-[220px] overflow-y-auto z-[99] border-border bg-surface-raised shadow-xl custom-scrollbar"
    >
      {filtered.map(c => (
        <button
          key={c}
          type="button"
          onMouseDown={() => onSelect(c)}
          className="w-full text-left px-4 py-2.5 text-xs text-text-primary hover:bg-surface-hover transition-colors border-b border-border/20 last:border-0 font-medium"
        >
          📍 {c}
        </button>
      ))}
    </Card>
  )
}

// ── FLIGHTS TAB VIEW ──
const CITY_IATA_MAP = {
  'delhi': 'DEL', 'new delhi': 'DEL', 'mumbai': 'BOM', 'bombay': 'BOM',
  'bangalore': 'BLR', 'bengaluru': 'BLR', 'hyderabad': 'HYD',
  'chennai': 'MAA', 'madras': 'MAA', 'kolkata': 'CCU', 'calcutta': 'CCU',
  'ahmedabad': 'AMD', 'pune': 'PNQ', 'jaipur': 'JAI', 'lucknow': 'LKO',
  'goa': 'GOI', 'kochi': 'COK', 'cochin': 'COK', 'thiruvananthapuram': 'TRV',
  'trivandrum': 'TRV', 'guwahati': 'GAU', 'patna': 'PAT', 'bhopal': 'BHO',
  'indore': 'IDR', 'nagpur': 'NAG', 'varanasi': 'VNS', 'chandigarh': 'IXC',
  'coimbatore': 'CJB', 'vizag': 'VTZ', 'visakhapatnam': 'VTZ',
  'srinagar': 'SXR', 'amritsar': 'ATQ', 'ranchi': 'IXR', 'raipur': 'RPR',
  'mangalore': 'IXE', 'udaipur': 'UDR', 'dehradun': 'DED', 'imphal': 'IMF',
  'agartala': 'IXA', 'bhubaneswar': 'BBI', 'jammu': 'IXJ', 'leh': 'IXL',
  'madurai': 'IXM', 'bagdogra': 'IXB', 'darjeeling': 'IXB', 'siliguri': 'IXB',
  'port blair': 'IXZ', 'andaman': 'IXZ',
  'london': 'LHR', 'paris': 'CDG', 'new york': 'JFK', 'los angeles': 'LAX',
  'tokyo': 'NRT', 'singapore': 'SIN', 'dubai': 'DXB', 'bangkok': 'BKK',
  'hong kong': 'HKG', 'sydney': 'SYD', 'san francisco': 'SFO',
  'chicago': 'ORD', 'toronto': 'YYZ', 'kuala lumpur': 'KUL', 'seoul': 'ICN',
  'istanbul': 'IST', 'rome': 'FCO', 'amsterdam': 'AMS', 'frankfurt': 'FRA',
  'barcelona': 'BCN', 'madrid': 'MAD', 'berlin': 'BER', 'zurich': 'ZRH',
  'doha': 'DOH', 'abu dhabi': 'AUH', 'kathmandu': 'KTM', 'colombo': 'CMB',
  'dhaka': 'DAC', 'male': 'MLE', 'maldives': 'MLE', 'beijing': 'PEK',
  'shanghai': 'PVG', 'moscow': 'SVO', 'cairo': 'CAI', 'nairobi': 'NBO',
  'johannesburg': 'JNB', 'cape town': 'CPT', 'melbourne': 'MEL',
  'auckland': 'AKL', 'bali': 'DPS', 'jakarta': 'CGK', 'manila': 'MNL',
  'hanoi': 'HAN', 'ho chi minh': 'SGN', 'saigon': 'SGN',
  'taipei': 'TPE', 'os大阪': 'KIX', 'osaka': 'KIX', 'lisbon': 'LIS', 'vienna': 'VIE',
  'munich': 'MUC', 'dublin': 'DUB', 'athens': 'ATH'
}

function FlightsTab() {
  const [form, setForm] = useState({ origin: '', destination: '', date: '', adults: 1, travelClass: 'ECONOMY' })
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [resolvedCodes, setResolvedCodes] = useState({ origin: null, destination: null })
  const [showOriginSuggest, setShowOriginSuggest] = useState(false)
  const [showDestSuggest, setShowDestSuggest] = useState(false)

  const resolveToIata = async (input) => {
    const trimmed = input.trim()
    if (/^[A-Za-z]{3}$/.test(trimmed)) {
      const upper = trimmed.toUpperCase()
      const mapped = CITY_IATA_MAP[trimmed.toLowerCase()]
      if (mapped) return mapped
      return upper
    }
    const mapped = CITY_IATA_MAP[trimmed.toLowerCase()]
    if (mapped) return mapped
    try {
      const res = await travelApi.searchAirportsByCity(trimmed, 5)
      const airports = res.data?.data?.airports
      if (airports && airports.length > 0) {
        const best = airports.find(a => a.iataCode && a.iataCode.length === 3) || airports[0]
        if (best?.iataCode) return best.iataCode
      }
    } catch { /* ignore */ }
    return null
  }

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!form.origin || !form.destination || !form.date) return
    setLoading(true)
    setError(null)
    setResults(null)
    setResolvedCodes({ origin: null, destination: null })
    try {
      const [depIata, arrIata] = await Promise.all([
        resolveToIata(form.origin),
        resolveToIata(form.destination),
      ])
      if (!depIata) { 
        setError(`Origin city "${form.origin}" not found. Try entering IATA code directly.`)
        setLoading(false)
        return 
      }
      if (!arrIata) { 
        setError(`Destination city "${form.destination}" not found. Try entering IATA code directly.`)
        setLoading(false)
        return 
      }
      setResolvedCodes({ origin: depIata, destination: arrIata })

      const res = await travelApi.searchFlights({
        depIata,
        arrIata,
        flightDate: form.date,
        limit: 10
      })
      setResults(res.data.data.flights)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to search flights')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col gap-6">
      
      {/* Search Form */}
      <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
        <div className="relative">
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-text-secondary mb-1.5">Origin</label>
          <Input
            placeholder="e.g. Mumbai or BOM"
            value={form.origin}
            onChange={e => setForm({...form, origin: e.target.value})}
            onFocus={() => setShowOriginSuggest(true)}
            onBlur={() => setTimeout(() => setShowOriginSuggest(false), 200)}
            required
            className="w-full"
          />
          {showOriginSuggest && (
            <SuggestionsDropdown
              query={form.origin}
              onSelect={c => {
                setForm(f => ({ ...f, origin: c }))
                setShowOriginSuggest(false)
              }}
            />
          )}
          {resolvedCodes.origin && <span className="text-[10px] text-emerald-400 mt-1 block font-mono">Resolved: {resolvedCodes.origin}</span>}
        </div>

        <div className="relative">
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-text-secondary mb-1.5">Destination</label>
          <Input
            placeholder="e.g. London or LHR"
            value={form.destination}
            onChange={e => setForm({...form, destination: e.target.value})}
            onFocus={() => setShowDestSuggest(true)}
            onBlur={() => setTimeout(() => setShowDestSuggest(false), 200)}
            required
            className="w-full"
          />
          {showDestSuggest && (
            <SuggestionsDropdown
              query={form.destination}
              onSelect={c => {
                setForm(f => ({ ...f, destination: c }))
                setShowDestSuggest(false)
              }}
            />
          )}
          {resolvedCodes.destination && <span className="text-[10px] text-emerald-400 mt-1 block font-mono">Resolved: {resolvedCodes.destination}</span>}
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-text-secondary mb-1.5">Date</label>
          <input 
            type="date" 
            value={form.date} 
            onChange={e => setForm({...form, date: e.target.value})} 
            required 
            className="w-full bg-surface border border-border rounded-xl text-text-primary font-sans text-xs px-4 py-2.5 outline-none transition-all duration-150 placeholder-text-muted focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)]" 
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-text-secondary mb-1.5">Class</label>
          <select 
            value={form.travelClass} 
            onChange={e => setForm({...form, travelClass: e.target.value})} 
            className="w-full bg-surface border border-border rounded-xl text-text-primary font-sans text-xs px-4 py-2.5 outline-none transition-all duration-150 focus:border-indigo-500 cursor-pointer"
          >
            <option value="ECONOMY">Economy</option>
            <option value="PREMIUM_ECONOMY">Premium Econ</option>
            <option value="BUSINESS">Business</option>
            <option value="FIRST">First</option>
          </select>
        </div>

        <Button 
          type="submit" 
          disabled={loading} 
          icon={<Search size={14} />}
          className="w-full py-2.5 text-xs font-semibold bg-indigo-700 hover:bg-indigo-600 border-none text-white shadow-lg"
        >
          {loading ? 'Searching...' : 'Search Flights'}
        </Button>
      </form>

      {/* Error Output */}
      {error && (
        <Card variant="raised" padding="sm" className="border-rose-500/20 bg-rose-500/5 text-rose-400 text-xs flex items-center gap-2">
          <Info size={14} />
          <span>{error}</span>
        </Card>
      )}
      
      {/* Loading Indicator */}
      {loading && <Loader text="Searching flight intelligence..." />}

      {/* Empty State */}
      {results && results.length === 0 && (
        <div className="text-center py-12 text-text-muted text-xs border border-dashed border-border rounded-2xl">
          <Plane size={36} className="mx-auto mb-2 opacity-35" />
          <p>No flight connections match this date. Try another flight date query.</p>
        </div>
      )}
      
      {/* Results List */}
      {results && results.length > 0 && (
        <div className="flex flex-col gap-3.5">
          {results.map((flight, idx) => (
            <Card 
              key={idx} 
              variant="default"
              padding="md"
              className="bg-surface-default hover:bg-surface-hover hover:border-indigo-500/40 transition-all border border-border/60 rounded-2xl flex flex-wrap justify-between items-center gap-4"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-lg shrink-0">
                  ✈️
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-text-primary text-sm flex items-center gap-1.5">
                    {flight.airline?.name || 'Unknown Airline'}
                    <span className="text-[10px] font-mono text-text-muted font-normal">({flight.flightIata || flight.flightNumber})</span>
                  </h4>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-text-secondary">
                    <span className="font-bold text-text-primary">{flight.departureAirport?.iataCode}</span>
                    <ArrowRight size={10} className="text-text-muted" />
                    <span className="font-bold text-text-primary">{flight.arrivalAirport?.iataCode}</span>
                    <span className="text-text-muted">|</span>
                    <span>Departs: <strong className="text-text-secondary font-mono">{flight.departureTime ? new Date(flight.departureTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Scheduled'}</strong></span>
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <Badge 
                  label={flight.status || 'Scheduled'} 
                  variant={flight.status === 'active' ? 'success' : 'neutral'} 
                />
                {flight.arrivalTime && (
                  <p className="text-[10px] text-text-muted mt-1.5 font-mono">
                    Arrives: {new Date(flight.arrivalTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </motion.div>
  )
}

// ── WEATHER TAB VIEW ──
function WeatherTab() {
  const [city, setCity] = useState('')
  const [loading, setLoading] = useState(false)
  const [weather, setWeather] = useState(null)
  const [error, setError] = useState(null)
  const [showSuggest, setShowSuggest] = useState(false)

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!city) return
    setLoading(true)
    setError(null)
    setWeather(null)
    try {
      const current = await travelApi.getCurrentWeather(city)
      const forecast = await travelApi.getWeatherForecast(city)
      setWeather({ current: current.data.data.current, forecast: forecast.data.data.forecast })
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch weather')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col gap-6">
      
      {/* Search Form */}
      <form onSubmit={handleSearch} className="flex gap-3 max-w-md">
        <div className="flex-1 relative">
          <Input
            placeholder="Enter city name..."
            value={city}
            onChange={e => setCity(e.target.value)}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 200)}
            required
            className="w-full"
          />
          {showSuggest && (
            <SuggestionsDropdown
              query={city}
              onSelect={c => {
                setCity(c)
                setShowSuggest(false)
              }}
            />
          )}
        </div>
        <Button 
          type="submit" 
          disabled={loading}
          icon={<Search size={14} />}
          className="bg-amber-600 hover:bg-amber-500 border-none text-white shadow-lg text-xs py-2.5 shrink-0"
        >
          {loading ? 'Fetching...' : 'Check Weather'}
        </Button>
      </form>

      {/* Error Output */}
      {error && (
        <Card variant="raised" padding="sm" className="border-rose-500/20 bg-rose-500/5 text-rose-400 text-xs flex items-center gap-2">
          <Info size={14} />
          <span>{error}</span>
        </Card>
      )}

      {/* Loading Indicator */}
      {loading && <Loader text="Querying weather forecasts..." />}

      {/* Weather Results banner */}
      {weather && weather.current && (
        <div className="flex flex-col gap-6 animate-fadeIn">
          
          {/* Main Weather Card */}
          <Card 
            variant="raised" 
            padding="lg" 
            className="bg-gradient-to-br from-amber-500/10 via-surface-default to-surface-default border-amber-500/20 rounded-2xl flex flex-wrap justify-between items-center gap-6"
          >
            <div className="flex items-center gap-4.5">
              <span className="text-5xl filter drop-shadow-md">{weather.current.conditionIcon || '🌤️'}</span>
              <div>
                <h2 className="text-xl font-extrabold text-text-primary tracking-tight">{weather.current.cityName}</h2>
                <p className="text-xs text-text-secondary mt-0.5">{weather.current.conditionGroup} • {weather.current.conditionDesc}</p>
                <div className="flex items-center gap-4 mt-3 text-[11px] text-text-muted font-mono">
                  <span className="flex items-center gap-1"><Wind size={12} className="text-amber-400/80" /> Wind: {weather.current.windKph} km/h</span>
                  <span className="flex items-center gap-1"><Droplets size={12} className="text-cyan-400/80" /> Humidity: {weather.current.humidity}%</span>
                </div>
              </div>
            </div>

            <div className="text-right">
              <span className="text-5xl font-black tracking-tighter text-amber-400 leading-none">
                {Math.round(weather.current.tempC)}°<span className="text-2xl font-light opacity-80">C</span>
              </span>
              <p className="text-[10px] text-text-muted mt-1.5 font-medium">Feels like {Math.round(weather.current.feelsLikeC)}°C</p>
            </div>
          </Card>

          {/* 5-Day Forecast Grid */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-bold text-text-secondary mb-3.5 flex items-center gap-1.5">
              <Calendar size={13} className="text-amber-400" /> 5-Day Forecast
            </h3>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
              {weather.forecast?.slice(0, 5).map((day, i) => (
                <Card 
                  key={i} 
                  variant="default"
                  padding="md"
                  className="bg-surface-default border-border/40 text-center hover:border-amber-500/20 transition-colors"
                >
                  <p className="text-[10px] text-text-secondary font-semibold">
                    {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  <div className="text-3xl my-3 filter drop-shadow">{day.conditionIcon || '🌤️'}</div>
                  <p className="font-extrabold text-sm text-text-primary">
                    {Math.round(day.tempMaxC)}° <span className="text-text-muted font-medium text-xs">/ {Math.round(day.tempMinC)}°</span>
                  </p>
                  <p className="text-[10px] text-cyan-400 mt-2 font-mono flex items-center justify-center gap-0.5">
                    <Droplets size={10} /> {Math.round(day.rainProbability)}%
                  </p>
                </Card>
              ))}
            </div>
          </div>

        </div>
      )}
    </motion.div>
  )
}

// ── PLACES TAB VIEW (Attractions & Dining) ──
function PlacesTab({ type }) {
  const isAttr = type === 'attractions'
  const colorClass = isAttr ? 'bg-violet-700 hover:bg-violet-600' : 'bg-emerald-700 hover:bg-emerald-600'
  const hoverColorClass = isAttr ? 'hover:border-violet-500/40' : 'hover:border-emerald-500/40'
  const badgeColor = isAttr ? 'var(--color-violet-500)' : 'var(--color-emerald-400)'

  const [city, setCity] = useState('')
  const [loading, setLoading] = useState(false)
  const [places, setPlaces] = useState(null)
  const [coords, setCoords] = useState(null)
  const [viewMode, setViewMode] = useState('grid')
  const [error, setError] = useState(null)
  const [showSuggest, setShowSuggest] = useState(false)

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!city) return
    setLoading(true)
    setError(null)
    setPlaces(null)
    setCoords(null)
    try {
      const res = isAttr 
        ? await travelApi.searchAttractionsByCity(city) 
        : await travelApi.searchRestaurantsByCity(city)
      
      if (isAttr) {
        setPlaces(res.data.data.attractions)
        if (res.data.data.coordinates) {
          setCoords([res.data.data.coordinates.lon, res.data.data.coordinates.lat])
        }
      } else {
        setPlaces(res.data.data.restaurants)
        if (res.data.data.geo) {
          setCoords([res.data.data.geo.lon, res.data.data.geo.lat])
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || `Failed to fetch ${type}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col gap-5">
      
      {/* Search Form */}
      <form onSubmit={handleSearch} className="flex gap-3 max-w-md">
        <div className="flex-1 relative">
          <Input
            placeholder="Enter city..."
            value={city}
            onChange={e => setCity(e.target.value)}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 200)}
            required
            className="w-full"
          />
          {showSuggest && (
            <SuggestionsDropdown
              query={city}
              onSelect={c => {
                setCity(c)
                setShowSuggest(false)
              }}
            />
          )}
        </div>
        <Button 
          type="submit" 
          disabled={loading}
          icon={<Search size={14} />}
          className={`border-none text-white shadow-lg text-xs py-2.5 shrink-0 ${colorClass}`}
        >
          {loading ? 'Searching...' : `Find ${isAttr ? 'Attractions' : 'Dining'}`}
        </Button>
      </form>

      {/* Error Output */}
      {error && (
        <Card variant="raised" padding="sm" className="border-rose-500/20 bg-rose-500/5 text-rose-400 text-xs flex items-center gap-2">
          <Info size={14} />
          <span>{error}</span>
        </Card>
      )}

      {/* Loading Indicator */}
      {loading && <Loader text={`Searching local ${type} locations...`} />}

      {/* Empty State */}
      {places && places.length === 0 && (
        <div className="text-center py-12 text-text-muted text-xs border border-dashed border-border rounded-2xl">
          <MapPin size={36} className="mx-auto mb-2 opacity-35" />
          <p>No results found for this area. Try searching another city.</p>
        </div>
      )}

      {/* Search Results Views toggling */}
      {places && places.length > 0 && (
        <div className="flex flex-col gap-4">
          
          {/* View Toggles bar */}
          <div className="flex justify-between items-center border-b border-border/30 pb-3">
            <span className="text-[11px] text-text-muted font-bold font-mono uppercase">
              Found {places.length} items
            </span>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-colors ${
                  viewMode === 'grid' 
                    ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30' 
                    : 'bg-surface-default hover:bg-surface-hover text-text-secondary border border-border/30'
                }`}
              >
                <GridIcon size={12} /> Grid
              </button>
              <button
                onClick={() => setViewMode('map')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-colors ${
                  viewMode === 'map' 
                    ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30' 
                    : 'bg-surface-default hover:bg-surface-hover text-text-secondary border border-border/30'
                }`}
              >
                <MapIcon size={12} /> Map
              </button>
            </div>
          </div>

          {/* Results layouts rendering */}
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {places.map((place, idx) => (
                <Card 
                  key={idx} 
                  variant="default"
                  padding="none"
                  className={`bg-surface-default border-border/60 transition-all duration-200 flex flex-col h-full rounded-2xl overflow-hidden ${hoverColorClass}`}
                >
                  <div className="h-44 border-b border-border/50 relative overflow-hidden shrink-0">
                    <img
                      src={place.photo || DEFAULT_IMAGES[isAttr ? 'Attraction' : 'Restaurant']}
                      alt={place.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.target.onerror = null
                        e.target.src = DEFAULT_IMAGES[isAttr ? 'Attraction' : 'Restaurant']
                      }}
                    />
                    {place.rating > 0 && (
                      <span className="absolute top-3 left-3 z-[1] bg-surface-scrim/80 backdrop-blur-[4px] text-amber-300 text-[10px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1 shadow">
                        <Star size={10} fill="currentColor" /> {place.rating}
                      </span>
                    )}
                  </div>

                  <div className="p-4.5 flex-1 flex flex-col gap-2.5 justify-between">
                    <div>
                      <h4 className="font-extrabold text-sm text-text-primary line-clamp-1" title={place.name}>
                        {place.name}
                      </h4>
                      <p className="text-[10px] text-text-secondary font-semibold uppercase mt-0.5 tracking-wider">
                        {place.category || (isAttr ? 'Attraction' : 'Restaurant')}
                      </p>
                      {place.address && (
                        <p className="text-[10px] text-text-muted mt-2 flex items-start gap-1">
                          <MapPin size={11} className="shrink-0 mt-0.5" />
                          <span className="line-clamp-2 leading-relaxed">{place.address}</span>
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/20">
                      {!isAttr && place.priceTier > 0 && (
                        <span className="text-[10px] font-extrabold bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/15">
                          {'$'.repeat(place.priceTier)}
                        </span>
                      )}
                      {place.isOpen !== undefined && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          place.isOpen 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/15' 
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/15'
                        }`}>
                          {place.isOpen ? 'Open Now' : 'Closed'}
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <ExploreMap places={places} coords={coords} type={type} />
          )}

        </div>
      )}

    </motion.div>
  )
}

// ── EXPLORE MAP CANVAS COMPONENT ──
function ExploreMap({ places, coords, type }) {
  const isAttr = type === 'attractions'
  const { mapRef, mapContainerRef, map, mapLoaded } = useMapbox({
    style: 'mapbox://styles/mapbox/streets-v12',
    center: coords || [78.9629, 20.5937],
    zoom: coords ? 13 : 4,
  })
  
  const [selectedEntity, setSelectedEntity] = useState(null)

  useEffect(() => {
    if (map && coords) {
      map.flyTo({ center: coords, zoom: 13, speed: 1.5 })
    }
  }, [map, coords])

  // Normalise places to map markers format
  const markers = (places || []).map((place, idx) => {
    const lat = place.coordinates?.lat
    const lon = place.coordinates?.lon
    if (!lat || !lon) return null
    return {
      _id: place.id || place.providerPlaceId || `${type}-${idx}`,
      _entityType: isAttr ? 'Attraction' : 'Restaurant',
      name: place.name,
      location: { type: 'Point', coordinates: [lon, lat] },
      address: place.address || '',
      category: place.category || (isAttr ? 'Attraction' : 'Restaurant'),
      averageRating: place.rating || 0,
      image: place.photo || place.image || DEFAULT_IMAGES[isAttr ? 'Attraction' : 'Restaurant'],
      priceInfo: place.priceTier ? { level: place.priceTier } : null,
      isOpenNow: place.isOpen ?? null,
    }
  }).filter(Boolean)

  return (
    <div className="relative h-[480px] rounded-2xl overflow-hidden border border-border">
      <MapContainer ref={mapContainerRef} className="h-full">
        {map && mapLoaded && markers.map((marker) => (
          <MapMarker
            key={marker._id}
            map={map}
            coordinates={marker.location.coordinates}
            type={marker._entityType}
            data={marker}
            onClick={setSelectedEntity}
          />
        ))}

        {map && mapLoaded && selectedEntity && (
          <MapPopup
            map={map}
            entity={selectedEntity}
            onClose={() => setSelectedEntity(null)}
          />
        )}
      </MapContainer>
    </div>
  )
}
