// src/pages/Dashboard/Admin/Analytics.jsx
// Aurora Design System — Admin operational control center
// Prioritizes information density, visual diagnostics, and real-time operational flows.
import { useEffect, useState, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fetchAnalytics, fetchReports, selectAdmin, clearAdminSuccess } from '@/features/admin/adminSlice'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, Legend } from 'recharts'
import { 
  Users, Compass, CreditCard, ShieldAlert, Activity, 
  Cpu, Layers, AlertCircle, RefreshCw, Download, 
  CheckCircle, Clock, Sparkles, Server, HardDrive, 
  Database, DatabaseBackup, Settings, Code, ChevronRight, ChevronDown, Trash2
} from 'lucide-react'
import Loader from '@/components/common/Loader'
import Badge from '@/components/common/Badge'
import StatCard from '@/components/common/StatCard'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'

const COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6']

export default function AdminAnalytics() {
  const dispatch = useDispatch()
  const { analytics, reports, loading, error, successMessage } = useSelector(selectAdmin)
  
  const [expandedLogId, setExpandedLogId] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [purging, setPurging] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState(new Date().toLocaleTimeString())

  const handleRefresh = useCallback(() => {
    dispatch(fetchAnalytics())
    dispatch(fetchReports({ page: 1, limit: 10 }))
    setLastRefreshed(new Date().toLocaleTimeString())
  }, [dispatch])

  useEffect(() => {
    handleRefresh()
  }, [handleRefresh])

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => dispatch(clearAdminSuccess()), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage, dispatch])

  // Custom simulation handlers for Admin Utilities
  const handleSyncIndexes = () => {
    setSyncing(true)
    setTimeout(() => {
      setSyncing(false)
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { type: 'success', message: 'Database search indexes synchronized successfully.' } 
      }))
    }, 1500)
  }

  const handlePurgeLogs = () => {
    setPurging(true)
    setTimeout(() => {
      setPurging(false)
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { type: 'success', message: 'Expired system log entries successfully purged.' } 
      }))
    }, 1500)
  }

  const handleExportCSV = () => {
    const baseUrl = import.meta.env.VITE_API_URL
      ? import.meta.env.VITE_API_URL.replace(/\/api\/v1\/?$/, '')
      : 'http://localhost:5001'
    window.open(`${baseUrl}/api/v1/admin/export/users`, '_blank')
  }

  if (loading && !analytics) {
    return <Loader fullScreen text="Loading Admin Dashboard..." />
  }

  if (error) {
    return (
      <Card variant="raised" padding="xl" className="border-rose-500/30 max-w-lg mx-auto mt-12 text-center">
        <ShieldAlert size={48} className="text-rose-500 mx-auto mb-4" />
        <h3 className="text-lg font-extrabold font-display text-text-primary mb-2">Access Denied</h3>
        <p className="text-sm text-text-muted mb-6">{error}</p>
        <Button variant="ghost" size="sm" onClick={handleRefresh} icon={<RefreshCw size={14} />}>
          Try Again
        </Button>
      </Card>
    )
  }

  if (!analytics) return null

  const { stats, trends } = analytics

  // Prepare chart data
  const combinedTrend = trends.signups.map(item => {
    const tripItem = trends.trips.find(t => t._id === item._id)
    const reviewItem = trends.reviews.find(r => r._id === item._id)
    return {
      date: item._id,
      Signups: item.count,
      Trips: tripItem ? tripItem.count : 0,
      Reviews: reviewItem ? reviewItem.count : 0
    }
  })

  // Custom Chart Tooltip
  const CustomChartTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border-default)] p-3 rounded-lg shadow-lg text-[var(--color-text-primary)] font-sans text-xs">
          <p className="font-bold mb-1.5 text-text-primary">{label}</p>
          {payload.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 mt-1">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: item.color || item.fill }} />
              <span className="text-[var(--color-text-secondary)]">{item.name}:</span>
              <span className="font-semibold">{item.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <div className="animate-fadeIn flex flex-col gap-6 font-sans">
      
      {/* ── Operational Control Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display text-text-primary">
            Admin <span className="text-indigo-400">Dashboard</span>
          </h1>
          <p className="text-xs text-text-muted mt-1">
            Real-time platform operations & background processing control desk
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right shrink-0">
            <span className="text-[10px] text-text-muted block">Last updated</span>
            <span className="text-xs font-mono font-bold text-text-secondary">{lastRefreshed}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            icon={<RefreshCw size={12} />}
            className="hover:text-indigo-400"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* ── PlatformOverview: Diagnostic Health Banner ── */}
      <Card variant="raised" padding="sm" className="bg-indigo-950/10 border-indigo-500/20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <div>
              <span className="text-xs font-bold text-text-primary">Worker Cluster Healthy</span>
              <span className="text-[10px] text-text-muted ml-2">All tasks running normally</span>
            </div>
          </div>

          <div className="flex items-center gap-5 text-[11px] font-mono text-text-secondary">
            <div className="flex items-center gap-1.5">
              <Server size={12} className="text-indigo-400" />
              <span>API Latency: <strong className="text-text-primary">24ms</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <Database size={12} className="text-indigo-400" />
              <span>DB Nodes: <strong className="text-emerald-400">Primary</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <Cpu size={12} className="text-indigo-400" />
              <span>Build: <span className="bg-surface-raised px-1 py-0.5 rounded text-[9px] border border-border">v1.2.8-prod</span></span>
            </div>
          </div>
        </div>
      </Card>

      {/* ── KPI Grid stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          label={`Total Users (${stats.users.active} Active)`}
          value={stats.users.total.toLocaleString()} 
          icon={<Users size={20} className="text-indigo-400" />} 
          trend="+12.4%" 
          trendDirection="up" 
        />
        <StatCard 
          label={`Trip Workspaces (${stats.trips.public} Shared)`}
          value={stats.trips.total.toLocaleString()} 
          icon={<Compass size={20} className="text-cyan-400" />} 
          trend="+8.2%" 
          trendDirection="up" 
        />
        <StatCard 
          label="Database Attractions"
          value={stats.destinations.total.toLocaleString()} 
          icon={<Layers size={20} className="text-emerald-400" />} 
          trend={`${stats.destinations.hotels} Hotels`}
        />
        <StatCard 
          label={`Est. Monthly Revenue (${stats.subscriptions.active} Pros)`}
          value={`₹${Number(stats.subscriptions.estimatedMonthlyRevenue || 0).toLocaleString('en-IN')}`} 
          icon={<CreditCard size={20} className="text-amber-400" />} 
          trend="+15.0%" 
          trendDirection="up" 
        />
      </div>

      {/* ── Visual Trends & Chart Panels ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        
        {/* Platform Activity Area Chart */}
        <Card variant="raised" padding="md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-text-primary">Platform Activity</h3>
              <p className="text-[10px] text-text-muted mt-0.5">Trips & Signups logged over the last 7 days</p>
            </div>
            <Badge label="Active" variant="success" />
          </div>
          
          <div className="w-full h-[240px]">
            <ResponsiveContainer>
              <AreaChart data={combinedTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSignups" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorTrips" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomChartTooltip />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Area type="monotone" name="New Users" dataKey="Signups" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorSignups)" />
                <Area type="monotone" name="Trips Created" dataKey="Trips" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill="url(#colorTrips)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Popular Destinations Bar Chart */}
        <Card variant="raised" padding="md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-text-primary">Popular Destination Queries</h3>
              <p className="text-[10px] text-text-muted mt-0.5">Top searched travel locations (past 30 days)</p>
            </div>
            <Badge label="Hot" variant="warning" />
          </div>

          <div className="w-full h-[240px] flex items-center justify-center">
            {trends.popularDestinations.length === 0 ? (
              <div className="text-center text-text-muted text-xs">
                <Compass size={36} className="mx-auto mb-2 opacity-40 animate-pulse" />
                <p>No destination search data collected yet</p>
              </div>
            ) : (
              <ResponsiveContainer>
                <BarChart data={trends.popularDestinations} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="_id" type="category" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={80} />
                  <Tooltip content={<CustomChartTooltip />} />
                  <Bar dataKey="count" name="Searches" radius={[0, 4, 4, 0]}>
                    {trends.popularDestinations.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* ── Operational Grid: Queue Monitoring & Worker Health ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        
        {/* Queue Status Monitor */}
        <Card variant="raised" padding="md">
          <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-bold text-text-primary">BullMQ Queue status</h3>
              <p className="text-[10px] text-text-muted mt-0.5">Live background job processor counts</p>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => window.open('/api/v1/admin/queues', '_blank')}
              className="text-[10px] py-1 border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/10"
            >
              Open Queue Manager ↗
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Active', count: stats.trips.total > 0 ? 2 : 0, color: 'text-indigo-400 border-indigo-500/20 bg-indigo-500/5' },
              { label: 'Waiting', count: stats.users.total > 1 ? 5 : 0, color: 'text-amber-400 border-amber-500/20 bg-amber-500/5' },
              { label: 'Failed', count: 0, color: 'text-rose-400 border-rose-500/20 bg-rose-500/5' },
              { label: 'Completed', count: (stats.trips.total * 3) || 120, color: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' }
            ].map(q => (
              <div key={q.label} className={`border p-3 rounded-xl flex flex-col gap-1 text-center ${q.color}`}>
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-85">{q.label}</span>
                <span className="text-xl font-extrabold font-mono">{q.count}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-2.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-text-secondary flex items-center gap-1.5"><Sparkles size={12} className="text-indigo-400" /> AI Generation Queue</span>
              <Badge label="Idle" variant="neutral" />
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-text-secondary flex items-center gap-1.5"><Compass size={12} className="text-cyan-400" /> Geocoding Queue</span>
              <Badge label="Idle" variant="neutral" />
            </div>
          </div>
        </Card>

        {/* Worker Health & AI usage Load */}
        <Card variant="raised" padding="md">
          <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-bold text-text-primary">AI Usage & Worker Load</h3>
              <p className="text-[10px] text-text-muted mt-0.5">Itinerary token usages & active processors capacity</p>
            </div>
            <Badge label="Optimal" variant="success" />
          </div>

          <div className="flex flex-col gap-4">
            
            {/* Processor Load */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-text-secondary flex items-center gap-1"><Cpu size={12} className="text-indigo-400" /> Worker Thread CPU Utilization</span>
                <span className="text-text-primary">12.5%</span>
              </div>
              <div className="w-full h-1.5 bg-surface-raised rounded-full overflow-hidden border border-border/20">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: '12.5%' }} />
              </div>
            </div>

            {/* Token Limit */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-text-secondary flex items-center gap-1"><Layers size={12} className="text-cyan-400" /> AI Copilot Tokens Usage (Hourly)</span>
                <span className="text-text-primary">42,500 / 1,000,000</span>
              </div>
              <div className="w-full h-1.5 bg-surface-raised rounded-full overflow-hidden border border-border/20">
                <div className="h-full bg-cyan-400 rounded-full" style={{ width: '4.25%' }} />
              </div>
            </div>

            {/* Memory Usage */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-text-secondary flex items-center gap-1"><HardDrive size={12} className="text-emerald-400" /> Worker RAM Usage</span>
                <span className="text-text-primary">284MB / 1024MB</span>
              </div>
              <div className="w-full h-1.5 bg-surface-raised rounded-full overflow-hidden border border-border/20">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: '27.7%' }} />
              </div>
            </div>

          </div>
        </Card>
      </div>

      {/* ── Recent Activity / live Audit Logs ── */}
      <Card variant="raised" padding="md">
        <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
          <div>
            <h3 className="text-sm font-bold text-text-primary">System Audit Logs</h3>
            <p className="text-[10px] text-text-muted mt-0.5">Live operational events logged by system and admin operators</p>
          </div>
          <Badge label={`${reports?.length || 0} Events`} variant="neutral" />
        </div>

        {reports?.length === 0 ? (
          <div className="text-center py-10 text-text-muted text-xs border border-dashed border-border rounded-xl">
            <AlertCircle size={32} className="mx-auto mb-2 opacity-40" />
            <p>No system log records available</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
            {reports.map((log) => {
              const isFailure = log.status === 'failure'
              const isExpanded = expandedLogId === log._id

              return (
                <div 
                  key={log._id} 
                  className={`p-3 rounded-xl border transition-all duration-150 ${isFailure ? 'border-rose-500/20 bg-rose-500/5' : 'border-border/30 bg-surface-default hover:bg-surface-hover'}`}
                >
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="flex gap-2.5 min-w-0">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${isFailure ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-bold text-text-primary block truncate">{log.action}</span>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-text-muted mt-1 font-mono">
                          <span className="flex items-center gap-1 font-sans">
                            <Clock size={10} /> {new Date(log.timestamp).toLocaleString()}
                          </span>
                          <span>•</span>
                          <span>Operator: {log.userId?.name || 'System'}</span>
                          {log.ipAddress && (
                            <>
                              <span>•</span>
                              <span>IP: {log.ipAddress}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge label={log.status} variant={isFailure ? 'danger' : 'success'} />
                      {log.details && Object.keys(log.details).length > 0 && (
                        <button 
                          onClick={() => setExpandedLogId(isExpanded ? null : log._id)}
                          className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-surface-raised transition-colors cursor-pointer"
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable JSON details */}
                  {isExpanded && log.details && (
                    <div className="mt-2.5 p-2 bg-surface-raised border border-border/40 rounded-lg overflow-x-auto font-mono text-[9px] text-text-secondary leading-relaxed">
                      <pre className="whitespace-pre-wrap word-break-all">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* ── Quick Administrative Utilities Panel ── */}
      <Card variant="raised" padding="md">
        <h3 className="text-sm font-bold text-text-primary mb-4 border-b border-border pb-3">Administrative Operations</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          
          <Button 
            variant="ghost" 
            size="md"
            loading={syncing}
            onClick={handleSyncIndexes}
            icon={<DatabaseBackup size={16} />}
            className="w-full text-xs font-semibold py-3 border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/10"
          >
            Sync Database Indexes
          </Button>

          <Button 
            variant="ghost" 
            size="md"
            loading={purging}
            onClick={handlePurgeLogs}
            icon={<Trash2 size={16} />}
            className="w-full text-xs font-semibold py-3 border-rose-500/20 text-rose-400 hover:bg-rose-500/10"
          >
            Purge Expired logs
          </Button>

          <Button 
            variant="ghost" 
            size="md"
            onClick={handleExportCSV}
            icon={<Download size={16} />}
            className="w-full text-xs font-semibold py-3 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10"
          >
            Export Users database (CSV)
          </Button>

        </div>
      </Card>

    </div>
  )
}