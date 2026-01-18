'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import { getLocale } from '@/lib/utils'

export interface EventNotification {
  id: string
  household_id: string
  change_type: 'removed' | 'date_changed' | 'title_changed'
  source_url_id: string | null
  source_name: string | null
  original_title: string
  original_date: string
  original_end_date: string | null
  original_time: string | null
  original_description: string | null
  child_id: string | null
  child_name: string | null
  deleted_task_id: string | null
  deleted_task_type: string | null
  deleted_task_title: string | null
  status: 'unread' | 'read' | 'restored' | 'dismissed'
  created_at: string
}

interface CardProps {
  notification: EventNotification
  onDismiss: (id: string) => Promise<boolean>
  onRestore: (id: string) => Promise<{ success: boolean; eventId?: string; error?: string }>
  isAnimatingOut: boolean
}

export function EventChangeNotificationCard({
  notification,
  onDismiss,
  onRestore,
  isAnimatingOut,
}: CardProps) {
  const [loading, setLoading] = useState(false)
  const { t, language } = useLanguage()

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString(getLocale(language), {
      day: 'numeric',
      month: 'short',
    })
  }

  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return null
    return timeStr.slice(0, 5) // HH:MM
  }

  const isRemoved = notification.change_type === 'removed'
  const accentColor = isRemoved ? 'var(--color-coral)' : 'var(--color-honey)'
  const accentBg = isRemoved ? 'rgba(239, 137, 118, 0.2)' : 'rgba(219, 185, 108, 0.2)'
  const cardBg =
    notification.status === 'unread'
      ? isRemoved
        ? 'rgba(239, 137, 118, 0.1)'
        : 'rgba(219, 185, 108, 0.1)'
      : 'var(--card)'

  const getChangeIcon = () => {
    if (isRemoved) {
      return (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      )
    }
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    )
  }

  const getChangeMessage = () => {
    switch (notification.change_type) {
      case 'removed':
        return t.feed.eventRemoved
      case 'date_changed':
        return t.feed.dateChanged
      case 'title_changed':
        return t.feed.titleChanged
    }
  }

  // Validate if restore is possible
  const isPastDate = () => {
    const eventDate = new Date(notification.original_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return eventDate < today
  }

  const handleDismiss = async () => {
    setLoading(true)
    try {
      await onDismiss(notification.id)
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async () => {
    // Warn about past dates
    if (isPastDate()) {
      const confirm = window.confirm(t.feed.pastDateWarning)
      if (!confirm) return
    }

    setLoading(true)
    try {
      await onRestore(notification.id)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent, action: 'restore' | 'dismiss') => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (action === 'restore') handleRestore()
      else handleDismiss()
    }
  }

  return (
    <article
      className={`card p-4 border-l-4 transition-all duration-300 ${
        isAnimatingOut ? 'opacity-0 scale-95 -translate-x-2' : 'opacity-100 scale-100 translate-x-0'
      }`}
      style={{
        borderLeftColor: accentColor,
        background: cardBg,
      }}
      role="alert"
      aria-labelledby={`notification-title-${notification.id}`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: accentBg, color: accentColor }}
          aria-hidden="true"
        >
          {getChangeIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <p
            id={`notification-title-${notification.id}`}
            className="font-medium text-sm"
            style={{ color: 'var(--foreground)' }}
          >
            {getChangeMessage()}
          </p>
          {notification.source_name && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {notification.source_name}
            </p>
          )}
        </div>
        <time
          className="text-xs flex-shrink-0"
          style={{ color: 'var(--muted)' }}
          dateTime={notification.created_at}
        >
          {formatDate(notification.created_at)}
        </time>
      </div>

      {/* Event details */}
      <div className="p-3 rounded-lg mb-3" style={{ background: 'var(--background)' }}>
        <p className="font-medium" style={{ color: 'var(--foreground)' }}>
          {notification.original_title}
        </p>
        <div className="flex flex-wrap gap-2 mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          <span className="flex items-center gap-1">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <time dateTime={notification.original_date}>{formatDate(notification.original_date)}</time>
            {notification.original_end_date &&
              notification.original_end_date !== notification.original_date && (
                <>
                  {' '}
                  -{' '}
                  <time dateTime={notification.original_end_date}>
                    {formatDate(notification.original_end_date)}
                  </time>
                </>
              )}
          </span>
          {notification.original_time && (
            <span className="flex items-center gap-1">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <time>{formatTime(notification.original_time)}</time>
            </span>
          )}
          {notification.child_name && (
            <span className="flex items-center gap-1">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              {notification.child_name}
            </span>
          )}
        </div>
        {notification.deleted_task_title && (
          <p className="mt-2 text-sm" style={{ color: 'var(--color-coral)' }}>
            {t.feed.taskWasDeleted.replace('{title}', notification.deleted_task_title)}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2" role="group" aria-label={t.feed.calendarChanges}>
        <button
          onClick={handleRestore}
          onKeyDown={(e) => handleKeyDown(e, 'restore')}
          disabled={loading}
          className="btn btn-primary text-sm flex-1"
          aria-busy={loading}
        >
          {loading ? t.feed.restoring : t.feed.restoreEvent}
        </button>
        <button
          onClick={handleDismiss}
          onKeyDown={(e) => handleKeyDown(e, 'dismiss')}
          disabled={loading}
          className="btn btn-secondary text-sm"
        >
          {t.feed.dismissNotification}
        </button>
      </div>
    </article>
  )
}

interface NotificationListProps {
  notifications: EventNotification[]
  onDismiss: (id: string) => Promise<boolean>
  onRestore: (id: string) => Promise<{ success: boolean; eventId?: string; error?: string }>
  onDismissAll: () => Promise<{ success: boolean; count: number }>
  onRestoreAll: () => Promise<{ success: boolean; count: number; eventIds?: string[] }>
  syncing?: boolean
}

// Show only 2 notifications by default, collapse the rest
// This keeps the feed cleaner - users can expand to see more
const COLLAPSE_THRESHOLD = 2
/** Animation duration in milliseconds for fade-out transitions */
const ANIMATION_DURATION_MS = 300

export function EventChangeNotificationList({
  notifications,
  onDismiss,
  onRestore,
  onDismissAll,
  onRestoreAll,
  syncing = false,
}: NotificationListProps) {
  const [expanded, setExpanded] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [animatingOutIds, setAnimatingOutIds] = useState<Set<string>>(new Set())
  const { t } = useLanguage()

  // Track which notifications are visible (not yet animated out)
  // Memoized to prevent re-filtering on every render
  const visibleNotifications = useMemo(
    () =>
      notifications.filter(
        (n) =>
          (n.status === 'unread' || n.status === 'read') && !animatingOutIds.has(n.id)
      ),
    [notifications, animatingOutIds]
  )

  const pendingCount = visibleNotifications.length

  // Handle single dismiss with animation
  const handleDismiss = useCallback(
    async (id: string) => {
      // Start animation
      setAnimatingOutIds((prev) => new Set(prev).add(id))

      // Wait for animation then call actual dismiss
      await new Promise((resolve) => setTimeout(resolve, ANIMATION_DURATION_MS))
      const success = await onDismiss(id)

      if (!success) {
        // Rollback animation if failed
        setAnimatingOutIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }

      return success
    },
    [onDismiss]
  )

  // Handle single restore with animation
  const handleRestore = useCallback(
    async (id: string) => {
      // Start animation
      setAnimatingOutIds((prev) => new Set(prev).add(id))

      // Wait for animation then call actual restore
      await new Promise((resolve) => setTimeout(resolve, ANIMATION_DURATION_MS))
      const result = await onRestore(id)

      if (result.success) {
        const notification = notifications.find((n) => n.id === id)
        if (notification) {
          const msg = t.feed.eventRestoredSuccess.replace('{title}', notification.original_title)
          setSuccessMessage(msg)
          setTimeout(() => setSuccessMessage(null), 3000)
        }
      } else {
        // Rollback animation if failed
        setAnimatingOutIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }

      return result
    },
    [onRestore, notifications, t.feed.eventRestoredSuccess]
  )

  // Handle dismiss all with animation
  const handleDismissAll = useCallback(async () => {
    // Animate all out
    const ids = visibleNotifications.map((n) => n.id)
    setAnimatingOutIds(new Set(ids))

    // Wait for animation
    await new Promise((resolve) => setTimeout(resolve, ANIMATION_DURATION_MS))

    const result = await onDismissAll()

    if (result.success) {
      setSuccessMessage(t.feed.allDismissed)
      setTimeout(() => setSuccessMessage(null), 3000)
    } else {
      // Rollback
      setAnimatingOutIds(new Set())
    }
  }, [visibleNotifications, onDismissAll, t.feed.allDismissed])

  // Handle restore all with confirmation and animation
  const handleRestoreAll = useCallback(async () => {
    // Confirmation dialog
    const confirmMessage = t.feed.confirmRestoreAll.replace('{count}', String(pendingCount))
    if (!window.confirm(confirmMessage)) {
      return
    }

    // Animate all out
    const ids = visibleNotifications.map((n) => n.id)
    setAnimatingOutIds(new Set(ids))

    // Wait for animation
    await new Promise((resolve) => setTimeout(resolve, ANIMATION_DURATION_MS))

    const result = await onRestoreAll()

    if (result.success) {
      const msg = t.feed.allRestored.replace('{count}', String(result.count))
      setSuccessMessage(msg)
      setTimeout(() => setSuccessMessage(null), 3000)
    } else {
      // Rollback
      setAnimatingOutIds(new Set())
    }
  }, [visibleNotifications, pendingCount, onRestoreAll, t.feed.confirmRestoreAll, t.feed.allRestored])

  if (pendingCount === 0 && !successMessage) {
    return null
  }

  const shouldCollapse = pendingCount > COLLAPSE_THRESHOLD && !expanded
  const displayNotifications = shouldCollapse
    ? visibleNotifications.slice(0, COLLAPSE_THRESHOLD)
    : visibleNotifications

  return (
    <section className="space-y-3" aria-labelledby="calendar-changes-heading">
      {/* Header with batch actions */}
      <div className="flex items-center justify-between gap-2">
        <h2
          id="calendar-changes-heading"
          className="text-lg font-semibold"
          style={{ color: 'var(--foreground)' }}
        >
          {t.feed.calendarChanges}
          {pendingCount > 0 && (
            <span
              className="ml-2 px-2 py-0.5 text-xs rounded-full"
              style={{ background: 'var(--color-coral)', color: 'white' }}
              aria-label={`${pendingCount} notifications`}
            >
              {pendingCount}
            </span>
          )}
        </h2>

        {/* Batch action buttons */}
        {pendingCount > 1 && (
          <div className="flex gap-2">
            <button
              onClick={handleRestoreAll}
              disabled={syncing}
              className="btn btn-secondary text-xs px-3 py-1.5"
              title={t.feed.restoreAll}
            >
              {syncing ? t.feed.restoringAll : t.feed.restoreAll}
            </button>
            <button
              onClick={handleDismissAll}
              disabled={syncing}
              className="btn btn-secondary text-xs px-3 py-1.5"
              title={t.feed.dismissAll}
            >
              {syncing ? t.feed.dismissingAll : t.feed.dismissAll}
            </button>
          </div>
        )}
      </div>

      {/* Success feedback toast */}
      {successMessage && (
        <div
          className="p-3 rounded-lg flex items-center gap-2 transition-opacity duration-300"
          style={{ background: 'rgba(142, 197, 158, 0.2)', color: 'var(--color-sage)' }}
          role="status"
          aria-live="polite"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {successMessage}
        </div>
      )}

      {/* Notification cards */}
      <div className="space-y-3">
        {displayNotifications.map((notification) => (
          <EventChangeNotificationCard
            key={notification.id}
            notification={notification}
            onDismiss={handleDismiss}
            onRestore={handleRestore}
            isAnimatingOut={animatingOutIds.has(notification.id)}
          />
        ))}
      </div>

      {/* Show more/less button */}
      {pendingCount > COLLAPSE_THRESHOLD && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full py-2 text-sm font-medium rounded-lg"
          style={{ color: 'var(--primary)', background: 'var(--background)' }}
        >
          {expanded
            ? t.feed.showFewerNotifications
            : t.feed.showAllNotifications.replace(
                '{count}',
                String(pendingCount - COLLAPSE_THRESHOLD)
              )}
        </button>
      )}
    </section>
  )
}
