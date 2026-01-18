'use client'

/**
 * FeedPageContent Component
 *
 * Shared UI component for the feed page.
 * Used by both production (with Supabase data) and demo mode (with hook data).
 * This ensures visual consistency between demo and production.
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useLanguage } from '@/lib/i18n/context'
import { FeedFilters, type FeedFilter } from './FeedFilters'
import { FeedSearch } from './FeedSearch'
import { MessageCard, type FeedMessage } from './MessageCard'
import { PhotoGallery, type FeedPhoto } from './PhotoGallery'
import { ReminderCard, type FeedReminder } from './ReminderCard'
import { EventChangeNotificationList, type EventNotification } from './EventChangeNotification'
import { SyncStatusBanner, type IntegrationStatus } from './SyncStatusBanner'
import type { DuplicateSuggestion } from './DuplicateSuggestions'
import type { MergedDuplicate } from './MergedDuplicates'

// Dynamic imports for code splitting - these are rarely shown (only when duplicates exist)
const DuplicateSuggestionsList = dynamic(
  () => import('./DuplicateSuggestions').then(mod => mod.DuplicateSuggestionsList),
  { ssr: false }
)
const MergedDuplicatesList = dynamic(
  () => import('./MergedDuplicates').then(mod => mod.MergedDuplicatesList),
  { ssr: false }
)

// Integration children mapping (which children belong to which integrations)
export interface IntegrationChild {
  integrationId: string
  childId: string
  childName: string
  groupName: string | null
}

export interface DeduplicationResult {
  autoMerged: number
  suggestionsCreated: number
  pairsChecked: number
}

export interface FeedPageContentProps {
  // Data
  messages: FeedMessage[]
  photos: FeedPhoto[]
  reminders: FeedReminder[]
  notifications: EventNotification[]
  integrationChildren: IntegrationChild[]
  integrationStatuses: IntegrationStatus[]

  // Duplicate management
  duplicateSuggestions?: DuplicateSuggestion[]
  mergedDuplicates?: MergedDuplicate[]

  // Initial state
  initialFilter?: FeedFilter

  // Callbacks (optional - for mutations)
  onToggleReminder?: (id: string, completed: boolean) => void
  onSync?: () => Promise<void>
  onDeduplicate?: () => Promise<DeduplicationResult | null>
  onDuplicatesUpdate?: () => void

  // Notification callbacks (optimistic updates)
  onDismissNotification?: (id: string) => Promise<boolean>
  onRestoreNotification?: (id: string) => Promise<{ success: boolean; eventId?: string; error?: string }>
  onDismissAllNotifications?: () => Promise<{ success: boolean; count: number }>
  onRestoreAllNotifications?: () => Promise<{ success: boolean; count: number; eventIds?: string[] }>
  notificationsSyncing?: boolean

  // Demo mode
  isDemo?: boolean
}

export function FeedPageContent({
  messages,
  photos,
  reminders,
  notifications,
  integrationChildren,
  integrationStatuses,
  duplicateSuggestions = [],
  mergedDuplicates = [],
  initialFilter = 'all',
  onToggleReminder,
  onSync,
  onDeduplicate,
  onDuplicatesUpdate,
  onDismissNotification,
  onRestoreNotification,
  onDismissAllNotifications,
  onRestoreAllNotifications,
  notificationsSyncing = false,
  isDemo = false,
}: FeedPageContentProps) {
  const { t, language } = useLanguage()
  const [activeFilter, setActiveFilter] = useState<FeedFilter>(initialFilter)
  const [syncing, setSyncing] = useState(false)
  const [deduplicating, setDeduplicating] = useState(false)
  const [dedupeResult, setDedupeResult] = useState<DeduplicationResult | null>(null)
  const [dedupeError, setDedupeError] = useState<string | null>(null)
  const dedupeTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup timer on unmount
  useEffect(() => {
    const timer = dedupeTimerRef.current
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Handle sync
  const handleSync = async () => {
    if (!onSync) return
    setSyncing(true)
    try {
      await onSync()
    } finally {
      setSyncing(false)
    }
  }

  // Handle manual deduplication
  const handleDeduplicate = async () => {
    if (!onDeduplicate) return
    setDeduplicating(true)
    setDedupeResult(null)
    setDedupeError(null)
    // Clear any existing timer
    if (dedupeTimerRef.current) {
      clearTimeout(dedupeTimerRef.current)
    }
    try {
      const result = await onDeduplicate()
      if (result) {
        setDedupeResult(result)
        // Clear result after 10 seconds
        dedupeTimerRef.current = setTimeout(() => setDedupeResult(null), 10000)
      } else {
        setDedupeError(t.feed.duplicates.couldNotStartSearch)
      }
    } catch {
      setDedupeError(t.feed.duplicates.couldNotStartSearch)
    } finally {
      setDeduplicating(false)
    }
  }

  // Calculate counts AND pre-filter messages in a single pass
  const { counts, messagesByService } = useMemo(() => {
    const byService = {
      spond: [] as FeedMessage[],
      school: [] as FeedMessage[],
      kindergarten: [] as FeedMessage[],
    }

    // Single pass through messages
    for (const m of messages) {
      if (m.service === 'spond') {
        byService.spond.push(m)
      } else if (m.service === 'iskole') {
        byService.school.push(m)
      } else if (m.service === 'kidplan' || m.service === 'mykid') {
        byService.kindergarten.push(m)
      }
    }

    return {
      counts: {
        all: messages.length + photos.length + reminders.length,
        spond: byService.spond.length,
        school: byService.school.length,
        kindergarten: byService.kindergarten.length,
        photos: photos.length,
        reminders: reminders.length,
      },
      messagesByService: byService,
    }
  }, [messages, photos.length, reminders.length])

  // Get filtered messages from pre-computed groups
  const filteredMessages = useMemo(() => {
    switch (activeFilter) {
      case 'spond':
        return messagesByService.spond
      case 'school':
        return messagesByService.school
      case 'kindergarten':
        return messagesByService.kindergarten
      case 'photos':
      case 'reminders':
        return []
      default:
        return messages
    }
  }, [messages, messagesByService, activeFilter])

  // Memoize sliced arrays to prevent new array creation on every render
  const displayPhotos = useMemo(
    () => (activeFilter === 'all' ? photos.slice(0, 8) : photos),
    [photos, activeFilter]
  )
  const displayReminders = useMemo(
    () => (activeFilter === 'all' ? reminders.slice(0, 5) : reminders),
    [reminders, activeFilter]
  )

  const showPhotos = activeFilter === 'all' || activeFilter === 'photos'
  const showReminders = activeFilter === 'all' || activeFilter === 'reminders'
  const showMessages = activeFilter !== 'photos' && activeFilter !== 'reminders'

  const hasNoContent = messages.length === 0 && photos.length === 0 && reminders.length === 0

  return (
    <div className="space-y-6">
      {/* Smart search - only in production */}
      {!isDemo && <FeedSearch />}

      {/* Sync failure banner - only in production */}
      {!isDemo && <SyncStatusBanner integrations={integrationStatuses} />}

      {/* Header with sync button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <FeedFilters
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          counts={counts}
        />
        <div className="flex gap-2 self-end sm:self-auto">
          {onDeduplicate && (
            <button
              onClick={handleDeduplicate}
              disabled={deduplicating || isDemo}
              className="btn btn-secondary text-sm flex-shrink-0"
              style={isDemo ? { opacity: 0.5 } : undefined}
              title={t.feed.duplicates.findDuplicates}
            >
              {deduplicating ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {t.feed.duplicates.searching}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <path d="M14 14h7v7h-7z" opacity="0.5" />
                    <path d="M7 14l-4 4m0-4l4 4" strokeLinecap="round" />
                  </svg>
                  {t.feed.duplicates.findDuplicates}
                </span>
              )}
            </button>
          )}
          {onSync && (
            <button
              onClick={handleSync}
              disabled={syncing || isDemo}
              className="btn btn-secondary text-sm flex-shrink-0"
              style={isDemo ? { opacity: 0.5 } : undefined}
            >
              {syncing ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Synker...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  Oppdater
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Deduplication error banner */}
      {dedupeError && (
        <div
          className="p-4 rounded-xl flex items-start gap-3"
          style={{
            background: 'rgba(232, 140, 140, 0.2)',
            border: '1px solid var(--color-coral)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-coral)', flexShrink: 0, marginTop: 2 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="font-medium" style={{ color: 'var(--foreground)' }}>{dedupeError}</p>
          <button
            onClick={() => setDedupeError(null)}
            className="ml-auto p-1 rounded hover:bg-white/10"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Deduplication result banner */}
      {dedupeResult && (
        <div
          className="p-4 rounded-xl flex items-start gap-3"
          style={{
            background: dedupeResult.autoMerged > 0 ? 'rgba(172, 203, 163, 0.2)' : 'rgba(126, 182, 196, 0.2)',
            border: `1px solid ${dedupeResult.autoMerged > 0 ? 'var(--color-sage)' : 'var(--color-sky)'}`,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: dedupeResult.autoMerged > 0 ? 'var(--color-sage)' : 'var(--color-sky)', flexShrink: 0, marginTop: 2 }}>
            {dedupeResult.autoMerged > 0 ? (
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <circle cx="12" cy="12" r="10" />
            )}
          </svg>
          <div>
            <p className="font-medium" style={{ color: 'var(--foreground)' }}>
              {dedupeResult.autoMerged > 0
                ? t.feed.duplicates.autoMerged.replace('{count}', String(dedupeResult.autoMerged))
                : t.feed.duplicates.noDuplicatesFound}
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {t.feed.duplicates.pairsChecked.replace('{count}', String(dedupeResult.pairsChecked))}
              {dedupeResult.suggestionsCreated > 0 && (
                <> &bull; {t.feed.duplicates.suggestionsNeedReview.replace('{count}', String(dedupeResult.suggestionsCreated))}</>
              )}
            </p>
          </div>
          <button
            onClick={() => setDedupeResult(null)}
            className="ml-auto p-1 rounded hover:bg-white/10"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Duplicate suggestions for review - only in production */}
      {!isDemo && duplicateSuggestions.length > 0 && activeFilter === 'all' && (
        <DuplicateSuggestionsList
          suggestions={duplicateSuggestions}
          onUpdate={onDuplicatesUpdate || (() => {})}
        />
      )}

      {/* Recently merged duplicates (collapsible) - only in production */}
      {!isDemo && mergedDuplicates.length > 0 && activeFilter === 'all' && (
        <MergedDuplicatesList
          mergedDuplicates={mergedDuplicates}
          onUpdate={onDuplicatesUpdate || (() => {})}
        />
      )}

      {/* Empty state */}
      {hasNoContent && notifications.length === 0 ? (
        <div
          className="card p-8 text-center"
          style={{
            border: '2px dashed var(--border)',
            background: 'transparent',
          }}
        >
          <div className="mb-4">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--muted)', margin: '0 auto' }}
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            Ingen meldinger ennå
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            {isDemo
              ? 'Meldinger fra integrasjoner vil vises her'
              : 'Koble til Spond, Kidplan eller iSkole i innstillingene for å se meldinger her.'}
          </p>
        </div>
      ) : (
        <>
          {/* Photos section */}
          {showPhotos && photos.length > 0 && (
            <section>
              {activeFilter === 'all' && (
                <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
                  Siste bilder
                </h2>
              )}
              <PhotoGallery photos={displayPhotos} />
              {activeFilter === 'all' && photos.length > 8 && (
                <button
                  onClick={() => setActiveFilter('photos')}
                  className="w-full mt-3 py-2 text-sm font-medium rounded-xl"
                  style={{ color: 'var(--accent)', background: 'var(--background)' }}
                >
                  Se alle {photos.length} bilder
                </button>
              )}
            </section>
          )}

          {/* Reminders section */}
          {showReminders && reminders.length > 0 && (
            <section>
              {activeFilter === 'all' && (
                <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
                  Påminnelser
                </h2>
              )}
              <div className="space-y-2">
                {displayReminders.map((reminder) => (
                  <ReminderCard
                    key={reminder.id}
                    reminder={reminder}
                    onToggle={onToggleReminder}
                  />
                ))}
              </div>
              {activeFilter === 'all' && reminders.length > 5 && (
                <button
                  onClick={() => setActiveFilter('reminders')}
                  className="w-full mt-3 py-2 text-sm font-medium rounded-xl"
                  style={{ color: 'var(--accent)', background: 'var(--background)' }}
                >
                  Se alle {reminders.length} påminnelser
                </button>
              )}
            </section>
          )}

          {/* Messages section */}
          {showMessages && filteredMessages.length > 0 && (
            <section>
              {activeFilter === 'all' && (
                <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
                  Meldinger
                </h2>
              )}
              <div className="space-y-3">
                {filteredMessages.map((message) => (
                  <MessageCard
                    key={message.id}
                    message={message}
                    integrationChildren={integrationChildren}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Event change notifications (calendar source removals) - shown at bottom, collapsed by default */}
          {!isDemo && notifications.length > 0 && activeFilter === 'all' && (
            <EventChangeNotificationList
              notifications={notifications}
              onDismiss={onDismissNotification || (async () => false)}
              onRestore={onRestoreNotification || (async () => ({ success: false }))}
              onDismissAll={onDismissAllNotifications || (async () => ({ success: false, count: 0 }))}
              onRestoreAll={onRestoreAllNotifications || (async () => ({ success: false, count: 0 }))}
              syncing={notificationsSyncing}
            />
          )}

          {/* No results for current filter */}
          {!hasNoContent &&
            ((activeFilter === 'photos' && photos.length === 0) ||
              (activeFilter === 'reminders' && reminders.length === 0) ||
              (showMessages && filteredMessages.length === 0)) && (
              <div
                className="p-8 text-center rounded-xl"
                style={{ background: 'var(--background)' }}
              >
                <p style={{ color: 'var(--muted)' }}>
                  Ingen{' '}
                  {activeFilter === 'photos'
                    ? 'bilder'
                    : activeFilter === 'reminders'
                    ? 'påminnelser'
                    : 'meldinger'}{' '}
                  å vise
                </p>
              </div>
            )}
        </>
      )}
    </div>
  )
}
