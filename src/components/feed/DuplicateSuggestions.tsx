'use client'

/**
 * DuplicateSuggestions Component
 *
 * Shows AI-detected potential duplicate events for user review.
 * Users can choose to merge (keep one, hide other) or dismiss (keep both).
 *
 * Design:
 * - Side-by-side comparison on desktop, stacked on mobile
 * - Confidence indicator with visual feedback
 * - Clear action buttons with Norwegian labels
 * - Collapsible list for many suggestions
 */

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'

export interface DuplicateEvent {
  id: string
  title: string
  event_date: string
  end_date: string | null
  event_time: string | null
  event_type: string | null
  child_name?: string | null
  source_name?: string | null
}

export interface DuplicateSuggestion {
  id: string
  eventA: DuplicateEvent
  eventB: DuplicateEvent
  confidence: number
  matchReason: string
  createdAt: string
}

interface SuggestionCardProps {
  suggestion: DuplicateSuggestion
  onResolve: (id: string, action: 'merge_a' | 'merge_b' | 'not_duplicate' | 'dismiss') => void
  loading: boolean
}

function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const percentage = Math.round(confidence * 100)
  const color = confidence >= 0.8 ? 'var(--color-sage)' : 'var(--color-honey)'

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2 rounded-full flex-1 overflow-hidden"
        style={{ background: 'var(--background)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${percentage}%`, background: color }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums" style={{ color }}>
        {percentage}%
      </span>
    </div>
  )
}

function EventCard({
  event,
  isSelected,
  onSelect,
  formatDate,
  formatTime,
}: {
  event: DuplicateEvent
  isSelected: boolean
  onSelect: () => void
  formatDate: (d: string) => string
  formatTime: (t: string | null) => string | null
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full p-3 rounded-lg text-left transition-all"
      style={{
        background: isSelected ? 'rgba(172, 203, 163, 0.2)' : 'var(--background)',
        border: isSelected ? '2px solid var(--color-sage)' : '2px solid transparent',
      }}
    >
      <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
        {event.title}
      </p>
      <div className="flex flex-wrap gap-2 mt-2 text-xs" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {formatDate(event.event_date)}
          {event.end_date && event.end_date !== event.event_date && (
            <> - {formatDate(event.end_date)}</>
          )}
        </span>
        {event.event_time && (
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {formatTime(event.event_time)}
          </span>
        )}
      </div>
      {event.source_name && (
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {event.source_name}
        </p>
      )}
      {event.child_name && (
        <span
          className="inline-block mt-2 px-2 py-0.5 text-xs rounded-full"
          style={{ background: 'var(--card)', color: 'var(--muted)' }}
        >
          {event.child_name}
        </span>
      )}
      {isSelected && (
        <div className="mt-2 flex items-center gap-1 text-xs" style={{ color: 'var(--color-sage)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3" />
          </svg>
          Beholdes
        </div>
      )}
    </button>
  )
}

function DuplicateSuggestionCard({ suggestion, onResolve, loading }: SuggestionCardProps) {
  const [selectedEvent, setSelectedEvent] = useState<'a' | 'b' | null>(null)
  const { language } = useLanguage()

  const getLocale = () => {
    switch (language) {
      case 'nb': return 'nb-NO'
      case 'sv': return 'sv-SE'
      case 'en': return 'en-US'
      default: return 'nb-NO'
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString(getLocale(), { day: 'numeric', month: 'short' })
  }

  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return null
    return timeStr.slice(0, 5)
  }

  const handleMerge = () => {
    if (!selectedEvent) return
    onResolve(suggestion.id, selectedEvent === 'a' ? 'merge_a' : 'merge_b')
  }

  const handleKeepBoth = () => {
    onResolve(suggestion.id, 'not_duplicate')
  }

  const handleDismiss = () => {
    onResolve(suggestion.id, 'dismiss')
  }

  return (
    <article
      className="card p-4 border-l-4"
      style={{ borderLeftColor: 'var(--color-honey)', background: 'var(--card)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
            Mulig duplikat funnet
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            {suggestion.matchReason}
          </p>
        </div>
        <div className="w-24">
          <ConfidenceIndicator confidence={suggestion.confidence} />
        </div>
      </div>

      {/* Event comparison */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <EventCard
          event={suggestion.eventA}
          isSelected={selectedEvent === 'a'}
          onSelect={() => setSelectedEvent('a')}
          formatDate={formatDate}
          formatTime={formatTime}
        />
        <EventCard
          event={suggestion.eventB}
          isSelected={selectedEvent === 'b'}
          onSelect={() => setSelectedEvent('b')}
          formatDate={formatDate}
          formatTime={formatTime}
        />
      </div>

      {/* Instructions */}
      {!selectedEvent && (
        <p className="text-xs mb-3 text-center" style={{ color: 'var(--muted)' }}>
          Velg hvilken hendelse du vil beholde, eller behold begge
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleMerge}
          disabled={loading || !selectedEvent}
          className="btn btn-primary text-sm flex-1"
          style={{
            opacity: selectedEvent ? 1 : 0.5,
            cursor: selectedEvent ? 'pointer' : 'not-allowed',
          }}
        >
          {loading ? 'Slår sammen...' : 'Slå sammen'}
        </button>
        <button
          onClick={handleKeepBoth}
          disabled={loading}
          className="btn btn-secondary text-sm"
        >
          Behold begge
        </button>
        <button
          onClick={handleDismiss}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-white/5"
          style={{ color: 'var(--muted)' }}
          title="Skjul forslag"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </article>
  )
}

interface SuggestionsListProps {
  suggestions: DuplicateSuggestion[]
  onUpdate: () => void
}

const COLLAPSE_THRESHOLD = 3

export function DuplicateSuggestionsList({ suggestions, onUpdate }: SuggestionsListProps) {
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleResolve = useCallback(async (
    id: string,
    action: 'merge_a' | 'merge_b' | 'not_duplicate' | 'dismiss'
  ) => {
    setLoadingId(id)
    try {
      const supabase = createClient()
      const { error } = await supabase.rpc('resolve_duplicate_suggestion', {
        p_suggestion_id: id,
        p_action: action === 'merge_a' ? 'merge_keep_a' : action === 'merge_b' ? 'merge_keep_b' : action,
      })

      if (error) {
        console.error('Error resolving suggestion:', error)
        return
      }

      setResolvedIds((prev) => new Set(prev).add(id))

      if (action === 'merge_a' || action === 'merge_b') {
        setSuccessMessage('Hendelsene ble slått sammen')
      } else if (action === 'not_duplicate') {
        setSuccessMessage('Begge hendelser beholdt')
      }

      if (successMessage) {
        setTimeout(() => setSuccessMessage(null), 3000)
      }

      onUpdate()
    } catch (error) {
      console.error('Error resolving suggestion:', error)
    } finally {
      setLoadingId(null)
    }
  }, [onUpdate, successMessage])

  const visibleSuggestions = suggestions.filter((s) => !resolvedIds.has(s.id))

  if (visibleSuggestions.length === 0) {
    return null
  }

  const shouldCollapse = visibleSuggestions.length > COLLAPSE_THRESHOLD && !expanded
  const displaySuggestions = shouldCollapse
    ? visibleSuggestions.slice(0, COLLAPSE_THRESHOLD)
    : visibleSuggestions

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
        Foreslåtte duplikater
        <span
          className="ml-2 px-2 py-0.5 text-xs rounded-full"
          style={{ background: 'var(--color-honey)', color: 'white' }}
        >
          {visibleSuggestions.length}
        </span>
      </h2>

      {successMessage && (
        <div
          className="p-3 rounded-lg flex items-center gap-2"
          style={{ background: 'rgba(172, 203, 163, 0.2)', color: 'var(--color-sage)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {successMessage}
        </div>
      )}

      {displaySuggestions.map((suggestion) => (
        <DuplicateSuggestionCard
          key={suggestion.id}
          suggestion={suggestion}
          onResolve={handleResolve}
          loading={loadingId === suggestion.id}
        />
      ))}

      {visibleSuggestions.length > COLLAPSE_THRESHOLD && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full py-2 text-sm font-medium rounded-lg"
          style={{ color: 'var(--primary)', background: 'var(--background)' }}
        >
          {expanded
            ? 'Vis færre forslag'
            : `Vis ${visibleSuggestions.length - COLLAPSE_THRESHOLD} flere forslag`
          }
        </button>
      )}
    </section>
  )
}

export default DuplicateSuggestionsList
