'use client'

import { useEffect, useState } from 'react'

interface CIEvent {
  id: string
  type: string
  pr_number: number
  pr_title: string
  data: {
    verdict?: 'PASS' | 'BLOCK' | 'ERROR'
    cost_usd?: number
    labels?: string[]
    summary?: string
    confidence?: number
    // Activity pulse data
    branch?: string
    work_type?: string
    commit_sha?: string
    commit_msg?: string
    areas?: string
    lines_added?: number
    lines_removed?: number
    actor?: string
    event?: string
    tips?: string  // AI-generated tips, pipe-separated
  }
  created_at: string
}

interface TrendData {
  total_prs_reviewed: number
  total_cost_usd: number
  average_cost_per_pr: number
  accuracy_rate: number
  cost_trend: Array<{
    date: string
    cost_usd: number
    pr_count: number
  }>
  model_usage: Record<string, {
    calls: number
    tokens: number
    cost_usd: number
  }>
}

interface CIDashboardProps {
  t: {
    admin: Record<string, string>
    common: Record<string, string>
  }
}

export function CIDashboard({ t }: CIDashboardProps) {
  const [events, setEvents] = useState<CIEvent[]>([])
  const [trend, setTrend] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchData() {
    try {
      const [eventsRes, trendRes] = await Promise.all([
        fetch('/api/ci/webhook'),
        fetch('/api/ci/trend'),
      ])

      if (eventsRes.ok) {
        const data = await eventsRes.json()
        setEvents(data.events || [])
      }

      if (trendRes.ok) {
        const data = await trendRes.json()
        setTrend(data.trend)
      }

      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-24 rounded-xl" style={{ background: 'var(--sand)' }} />
        <div className="h-48 rounded-xl" style={{ background: 'var(--sand)' }} />
      </div>
    )
  }

  // Separate activity pulses from other events
  const activityPulses = events.filter(e => e.type === 'activity_pulse')
  const otherEvents = events.filter(e => e.type !== 'activity_pulse')

  return (
    <div className="space-y-6">
      {/* Live Activity Banner */}
      {activityPulses.length > 0 && (
        <div
          className="rounded-xl p-4 relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(126, 182, 196, 0.15), rgba(167, 139, 250, 0.15))',
            border: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              {t.admin?.ciLiveActivity || 'Live Activity'}
            </span>
          </div>
          <div className="space-y-2">
            {activityPulses.slice(0, 3).map((pulse) => (
              <ActivityPulseRow key={pulse.id} event={pulse} />
            ))}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label={t.admin?.ciPRsReviewed || 'PRs Reviewed'}
          value={trend?.total_prs_reviewed || 0}
          icon="📊"
        />
        <StatCard
          label={t.admin?.ciTotalCost || 'Total Cost'}
          value={`$${(trend?.total_cost_usd || 0).toFixed(2)}`}
          icon="💰"
        />
        <StatCard
          label={t.admin?.ciAvgCost || 'Avg Cost/PR'}
          value={`$${(trend?.average_cost_per_pr || 0).toFixed(4)}`}
          icon="📈"
        />
        <StatCard
          label={t.admin?.ciAccuracy || 'Accuracy'}
          value={`${(trend?.accuracy_rate || 100).toFixed(0)}%`}
          icon="🎯"
          highlight={trend ? trend.accuracy_rate >= 95 : undefined}
        />
      </div>

      {/* Cost Trend Chart (simplified) */}
      {trend && trend.cost_trend.length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{ background: 'var(--sand)', border: '1px solid var(--border)' }}
        >
          <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--foreground)' }}>
            {t.admin?.ciCostTrend || 'Cost Trend (Last 7 Days)'}
          </h4>
          <div className="flex items-end gap-1 h-24">
            {trend.cost_trend.slice(-7).map((day, i) => {
              const maxCost = Math.max(...trend.cost_trend.map(d => d.cost_usd))
              const height = maxCost > 0 ? (day.cost_usd / maxCost) * 100 : 10
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t transition-all"
                    style={{
                      height: `${Math.max(height, 4)}%`,
                      background: 'var(--color-sky)',
                      minHeight: '4px',
                    }}
                    title={`${day.date}: $${day.cost_usd.toFixed(4)} (${day.pr_count} PRs)`}
                  />
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {day.date.slice(-2)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Model Usage */}
      {trend && Object.keys(trend.model_usage).length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{ background: 'var(--sand)', border: '1px solid var(--border)' }}
        >
          <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--foreground)' }}>
            {t.admin?.ciModelUsage || 'Model Usage'}
          </h4>
          <div className="space-y-2">
            {Object.entries(trend.model_usage)
              .sort(([, a], [, b]) => b.cost_usd - a.cost_usd)
              .slice(0, 5)
              .map(([model, usage]) => (
                <div key={model} className="flex items-center justify-between text-sm">
                  <span className="truncate" style={{ color: 'var(--foreground)' }}>
                    {model.split('/')[1] || model}
                  </span>
                  <div className="flex gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                    <span>{usage.calls} calls</span>
                    <span>${usage.cost_usd.toFixed(4)}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Recent Events */}
      <div>
        <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--foreground)' }}>
          {t.admin?.ciRecentActivity || 'Recent CI Activity'}
        </h4>
        {otherEvents.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.admin?.ciNoEvents || 'No CI events yet. Events will appear here when PRs are reviewed.'}
          </p>
        ) : (
          <div className="space-y-2">
            {otherEvents.slice(0, 10).map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string
  value: string | number
  icon: string
  highlight?: boolean
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: highlight ? 'rgba(16, 185, 129, 0.1)' : 'var(--sand)',
        border: `1px solid ${highlight ? 'var(--color-sage)' : 'var(--border)'}`,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span>{icon}</span>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {label}
        </span>
      </div>
      <div className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
        {value}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: CIEvent }) {
  const verdictColors: Record<string, string> = {
    PASS: 'var(--color-sage)',
    BLOCK: 'var(--color-coral)',
    ERROR: 'var(--color-honey)',
  }

  const typeIcons: Record<string, string> = {
    pr_opened: '📝',
    review_started: '🔍',
    review_completed: '✅',
    verdict: '🎯',
    labels_applied: '🏷️',
  }

  const timeAgo = getTimeAgo(new Date(event.created_at))

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg"
      style={{ background: 'var(--sand)', border: '1px solid var(--border)' }}
    >
      <span className="text-lg">{typeIcons[event.type] || '📌'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
            PR #{event.pr_number}
          </span>
          {event.data.verdict && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                background: `${verdictColors[event.data.verdict]}20`,
                color: verdictColors[event.data.verdict],
              }}
            >
              {event.data.verdict}
            </span>
          )}
          {event.data.cost_usd !== undefined && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              ${event.data.cost_usd.toFixed(4)}
            </span>
          )}
        </div>
        <p
          className="text-xs truncate"
          style={{ color: 'var(--muted)' }}
          title={event.pr_title}
        >
          {event.pr_title}
        </p>
      </div>
      <span className="text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
        {timeAgo}
      </span>
    </div>
  )
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function ActivityPulseRow({ event }: { event: CIEvent }) {
  const { data } = event
  const timeAgo = getTimeAgo(new Date(event.created_at))

  // Parse tips from pipe-separated string
  const tips = data.tips ? data.tips.split('|').filter(t => t.trim()) : []

  const workTypeColors: Record<string, string> = {
    'ai-agent': 'var(--color-lavender)',
    'feature': 'var(--color-sky)',
    'bugfix': 'var(--color-coral)',
    'production': 'var(--color-sage)',
    'development': 'var(--color-honey)',
    'unknown': 'var(--muted)',
  }

  const workTypeLabels: Record<string, string> = {
    'ai-agent': '🤖 AI Agent',
    'feature': '✨ Feature',
    'bugfix': '🐛 Fix',
    'production': '🚀 Production',
    'development': '🔧 Development',
    'unknown': '📝 Work',
  }

  return (
    <div className="rounded-lg" style={{ background: 'var(--card)' }}>
      <div className="flex items-center gap-3 p-2">
        {/* Work type badge */}
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
          style={{
            background: `${workTypeColors[data.work_type || 'unknown']}20`,
            color: workTypeColors[data.work_type || 'unknown'],
          }}
        >
          {workTypeLabels[data.work_type || 'unknown']}
        </span>

        {/* Branch and commit info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono truncate" style={{ color: 'var(--foreground)' }}>
              {data.branch}
            </span>
            {data.areas && (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {data.areas}
              </span>
            )}
          </div>
          <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
            {data.commit_msg || event.pr_title}
          </p>
        </div>

        {/* Stats */}
        <div className="text-right flex-shrink-0">
          <div className="text-xs" style={{ color: 'var(--foreground)' }}>
            {data.actor}
          </div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {data.lines_added !== undefined && data.lines_removed !== undefined && (
              <span>
                <span style={{ color: 'var(--color-sage)' }}>+{data.lines_added}</span>
                {' '}
                <span style={{ color: 'var(--color-coral)' }}>-{data.lines_removed}</span>
              </span>
            )}
            {' · '}
            {timeAgo}
          </div>
        </div>
      </div>

      {/* AI Tips */}
      {tips.length > 0 && (
        <div
          className="px-3 py-2 border-t text-xs space-y-1"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-1" style={{ color: 'var(--color-honey)' }}>
            <span>💡</span>
            <span className="font-medium">AI Tips:</span>
          </div>
          {tips.map((tip, i) => (
            <div key={i} className="pl-4" style={{ color: 'var(--muted)' }}>
              • {tip}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
