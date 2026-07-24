// src/pages/Dashboard/Copilot.jsx
// TripSetGo — Intelligent AI Copilot Workspace
// Integrates streaming chat sessions with selected trip grounding metadata, budgets, weather, and Mapbox GL.
import { useState, useEffect, useRef, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useSearchParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Sparkles, Send, Plus, Trash2, Calendar, DollarSign, 
  MapPin, User, Info, Building, Utensils, Plane, HelpCircle, 
  Menu, X, CloudRain, Cloud, Sun, ExternalLink, Map as MapIcon, Sliders, ChevronDown
} from 'lucide-react'
import { useMapbox } from '@/hooks/useMapbox'
import MapContainer from '@/components/map/MapContainer'
import ChatBubble from '@/components/domain/ChatBubble'
import api from '@/services/api'
import { 
  fetchMyTrips, fetchTrip, selectTrips, selectCurrentTrip, 
  clearCurrentTrip 
} from '@/features/trips/tripsSlice'
import { selectUser } from '@/features/auth/authSlice'

const API_BASE = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/v1\/?$/, '')
  : 'http://localhost:5001'

const SUGGESTIONS = [
  'Plan a 3-day budget trip to Goa',
  'Suggest some hidden gems in Manali',
  'How can I cut my trip budget by 20%?',
  'What should I pack for Kerala in monsoon?',
]

export default function Copilot() {
  const dispatch = useDispatch()
  const trips = useSelector(selectTrips)
  const currentTrip = useSelector(selectCurrentTrip)
  const currentUser = useSelector(selectUser)

  const [params, setSearchParams] = useSearchParams()
  const tripUrlParam = params.get('tripId') || ''

  // Active grounding state
  const [selectedTripId, setSelectedTripId] = useState(tripUrlParam)

  // Chat conversation state
  const [conversations, setConversations] = useState([])
  const [convId, setConvId] = useState(null)
  const [messages, setMessages] = useState([]) // [{ role, text }]
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef(null)

  // Sidebar & Drawers states
  const [drawerOpen, setDrawerOpen] = useState(false) // Mobile sidebar
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false) // Mobile trip context bottom sheet
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024)

  // Weather & Budget details state
  const [weatherForecast, setWeatherForecast] = useState(null)
  const [loadingWeather, setLoadingWeather] = useState(false)

  // Context Panel mini map preview configuration
  const { mapContainerRef, map, mapLoaded } = useMapbox({
    style: 'mapbox://styles/mapbox/dark-v11',
    zoom: 10,
    interactive: false,
    attributionControl: false,
  })

  // Listen to window size
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Initial load
  useEffect(() => {
    dispatch(fetchMyTrips({ page: 1, limit: 100 }))
    loadConversations()
  }, [dispatch])

  // Sync selectedTripId on URL changes
  useEffect(() => {
    if (tripUrlParam) {
      setSelectedTripId(tripUrlParam)
      dispatch(fetchTrip(tripUrlParam))
    }
  }, [tripUrlParam, dispatch])

  // Load past conversation messages
  const loadConversations = async () => {
    try {
      const res = await api.get('/api/v1/copilot/conversations')
      setConversations(res.data.data || [])
    } catch {
      setConversations([])
    }
  }

  // Handle active grounding trip selection
  const handleSelectTrip = (tripId) => {
    setSelectedTripId(tripId)
    setSearchParams(tripId ? { tripId } : {})
    setWeatherForecast(null)
    if (tripId) {
      dispatch(fetchTrip(tripId))
    } else {
      dispatch(clearCurrentTrip())
    }
  }

  // Weather forecast lookup
  const fetchWeather = useCallback(async (destination) => {
    setLoadingWeather(true)
    try {
      const res = await api.get('/api/v1/weather/forecast', { params: { city: destination } })
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

  useEffect(() => {
    if (currentTrip?.destination) {
      fetchWeather(currentTrip.destination)
    } else {
      setWeatherForecast(null)
    }
  }, [currentTrip?.destination, fetchWeather])

  // Context Panel Map updates
  useEffect(() => {
    if (!map || !mapLoaded || !currentTrip?.destination) return
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
    let found = false
    Object.keys(coordsMap).forEach(key => {
      if (dest.includes(key)) {
        center = coordsMap[key]
        found = true
      }
    })

    if (found) {
      map.easeTo({ center, zoom: 10, duration: 600 })
    } else {
      api.get('/api/v1/travel/attractions/geocode', { params: { q: currentTrip.destination } })
        .then(res => {
          if (res.data?.success && res.data?.data) {
            const { lat, lon } = res.data.data
            map.easeTo({ center: [lon, lat], zoom: 10, duration: 600 })
          }
        })
        .catch(() => {})
    }
  }, [map, mapLoaded, currentTrip?.destination])

  // Open Chat thread
  const openConversation = async (id) => {
    setConvId(id)
    setDrawerOpen(false)
    try {
      const res = await api.get(`/api/v1/copilot/conversations/${id}/messages`)
      setMessages((res.data.data.messages || []).map((m) => ({ role: m.role || 'user', text: m.text })))
      
      // ground context selectors if tripId is associated
      const assocTripId = res.data.data.conversation?.tripId
      if (assocTripId) {
        setSelectedTripId(assocTripId)
        dispatch(fetchTrip(assocTripId))
      }
    } catch {
      setMessages([])
    }
  }

  const newChat = () => {
    setConvId(null)
    setMessages([])
    setDrawerOpen(false)
  }

  const deleteConv = async (id, e) => {
    e.stopPropagation()
    try {
      await api.delete(`/api/v1/copilot/conversations/${id}`)
      if (id === convId) newChat()
      loadConversations()
    } catch { /* ignore */ }
  }

  const getCookie = (name) => {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return match ? decodeURIComponent(match[1]) : null
  }

  // Stream send query
  const send = async (text) => {
    const content = (text ?? input).trim()
    if (!content || streaming) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: content }, { role: 'assistant', text: '' }])
    setStreaming(true)
    let newConvId = convId
    try {
      const token = localStorage.getItem('accessToken')
      const csrfToken = getCookie('csrfToken')
      const res = await fetch(`${API_BASE}/api/v1/copilot/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {})
        },
        body: JSON.stringify({ message: content, conversationId: convId, tripId: selectedTripId }),
      })
      if (!res.ok || !res.body) throw new Error('stream failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          let evt
          try { evt = JSON.parse(line.slice(6)) } catch { continue }
          if (evt.type === 'meta' || evt.type === 'done') {
            newConvId = evt.conversationId
          } else if (evt.type === 'token') {
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              next[next.length - 1] = { role: 'assistant', text: (last?.text || '') + evt.text }
              return next
            })
          } else if (evt.type === 'error') {
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { role: 'assistant', text: '⚠️ ' + evt.message }
              return next
            })
          }
        }
      }
      if (newConvId && newConvId !== convId) setConvId(newConvId)
      loadConversations()
    } catch {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant' && !last.text) {
          next[next.length - 1] = { role: 'assistant', text: '⚠️ The copilot is unavailable right now. Please try again.' }
        }
        return next
      })
    } finally {
      setStreaming(false)
    }
  }

  // Add card recommendation to active itinerary day
  const handleAddStopFromCard = async (entity) => {
    if (!currentTrip) return
    const isCustomized = currentTrip.itinerary && currentTrip.itinerary.length > 0
    let targetTrip = { ...currentTrip }
    try {
      setStreaming(true)
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

      const dayEntry = targetTrip.itinerary.find(d => d.day === 1)
      if (!dayEntry) return

      const newActivity = {
        targetType: entity.targetType || 'Attraction',
        name: entity.name,
        notes: entity.address || '',
        cost: 0,
        startTime: new Date(new Date().setHours(9, 0, 0)),
      }

      const updatedActivities = [...(dayEntry.activities || []), newActivity]
      await api.put(`/api/v1/trips/${currentTrip._id}/itinerary/day/1`, { activities: updatedActivities })
      
      dispatch(fetchTrip(currentTrip._id))
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { type: 'success', message: `Added ${entity.name} to Day 1 of your trip!` } 
      }))
    } catch (err) {
      console.error(err)
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { type: 'error', message: 'Failed to save recommended stop.' } 
      }))
    } finally {
      setStreaming(false)
    }
  }

  // Scroll viewport down on messages append
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Local budget progression computations
  const totalDays = currentTrip 
    ? (currentTrip.planData?.meta?.total_days || Math.ceil((new Date(currentTrip.endDate) - new Date(currentTrip.startDate)) / (1000 * 60 * 60 * 24)) + 1 || 1) 
    : 1

  const localSpend = currentTrip ? (() => {
    const opts = currentTrip.selectedOptions || {}
    const transport = opts.transport?.total_cost || currentTrip.planData?.transport_options?.[0]?.total_cost || 0
    const hotel = (opts.hotel?.price_per_night || 0) * totalDays
    const food = opts.food?.total_cost || 0
    let itineraryCost = 0
    if (currentTrip.itinerary && currentTrip.itinerary.length > 0) {
      currentTrip.itinerary.forEach(d => {
        d.activities?.forEach(act => { itineraryCost += (act.cost || 0) })
      })
    } else if (currentTrip.planData?.itinerary) {
      currentTrip.planData.itinerary.forEach(d => {
        ;['morning', 'afternoon', 'evening'].forEach(slot => {
          d[slot]?.activities?.forEach(act => { itineraryCost += (act.cost || 0) })
        })
      })
    }
    return transport + hotel + food + itineraryCost
  })() : 0

  const budgetRatio = currentTrip ? (localSpend / currentTrip.budget) : 0
  const budgetColorClass = budgetRatio <= 0.8 
    ? 'bg-emerald-500' 
    : budgetRatio <= 1.0 
      ? 'bg-amber-500' 
      : 'bg-rose-500'

  return (
    <div className="flex w-full overflow-hidden bg-surface-base text-text-primary" style={{ height: 'calc(100vh - 64px)' }}>
      
      {/* ── Desktop Left Sidebar / Mobile Drawer Overlay ── */}
      <AnimatePresence>
        {(!isMobile || drawerOpen) && (
          <motion.aside
            initial={isMobile ? { x: '-100%' } : { x: -280, opacity: 0 }}
            animate={isMobile ? { x: 0 } : { x: 0, opacity: 1 }}
            exit={isMobile ? { x: '-100%' } : { x: -280, opacity: 0 }}
            transition={{ type: 'tween', ease: 'easeInOut', duration: 0.2 }}
            className={`
              z-30 flex flex-col bg-surface-glass border-border backdrop-blur-md overflow-hidden shrink-0 shadow-lg
              ${isMobile 
                ? 'fixed inset-y-0 left-0 w-[260px] border-r h-full mt-16' 
                : 'w-[280px] border-r h-full'
              }
            `}
          >
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
              <h2 className="text-xs uppercase tracking-wider text-text-muted font-bold font-display">Recent Chats</h2>
              <button
                id="btn-sidebar-newchat"
                onClick={newChat}
                className="flex items-center gap-1 text-[10px] font-bold text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-1.5 rounded-lg border border-indigo-500/20 transition-all cursor-pointer"
              >
                <Plus size={12} /> New Chat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-1.5" role="list">
              {conversations.length === 0 ? (
                <div className="text-center py-10 text-text-muted text-[11px] font-medium px-4">
                  No conversation logs found. Start typing below to begin.
                </div>
              ) : (
                conversations.map(c => {
                  const active = c._id === convId
                  return (
                    <div
                      key={c._id}
                      onClick={() => openConversation(c._id)}
                      className={`
                        flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all duration-150 group
                        ${active 
                          ? 'bg-indigo-500/10 border-indigo-500/40 text-text-primary' 
                          : 'bg-transparent border-transparent hover:bg-surface-hover text-text-secondary hover:text-text-primary'
                        }
                      `}
                      role="listitem"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="text-xs font-bold truncate">
                          {c.tripId?.destination ? `✈️ ${c.tripId.destination}` : 'Chat Assistant'}
                        </p>
                        <p className="text-[10px] text-text-muted truncate mt-0.5">
                          {c.lastMessage?.text || 'Empty conversation'}
                        </p>
                      </div>
                      <button
                        onClick={(e) => deleteConv(c._id, e)}
                        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-rose-400 transition-opacity p-1"
                        title="Delete Chat"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Middle Chat Area Panel ── */}
      <main className="flex-1 flex flex-col overflow-hidden relative border-r border-border">
        
        {/* Chat Area Header */}
        <header className="p-4 border-b border-border bg-surface-glass backdrop-blur-md flex items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-2.5">
            {isMobile && (
              <button 
                onClick={() => setDrawerOpen(!drawerOpen)}
                className="text-text-secondary hover:text-text-primary p-1 bg-surface-raised border border-border rounded-lg shrink-0"
                aria-label="Toggle menu"
              >
                {drawerOpen ? <X size={16} /> : <Menu size={16} />}
              </button>
            )}

            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 shadow-sm">
                <Sparkles size={16} />
              </div>
              <div>
                <h1 className="text-sm font-extrabold font-display tracking-tight text-text-primary">
                  AI <span className="text-indigo-400">Copilot</span>
                </h1>
                <p className="text-[10px] text-text-secondary mt-0.5">Experienced Travel Expert</p>
              </div>
            </div>
          </div>

          {/* Active Trip dropdown selector */}
          <div className="flex items-center gap-2">
            <div className="relative shrink-0">
              <select
                id="select-trip-dropdown"
                value={selectedTripId}
                onChange={e => handleSelectTrip(e.target.value)}
                className="bg-surface-raised border border-border rounded-xl text-text-primary text-[10px] font-bold pl-3 pr-8 py-2 outline-none cursor-pointer appearance-none"
              >
                <option value="">No Active Trip Context</option>
                {trips.map(trip => (
                  <option key={trip._id} value={trip._id}>✈️ {trip.destination}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" size={12} />
            </div>

            {isMobile && selectedTripId && (
              <button
                onClick={() => setContextDrawerOpen(true)}
                className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/10 px-2.5 py-2 rounded-xl shrink-0"
              >
                Context
              </button>
            )}
          </div>
        </header>

        {/* Trip Context active banner */}
        {currentTrip && (
          <div className="bg-indigo-500/5 border-b border-indigo-500/10 px-4 py-2 flex items-center justify-between text-[11px] shrink-0 text-text-secondary animate-slideDown">
            <div className="flex items-center gap-1.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              <span>Grounded on: <strong>{currentTrip.destination}</strong></span>
              <span className="text-text-muted text-[10px] hidden md:inline">({currentTrip.source} → {currentTrip.destination})</span>
            </div>
            <Link 
              to={`/trips/${currentTrip._id}`} 
              className="text-text-link hover:text-text-link-hover font-bold text-[10px] flex items-center gap-0.5 transition-colors shrink-0"
            >
              Trip Details <ExternalLink size={10} />
            </Link>
          </div>
        )}

        {/* Message board viewport */}
        <div 
          ref={scrollRef} 
          className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4"
        >
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3 max-w-lg mx-auto">
              <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20 shadow-md">
                <Sparkles size={22} className="animate-pulse" />
              </div>
              <h3 className="font-extrabold text-sm font-display text-text-primary">How can I assist your travel plans?</h3>
              <p className="text-xs text-text-muted">Ask anything about destinations, transport, weather, packing essentials, or optimizing budgets. Try one of these prompts:</p>
              
              <div className="flex flex-col gap-2 w-full mt-2">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    id={`suggestion-chip-${s.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                    onClick={() => send(s)}
                    className="w-full bg-surface-default hover:bg-indigo-500/5 border border-border hover:border-indigo-500/30 text-text-secondary hover:text-text-primary text-xs font-semibold py-2 px-3.5 rounded-xl transition-all cursor-pointer text-left"
                  >
                    ✨ {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <ChatBubble
                key={i}
                sender={m.role === 'user' ? 'user' : 'ai'}
                message={m.text}
                isStreaming={streaming && i === messages.length - 1}
                avatar={currentUser?.avatar}
                name={currentUser?.name}
                onAddStop={handleAddStopFromCard}
              />
            ))
          )}


        </div>

        {/* Input area composer */}
        <div className="p-4 bg-surface-glass border-t border-border shrink-0">
          <form 
            onSubmit={e => { e.preventDefault(); send() }}
            className="flex items-center gap-2"
          >
            <input
              id="input-copilot-message"
              type="text"
              placeholder={currentTrip ? `Ask about your trip to ${currentTrip.destination}...` : "Message the copilot..."}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={streaming}
              className="flex-1 bg-surface-raised border border-border rounded-xl text-text-primary text-xs px-4 py-3 outline-none transition-all focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.2)] disabled:opacity-50"
            />
            <button
              id="btn-send-message"
              type="submit"
              disabled={streaming || !input.trim()}
              className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shrink-0 disabled:opacity-50 shadow-md cursor-pointer transition-all active:scale-95"
            >
              <Send size={15} />
            </button>
          </form>
        </div>

      </main>

      {/* ── Right Context Panel (Desktop) / Mobile Drawer Bottom Sheet ── */}
      <AnimatePresence>
        {(!isMobile || contextDrawerOpen) && (
          <motion.aside
            initial={isMobile ? { y: '100%' } : { x: 300, opacity: 0 }}
            animate={isMobile ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={isMobile ? { y: '100%' } : { x: 300, opacity: 0 }}
            transition={{ type: 'tween', ease: 'easeInOut', duration: 0.25 }}
            className={`
              z-30 flex flex-col bg-surface-glass border-border backdrop-blur-md overflow-hidden shrink-0 shadow-lg
              ${isMobile 
                ? 'fixed inset-x-0 bottom-0 rounded-t-2xl border-t h-[75vh] w-full' 
                : 'w-[300px] border-l h-full'
              }
            `}
          >
            {/* Mobile swipe tray pull indicator */}
            {isMobile && (
              <div 
                className="w-full flex justify-center py-3 cursor-pointer shrink-0 border-b border-border-subtle"
                onClick={() => setContextDrawerOpen(false)}
              >
                <div className="w-12 h-1.5 bg-border rounded-full" />
              </div>
            )}

            {/* Context Header */}
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
              <h2 className="text-xs uppercase tracking-wider text-text-muted font-bold font-display">Trip Context</h2>
              {isMobile && (
                <button 
                  onClick={() => setContextDrawerOpen(false)}
                  className="text-xs font-bold text-text-muted hover:text-text-primary bg-surface-hover px-2.5 py-1 rounded-lg"
                >
                  Close
                </button>
              )}
            </div>

            {/* Context Content body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
              {!currentTrip ? (
                <div className="flex flex-col items-center justify-center text-center py-14 text-text-muted gap-3">
                  <div className="w-11 h-11 rounded-full bg-surface-default border border-border/40 flex items-center justify-center text-text-muted/60">
                    <Calendar size={18} />
                  </div>
                  <p className="text-[11px] font-medium max-w-[200px]">Select a trip from the header dropdown to ground the Copilot on your schedule, budget, and map routes.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4 animate-fadeIn">
                  
                  {/* Trip Summary Panel */}
                  <div className="p-3.5 bg-surface-default border border-border rounded-xl flex flex-col gap-1.5 shadow-sm">
                    <h3 className="font-extrabold text-sm text-text-primary font-display">{currentTrip.destination}</h3>
                    <p className="text-[10px] text-text-muted">
                      from {currentTrip.source} • {totalDays} Days • {currentTrip.groupType}
                    </p>
                    {currentTrip.preferences?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {currentTrip.preferences.map(p => (
                          <span key={p} className="text-[9px] font-bold text-indigo-400 bg-indigo-500/5 px-2 py-0.5 rounded border border-indigo-500/10">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Spend Budget bar */}
                  <div className="p-3.5 bg-surface-default border border-border rounded-xl flex flex-col gap-2.5 shadow-sm">
                    <div className="flex justify-between items-center text-[10px] font-bold">
                      <span className="text-text-secondary">Spend Meter</span>
                      <span className={budgetRatio > 1.0 ? 'text-rose-400 font-bold animate-pulse' : 'text-text-primary'}>
                        ₹{localSpend.toLocaleString()} / ₹{Number(currentTrip.budget).toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-base border border-border/20 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-300 ${budgetColorClass}`} 
                        style={{ width: `${Math.min(100, budgetRatio * 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-text-muted mt-0.5">
                      <span>Total segment cost</span>
                      <span>{(budgetRatio * 100).toFixed(0)}% spend</span>
                    </div>
                  </div>

                  {/* Weather forecast summary */}
                  {loadingWeather ? (
                    <div className="flex items-center justify-center gap-2 py-4 bg-surface-default border border-border rounded-xl">
                      <div className="animate-spin rounded-full h-3 w-3 border border-border border-t-indigo-400" />
                      <span className="text-[10px] text-text-muted">Syncing weather...</span>
                    </div>
                  ) : weatherForecast ? (
                    <div className="p-3.5 bg-surface-default border border-border rounded-xl flex items-center justify-between text-xs shadow-sm">
                      <div className="flex items-center gap-2.5">
                        {weatherForecast.forecast?.[0]?.condition?.toLowerCase().includes('rain') ? (
                          <CloudRain size={18} className="text-indigo-300" />
                        ) : weatherForecast.forecast?.[0]?.condition?.toLowerCase().includes('cloud') ? (
                          <Cloud size={18} className="text-sky-300" />
                        ) : (
                          <Sun size={18} className="text-amber-400 animate-pulse-slow" />
                        )}
                        <div>
                          <h4 className="font-bold text-text-primary text-[11px]">Weather Forecast</h4>
                          <p className="text-[10px] text-text-secondary capitalize mt-0.5">
                            {weatherForecast.forecast?.[0]?.condition ?? 'Sunny'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-sm font-bold text-text-primary">
                          {weatherForecast.forecast?.[0]?.temp ?? weatherForecast.temp ?? '—'}°C
                        </span>
                        <p className="text-[9px] text-text-muted">Live Conditions</p>
                      </div>
                    </div>
                  ) : null}

                  {/* Mini Mapbox canvas preview container */}
                  <div className="bg-surface-default border border-border rounded-xl p-1 shadow-sm flex flex-col gap-1.5">
                    <div className="px-2 py-1.5 flex items-center justify-between border-b border-border/20 text-[10px] font-bold text-text-muted">
                      <span className="flex items-center gap-1"><MapIcon size={12} /> Spatial Preview</span>
                      <span className="text-indigo-400">Active Center</span>
                    </div>
                    <MapContainer 
                      ref={mapContainerRef} 
                      className="w-full h-40 rounded-lg overflow-hidden border border-border/10 relative"
                    />
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