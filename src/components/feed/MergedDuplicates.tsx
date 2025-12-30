'use client'

/**
 * MergedDuplicates Component
 *
 * Shows recently auto-merged duplicate events with option to undo.
 * Only shows events merged in the last 30 days.
 *
 * Design:
 * - Collapsible section (hidden by default to reduce clutter)
 * - Clear indication of which event was kept vs hidden
 * - One-click undo with confirmation
 * - Batch operations for power users
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'

export interface MergedDuplicate {
  id: string // ID of the hidden event
  title: string
  event_date: string
  event_time: string | null
  duplicate_of_id: string
  duplicate_confidence: number
  kept_event_title: string
  kept_event_date: string
  source_name: string | null
  child_name: string | null
  merged_at: string // When it was marked as duplicate
}

interface MergedCardProps {
  merged: MergedDuplicate
  onUndo: (id: string) => void
  loading: boolean
}

function MergedDuplicateCard({ merged, onUndo, loading }: MergedCardProps) {
  const { language, t } = useLanguage()

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

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return t.common.today
    if (diffDays === 1) return t.common.yesterday
    if (diffDays < 7) return `${diffDays} ${t.common.days} ${language === 'en' ? 'ago' : 'siden'}`
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7)
      return language === 'en' ? `${weeks} weeks ago` : language === 'sv' ? `${weeks} veckor sedan` : `${weeks} uker siden`
    }
    return formatDate(dateStr)
  }

  const confidence = Math.round(merged.duplicate_confidence * 100)

  return (
    <div
      className="p-3 rounded-lg flex items-start gap-3"
      style={{ background: 'var(--background)' }}
    >
      {/* Icon */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(126, 182, 196, 0.2)', color: 'var(--color-sky)' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <path d="M14 14h7v7h-7z" opacity="0.5" />
        </svg>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm" style={{ color: 'var(--foreground)' }}>
              <span className="line-through opacity-60">{merged.title}</span>
              <span className="mx-2">→</span>
              <span className="font-medium">{merged.kept_event_title}</span>
            </p>
            <div className="flex flex-wrap gap-2 mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              <span>{formatDate(merged.event_date)}</span>
              {merged.source_name && <span>• {merged.source_name}</span>}
              {merged.child_name && <span>• {merged.child_name}</span>}
              <span>• {confidence}% {t.feed.duplicates.probability}</span>
            </div>
          </div>
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--muted)' }}>
            {formatRelativeTime(merged.merged_at)}
          </span>
        </div>
      </div>

      {/* Undo button */}
      <button
        onClick={() => onUndo(merged.id)}
        disabled={loading}
        className="flex-shrink-0 px-3 py-1 text-xs font-medium rounded-lg transition-colors"
        style={{
          background: 'var(--card)',
          color: 'var(--primary)',
          opacity: loading ? 0.5 : 1,
        }}
      >
        {loading ? t.feed.duplicates.undoing : t.feed.duplicates.undo}
      </button>
    </div>
  )
}

interface MergedListProps {
  mergedDuplicates: MergedDuplicate[]
  onUpdate: () => void
}

export function MergedDuplicatesList({ mergedDuplicates, onUpdate }: MergedListProps) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const [restoredIds, setRestoredIds] = useState<Set<string>>(new Set())
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleUndo = useCallback(async (id: string) => {
    setLoadingId(id)
    setErrorMessage(null)

    // Clear any existing timer
    if (timerRef.current) clearTimeout(timerRef.current)

    try {
      const supabase = createClient()

      // Restore the hidden event by clearing duplicate_of_id and is_hidden
      const { error } = await supabase
        .from('external_events')
        .update({
          duplicate_of_id: null,
          is_hidden: false,
          duplicate_confidence: null,
        })
        .eq('id', id)

      if (error) {
        console.error('Error undoing merge:', error)
        setErrorMessage(t.feed.duplicates.couldNotRestore)
        timerRef.current = setTimeout(() => setErrorMessage(null), 5000)
        return
      }

      setRestoredIds((prev) => new Set(prev).add(id))
      setSuccessMessage(t.feed.duplicates.eventRestored)
      timerRef.current = setTimeout(() => setSuccessMessage(null), 3000)
      onUpdate()
    } catch (error) {
      console.error('Error undoing merge:', error)
      setErrorMessage(t.feed.duplicates.couldNotRestore)
      timerRef.current = setTimeout(() => setErrorMessage(null), 5000)
    } finally {
      setLoadingId(null)
    }
  }, [onUpdate, t.feed.duplicates])

  const visibleMerged = mergedDuplicates.filter((m) => !restoredIds.has(m.id))

  if (visibleMerged.length === 0) {
    return null
  }

  return (
    <section className="space-y-3">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 rounded-lg transition-colors"
        style={{ background: 'var(--card)' }}
      >
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{
              color: 'var(--muted)',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
            {t.feed.duplicates.mergedTitle}
          </span>
          <span
            className="px-2 py-0.5 text-xs rounded-full"
            style={{ background: 'var(--color-sky)', color: 'white' }}
          >
            {visibleMerged.length}
          </span>
        </div>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {expanded ? t.feed.duplicates.hide : t.feed.duplicates.show}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-2">
          {errorMessage && (
            <div
              className="p-3 rounded-lg flex items-center gap-2"
              style={{ background: 'rgba(232, 140, 140, 0.2)', color: 'var(--color-coral)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {errorMessage}
            </div>
          )}

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

          <p className="text-xs px-1" style={{ color: 'var(--muted)' }}>
            {t.feed.duplicates.mergedExplanation}
          </p>

          {visibleMerged.map((merged) => (
            <MergedDuplicateCard
              key={merged.id}
              merged={merged}
              onUndo={handleUndo}
              loading={loadingId === merged.id}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default MergedDuplicatesList
