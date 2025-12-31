'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
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

interface Props {
  notification: EventNotification
  onDismiss: (id: string) => void
  onRestore: (id: string, success: boolean, message?: string) => void
}

export function EventChangeNotificationCard({ notification, onDismiss, onRestore }: Props) {
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
  const cardBg = notification.status === 'unread'
    ? (isRemoved ? 'rgba(239, 137, 118, 0.1)' : 'rgba(219, 185, 108, 0.1)')
    : 'var(--card)'

  const getChangeIcon = () => {
    if (isRemoved) {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      )
    }
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      const supabase = createClient()
      await supabase
        .from('event_change_notifications')
        .update({ status: 'dismissed' })
        .eq('id', notification.id)
      onDismiss(notification.id)
    } catch (error) {
      console.error('Error dismissing notification:', error)
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
      const supabase = createClient()
      const { error } = await supabase.rpc('restore_removed_event', {
        p_notification_id: notification.id,
      })

      if (error) {
        console.error('Error restoring event:', error)
        onRestore(notification.id, false, error.message)
        return
      }

      // Success feedback
      const successMessage = t.feed.eventRestoredSuccess.replace('{title}', notification.original_title)
      onRestore(notification.id, true, successMessage)
    } catch (error) {
      console.error('Error restoring event:', error)
      onRestore(notification.id, false)
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
      className="card p-4 border-l-4"
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
      <div
        className="p-3 rounded-lg mb-3"
        style={{ background: 'var(--background)' }}
      >
        <p className="font-medium" style={{ color: 'var(--foreground)' }}>
          {notification.original_title}
        </p>
        <div className="flex flex-wrap gap-2 mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          <span className="flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <time dateTime={notification.original_date}>{formatDate(notification.original_date)}</time>
            {notification.original_end_date && notification.original_end_date !== notification.original_date && (
              <> - <time dateTime={notification.original_end_date}>{formatDate(notification.original_end_date)}</time></>
            )}
          </span>
          {notification.original_time && (
            <span className="flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <time>{formatTime(notification.original_time)}</time>
            </span>
          )}
          {notification.child_name && (
            <span className="flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
  onUpdate: () => void
}

const COLLAPSE_THRESHOLD = 5

export function EventChangeNotificationList({ notifications, onUpdate }: NotificationListProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const { t } = useLanguage()

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id))
    onUpdate()
  }, [onUpdate])

  const handleRestore = useCallback((id: string, success: boolean, message?: string) => {
    setDismissedIds((prev) => new Set(prev).add(id))
    if (success && message) {
      setSuccessMessage(message)
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    }
    onUpdate()
  }, [onUpdate])

  const visibleNotifications = notifications.filter((n) => !dismissedIds.has(n.id))

  if (visibleNotifications.length === 0) {
    return null
  }

  const shouldCollapse = visibleNotifications.length > COLLAPSE_THRESHOLD && !expanded
  const displayNotifications = shouldCollapse
    ? visibleNotifications.slice(0, COLLAPSE_THRESHOLD)
    : visibleNotifications

  return (
    <section className="space-y-3" aria-labelledby="calendar-changes-heading">
      <h2
        id="calendar-changes-heading"
        className="text-lg font-semibold"
        style={{ color: 'var(--foreground)' }}
      >
        {t.feed.calendarChanges}
        {visibleNotifications.length > 0 && (
          <span
            className="ml-2 px-2 py-0.5 text-xs rounded-full"
            style={{ background: 'var(--color-coral)', color: 'white' }}
            aria-label={`${visibleNotifications.length} notifications`}
          >
            {visibleNotifications.length}
          </span>
        )}
      </h2>

      {/* Success feedback toast */}
      {successMessage && (
        <div
          className="p-3 rounded-lg flex items-center gap-2"
          style={{ background: 'rgba(142, 197, 158, 0.2)', color: 'var(--color-sage)' }}
          role="status"
          aria-live="polite"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {successMessage}
        </div>
      )}

      {displayNotifications.map((notification) => (
        <EventChangeNotificationCard
          key={notification.id}
          notification={notification}
          onDismiss={handleDismiss}
          onRestore={handleRestore}
        />
      ))}

      {/* Show more/less button */}
      {visibleNotifications.length > COLLAPSE_THRESHOLD && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full py-2 text-sm font-medium rounded-lg"
          style={{ color: 'var(--primary)', background: 'var(--background)' }}
        >
          {expanded
            ? t.feed.showFewerNotifications
            : t.feed.showAllNotifications.replace('{count}', String(visibleNotifications.length - COLLAPSE_THRESHOLD))
          }
        </button>
      )}
    </section>
  )
}
