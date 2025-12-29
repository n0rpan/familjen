'use client'

import { memo, useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TransitionLink } from '@/components/TransitionLink'

interface IntegrationStatsProps {
  integrationId: string
  service: string
}

interface Stats {
  event_count: number
  message_count: number
  photo_count: number
  hidden_event_count: number
}

export const IntegrationStats = memo(function IntegrationStats({
  integrationId,
  service,
}: IntegrationStatsProps) {
  const supabase = useMemo(() => createClient(), [])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data, error } = await supabase.rpc('get_integration_stats', {
          p_integration_id: integrationId,
        })

        if (error) {
          console.error('Error fetching integration stats:', error)
          return
        }

        if (data && data.length > 0) {
          setStats(data[0])
        }
      } catch (err) {
        console.error('Error fetching integration stats:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [integrationId, supabase])

  if (loading) {
    return (
      <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="animate-pulse flex gap-4">
          <div className="h-4 w-20 rounded" style={{ background: 'var(--sand)' }} />
          <div className="h-4 w-20 rounded" style={{ background: 'var(--sand)' }} />
          <div className="h-4 w-20 rounded" style={{ background: 'var(--sand)' }} />
        </div>
      </div>
    )
  }

  if (!stats) return null

  const hasData = stats.event_count > 0 || stats.message_count > 0 || stats.photo_count > 0
  if (!hasData) return null

  // Build filter param for feed
  const feedFilter = service.toLowerCase()

  return (
    <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
      {/* Stats summary - clickable to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex flex-wrap gap-3">
          {stats.event_count > 0 && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {stats.event_count} {stats.event_count === 1 ? 'hendelse' : 'hendelser'}
            </span>
          )}
          {stats.message_count > 0 && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              {stats.message_count} {stats.message_count === 1 ? 'melding' : 'meldinger'}
            </span>
          )}
          {stats.photo_count > 0 && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              {stats.photo_count} {stats.photo_count === 1 ? 'bilde' : 'bilder'}
            </span>
          )}
          {stats.hidden_event_count > 0 && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)', opacity: 0.7 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              +{stats.hidden_event_count} skjult
            </span>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Expanded view with links */}
      {expanded && (
        <div className="mt-3 space-y-2 animate-fade-in">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Se synkronisert innhold:
          </p>
          <div className="flex flex-wrap gap-2">
            {stats.message_count > 0 && (
              <TransitionLink
                href={`/feed?service=${feedFilter}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
                style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Se meldinger
              </TransitionLink>
            )}
            {stats.photo_count > 0 && (
              <TransitionLink
                href={`/feed?service=${feedFilter}&type=photos`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
                style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                Se bilder
              </TransitionLink>
            )}
            {stats.event_count > 0 && (
              <TransitionLink
                href="/uke"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
                style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Se i kalender
              </TransitionLink>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
