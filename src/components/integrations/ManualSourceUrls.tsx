'use client'

import { memo, useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Child } from '@/lib/types'
import { formatDateISO } from '@/lib/utils'

type UrlType = 'calendar_page' | 'pdf' | 'ics'

interface SourceUrl {
  id: string
  url: string
  display_name: string
  url_type: UrlType
  auto_sync: boolean
  sync_frequency_days: number
  last_sync_at: string | null
  last_sync_status: string | null
  child_id: string | null
  created_at: string
}

interface SourceEvent {
  id: string
  title: string
  event_date: string
  end_date: string | null
  event_time: string | null
  event_type: string | null
  description: string | null
  child_id: string | null
}

interface EventCounts {
  total: number
  upcoming: number
}

interface ManualSourceUrlsProps {
  householdId: string
  children: Child[]
  onMessage: (type: 'success' | 'error', text: string) => void
}

export const ManualSourceUrls = memo(function ManualSourceUrls({
  householdId,
  children,
  onMessage,
}: ManualSourceUrlsProps) {
  const [sourceUrls, setSourceUrls] = useState<SourceUrl[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<UrlType>('calendar_page')
  const [newChildId, setNewChildId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Event viewing state
  const [eventCounts, setEventCounts] = useState<Record<string, EventCounts>>({})
  const [viewingSource, setViewingSource] = useState<SourceUrl | null>(null)
  const [sourceEvents, setSourceEvents] = useState<SourceEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [showAllEvents, setShowAllEvents] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  // Close modal on Escape key
  useEffect(() => {
    if (!viewingSource) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewingSource(null)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [viewingSource])

  const loadSourceUrls = useCallback(async () => {
    const { data, error } = await supabase
      .from('external_source_urls')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })

    if (!error && data) {
      setSourceUrls(data)
    }
    setLoading(false)
  }, [supabase, householdId])

  useEffect(() => {
    loadSourceUrls()
  }, [loadSourceUrls])

  // Load event counts for all sources (both total and upcoming) in a single query
  // Limits to 365 days back to match other integrations and avoid fetching too much data
  const loadEventCounts = useCallback(async (sourceIds: string[]) => {
    if (sourceIds.length === 0) return

    const today = formatDateISO(new Date())
    const oneYearAgo = formatDateISO(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000))

    // Single query to get events from last 365 days, then count client-side
    const { data: events, error } = await supabase
      .from('external_events')
      .select('source_url_id, event_date')
      .in('source_url_id', sourceIds)
      .gte('event_date', oneYearAgo)

    // Initialize counts for all sources
    const counts: Record<string, EventCounts> = {}
    for (const sourceId of sourceIds) {
      counts[sourceId] = { total: 0, upcoming: 0 }
    }

    // Count events per source (skip on error - will show "Laster..." which is acceptable)
    if (!error && events) {
      for (const event of events) {
        const sourceId = event.source_url_id
        if (sourceId && counts[sourceId]) {
          counts[sourceId].total++
          if (event.event_date >= today) {
            counts[sourceId].upcoming++
          }
        }
      }
    }

    setEventCounts(counts)
  }, [supabase])

  // Load event counts when source URLs change
  useEffect(() => {
    if (sourceUrls.length > 0) {
      loadEventCounts(sourceUrls.map(s => s.id))
    }
  }, [sourceUrls, loadEventCounts])

  // Load events for a specific source
  const loadSourceEvents = async (source: SourceUrl, showAll = false) => {
    setViewingSource(source)
    setLoadingEvents(true)
    setSourceEvents([])
    setShowAllEvents(showAll)

    const today = formatDateISO(new Date())
    const oneYearAgo = formatDateISO(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000))

    let query = supabase
      .from('external_events')
      .select('id, title, event_date, end_date, event_time, event_type, description, child_id')
      .eq('source_url_id', source.id)

    if (showAll) {
      // Show last 365 days of events (past shown most recent first)
      query = query.gte('event_date', oneYearAgo)
    } else {
      // Show only upcoming events
      query = query.gte('event_date', today)
    }

    const { data } = await query
      .order('event_date', { ascending: !showAll })
      .order('event_time', { ascending: true })
      .limit(50)

    if (data) {
      setSourceEvents(data)
    }
    setLoadingEvents(false)
  }

  // Format event count with proper Norwegian grammar
  const formatEventCount = (counts: EventCounts | undefined) => {
    if (!counts) return 'Laster...'

    const { total, upcoming } = counts

    if (total === 0) {
      return 'Ingen hendelser synkronisert'
    }

    // Norwegian: 1 hendelse, 2+ hendelser
    const upcomingText = upcoming === 1 ? '1 kommende' : `${upcoming} kommende`

    if (total === upcoming) {
      // All events are upcoming
      return upcoming === 1 ? '1 hendelse' : `${upcoming} hendelser`
    }

    // Show both: "X hendelser (Y kommende)"
    const totalText = total === 1 ? '1 hendelse' : `${total} hendelser`
    return `${totalText} (${upcomingText})`
  }

  // Format event date for display
  const formatEventDate = (dateStr: string, endDateStr: string | null) => {
    const date = new Date(dateStr + 'T00:00:00')
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    }
    const formatted = date.toLocaleDateString('nb-NO', options)

    if (endDateStr && endDateStr !== dateStr) {
      const endDate = new Date(endDateStr + 'T00:00:00')
      const endFormatted = endDate.toLocaleDateString('nb-NO', options)
      return `${formatted} - ${endFormatted}`
    }

    return formatted
  }

  const addSourceUrl = async () => {
    if (!newUrl || !newName) return

    // Validate URL
    try {
      new URL(newUrl)
    } catch {
      onMessage('error', 'Ugyldig URL')
      return
    }

    setSaving(true)

    const { error } = await supabase
      .from('external_source_urls')
      .insert({
        household_id: householdId,
        url: newUrl,
        display_name: newName,
        url_type: newType,
        child_id: newChildId,
        auto_sync: true,
        sync_frequency_days: 7,
      })

    if (error) {
      if (error.code === '23505') {
        onMessage('error', 'Denne URL-en er allerede lagt til')
      } else {
        onMessage('error', 'Kunne ikke legge til kilde')
      }
    } else {
      onMessage('success', 'Kilde lagt til')
      setNewUrl('')
      setNewName('')
      setNewType('calendar_page')
      setNewChildId(null)
      setShowAddForm(false)
      loadSourceUrls()
    }

    setSaving(false)
  }

  const syncSourceUrl = async (id: string) => {
    setSyncing(id)

    try {
      const response = await fetch('/api/integrations/fetch-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrlId: id }),
      })

      const data = await response.json()

      if (response.ok) {
        onMessage('success', data.eventsFound
          ? `${data.eventsFound} hendelser funnet`
          : 'Synkronisert')
        loadSourceUrls()
      } else {
        onMessage('error', data.error || 'Synkronisering feilet')
      }
    } catch {
      onMessage('error', 'Synkronisering feilet')
    }

    setSyncing(null)
  }

  const deleteSourceUrl = async (id: string) => {
    if (!confirm('Er du sikker på at du vil fjerne denne kilden?')) return
    if (deleting) return // Prevent double-clicks

    setDeleting(id)

    const { error } = await supabase
      .from('external_source_urls')
      .delete()
      .eq('id', id)

    if (error) {
      onMessage('error', 'Kunne ikke fjerne kilde')
    } else {
      onMessage('success', 'Kilde fjernet')
      loadSourceUrls()
    }

    setDeleting(null)
  }

  const formatSyncTime = (time: string | null) => {
    if (!time) return 'Aldri'
    const date = new Date(time)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return 'Nettopp'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min siden`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} t siden`
    return `${Math.floor(diff / 86400000)} d siden`
  }

  const getTypeLabel = (type: UrlType) => {
    switch (type) {
      case 'calendar_page':
        return 'Kalenderside'
      case 'pdf':
        return 'PDF'
      case 'ics':
        return 'ICS-kalender'
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-12 rounded-lg" style={{ background: 'var(--sand)' }} />
        <div className="h-12 rounded-lg" style={{ background: 'var(--sand)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Existing source URLs */}
      {sourceUrls.map((source) => (
        <div
          key={source.id}
          className="p-4 rounded-xl"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate" style={{ color: 'var(--foreground)' }}>
                {source.display_name}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                {source.url}
              </p>
            </div>
            <div className="text-right shrink-0">
              <span
                className="inline-block px-2 py-1 rounded-lg text-xs font-medium"
                style={{
                  background: source.last_sync_status === 'ok'
                    ? 'rgba(139, 178, 139, 0.2)'
                    : source.last_sync_status === 'error'
                      ? 'rgba(232, 120, 109, 0.2)'
                      : 'var(--sand)',
                  color: source.last_sync_status === 'ok'
                    ? 'var(--color-sage)'
                    : source.last_sync_status === 'error'
                      ? 'var(--color-coral)'
                      : 'var(--muted)',
                }}
              >
                {source.last_sync_status === 'ok' ? 'OK' : source.last_sync_status === 'error' ? 'Feil' : 'Venter'}
              </span>
              {source.last_sync_at && (
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  {formatSyncTime(source.last_sync_at)}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs mb-3" style={{ color: 'var(--muted)' }}>
            <span className="px-2 py-0.5 rounded" style={{ background: 'var(--sand)' }}>
              {getTypeLabel(source.url_type)}
            </span>
            {source.child_id && children.find(c => c.id === source.child_id) && (
              <span className="px-2 py-0.5 rounded" style={{ background: 'var(--sand)' }}>
                {children.find(c => c.id === source.child_id)?.name}
              </span>
            )}
          </div>

          {/* Event count - clickable to view events */}
          {source.last_sync_status === 'ok' && (
            <button
              onClick={() => loadSourceEvents(source, false)}
              className="w-full flex items-center justify-between p-3 mb-3 rounded-lg transition-colors hover:opacity-80"
              style={{ background: 'var(--sand)' }}
            >
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)' }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                  {formatEventCount(eventCounts[source.id])}
                </span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)' }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => syncSourceUrl(source.id)}
              disabled={syncing === source.id}
              className="btn btn-secondary text-sm"
            >
              {syncing === source.id ? (
                <>
                  <svg width="14" height="14" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Synkroniserer...
                </>
              ) : (
                'Synkroniser'
              )}
            </button>
            <button
              onClick={() => deleteSourceUrl(source.id)}
              disabled={deleting === source.id}
              className="btn text-sm disabled:opacity-50"
              style={{ color: 'var(--color-coral)' }}
            >
              {deleting === source.id ? (
                <>
                  <svg width="14" height="14" className="animate-spin inline mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Fjerner...
                </>
              ) : (
                'Fjern'
              )}
            </button>
          </div>
        </div>
      ))}

      {/* Add new source URL */}
      {showAddForm ? (
        <div
          className="p-4 rounded-xl space-y-4"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              URL
            </label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://skole.no/kalender"
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              Navn
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Skolerute 2025-2026"
              className="input w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                Type
              </label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as UrlType)}
                className="input w-full"
              >
                <option value="calendar_page">Kalenderside</option>
                <option value="pdf">PDF-dokument</option>
                <option value="ics">ICS-kalender</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                Barn (valgfritt)
              </label>
              <select
                value={newChildId || ''}
                onChange={(e) => setNewChildId(e.target.value || null)}
                className="input w-full"
              >
                <option value="">Velg barn</option>
                {children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={addSourceUrl}
              disabled={saving || !newUrl || !newName}
              className="btn btn-primary text-sm"
            >
              {saving ? 'Lagrer...' : 'Legg til'}
            </button>
            <button
              onClick={() => {
                setShowAddForm(false)
                setNewUrl('')
                setNewName('')
                setNewType('calendar_page')
                setNewChildId(null)
              }}
              className="btn btn-secondary text-sm"
            >
              Avbryt
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full p-4 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          style={{
            background: 'var(--background)',
            border: '1px dashed var(--border)',
            color: 'var(--muted)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Legg til kalenderkilde
        </button>
      )}

      {/* Events Modal */}
      {viewingSource && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => setViewingSource(null)}
        >
          <div
            className="w-full sm:max-w-lg max-h-[85vh] rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
            style={{ background: 'var(--background)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold truncate" style={{ color: 'var(--foreground)' }}>
                  {viewingSource.display_name}
                </h3>
                <button
                  onClick={() => setViewingSource(null)}
                  className="p-2 rounded-lg hover:opacity-70 shrink-0 -mr-2"
                  style={{ color: 'var(--muted)' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              {/* Toggle between upcoming and all events */}
              <div className="flex gap-2">
                <button
                  onClick={() => loadSourceEvents(viewingSource, false)}
                  className="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: !showAllEvents ? 'var(--foreground)' : 'var(--sand)',
                    color: !showAllEvents ? 'var(--background)' : 'var(--muted)'
                  }}
                >
                  Kommende
                </button>
                <button
                  onClick={() => loadSourceEvents(viewingSource, true)}
                  className="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: showAllEvents ? 'var(--foreground)' : 'var(--sand)',
                    color: showAllEvents ? 'var(--background)' : 'var(--muted)'
                  }}
                >
                  Alle
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingEvents ? (
                <div className="flex items-center justify-center py-8">
                  <svg width="24" height="24" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--muted)' }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                </div>
              ) : sourceEvents.length === 0 ? (
                <div className="text-center py-8" style={{ color: 'var(--muted)' }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 opacity-50">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  {showAllEvents ? (
                    <>
                      <p className="text-sm">Ingen hendelser synkronisert</p>
                      <p className="text-xs mt-1">Prøv å synkronisere på nytt</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">Ingen kommende hendelser</p>
                      {eventCounts[viewingSource.id]?.total > 0 ? (
                        <p className="text-xs mt-1">
                          {eventCounts[viewingSource.id].total} {eventCounts[viewingSource.id].total === 1 ? 'hendelse' : 'hendelser'} i fortiden – trykk &quot;Alle&quot; for å se
                        </p>
                      ) : (
                        <p className="text-xs mt-1">Prøv å synkronisere på nytt</p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {sourceEvents.map((event) => {
                    const eventChild = event.child_id
                      ? children.find(c => c.id === event.child_id)
                      : null
                    const today = formatDateISO(new Date())
                    const isPast = event.event_date < today

                    return (
                      <div
                        key={event.id}
                        className="p-3 rounded-xl"
                        style={{
                          background: 'var(--sand)',
                          opacity: isPast ? 0.6 : 1
                        }}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
                            {event.title}
                          </p>
                          {event.event_type && (
                            <span
                              className="shrink-0 px-2 py-0.5 rounded text-xs"
                              style={{
                                background: 'var(--background)',
                                color: 'var(--muted)'
                              }}
                            >
                              {event.event_type}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                          <span>{formatEventDate(event.event_date, event.end_date)}</span>
                          {event.event_time && (
                            <>
                              <span>•</span>
                              <span>{event.event_time.slice(0, 5)}</span>
                            </>
                          )}
                          {eventChild && (
                            <>
                              <span>•</span>
                              <span>{eventChild.name}</span>
                            </>
                          )}
                        </div>
                        {event.description && (
                          <p className="text-xs mt-2 line-clamp-2" style={{ color: 'var(--muted)' }}>
                            {event.description}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => setViewingSource(null)}
                className="w-full btn btn-secondary"
              >
                Lukk
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
