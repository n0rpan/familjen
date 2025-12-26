'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

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
  onRestore: (id: string) => void
}

export function EventChangeNotificationCard({ notification, onDismiss, onRestore }: Props) {
  const [loading, setLoading] = useState(false)

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('nb-NO', {
      day: 'numeric',
      month: 'short',
    })
  }

  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return null
    return timeStr.slice(0, 5) // HH:MM
  }

  const getChangeIcon = () => {
    switch (notification.change_type) {
      case 'removed':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        )
      case 'date_changed':
      case 'title_changed':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )
    }
  }

  const getChangeMessage = () => {
    switch (notification.change_type) {
      case 'removed':
        return 'Hendelse fjernet fra kalenderkilde'
      case 'date_changed':
        return 'Dato endret i kalenderkilde'
      case 'title_changed':
        return 'Tittel endret i kalenderkilde'
    }
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
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('restore_removed_event', {
        p_notification_id: notification.id,
      })

      if (error) {
        console.error('Error restoring event:', error)
        return
      }

      onRestore(notification.id)
    } catch (error) {
      console.error('Error restoring event:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="card p-4 border-l-4"
      style={{
        borderLeftColor: 'var(--color-honey)',
        background: notification.status === 'unread' ? 'rgba(219, 185, 108, 0.1)' : 'var(--card)',
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(219, 185, 108, 0.2)', color: 'var(--color-honey)' }}
        >
          {getChangeIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
            {getChangeMessage()}
          </p>
          {notification.source_name && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {notification.source_name}
            </p>
          )}
        </div>
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--muted)' }}>
          {formatDate(notification.created_at)}
        </span>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {formatDate(notification.original_date)}
            {notification.original_end_date && notification.original_end_date !== notification.original_date && (
              <> - {formatDate(notification.original_end_date)}</>
            )}
          </span>
          {notification.original_time && (
            <span className="flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatTime(notification.original_time)}
            </span>
          )}
          {notification.child_name && (
            <span className="flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              {notification.child_name}
            </span>
          )}
        </div>
        {notification.deleted_task_title && (
          <p className="mt-2 text-sm" style={{ color: 'var(--color-coral)' }}>
            Oppgaven &quot;{notification.deleted_task_title}&quot; ble fjernet
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleRestore}
          disabled={loading}
          className="btn btn-primary text-sm flex-1"
        >
          {loading ? 'Legger til...' : 'Legg til på nytt'}
        </button>
        <button
          onClick={handleDismiss}
          disabled={loading}
          className="btn btn-secondary text-sm"
        >
          Avvis
        </button>
      </div>
    </div>
  )
}

interface NotificationListProps {
  notifications: EventNotification[]
  onUpdate: () => void
}

export function EventChangeNotificationList({ notifications, onUpdate }: NotificationListProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id))
    onUpdate()
  }

  const handleRestore = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id))
    onUpdate()
  }

  const visibleNotifications = notifications.filter((n) => !dismissedIds.has(n.id))

  if (visibleNotifications.length === 0) {
    return null
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
        Kalenderendringer
      </h2>
      {visibleNotifications.map((notification) => (
        <EventChangeNotificationCard
          key={notification.id}
          notification={notification}
          onDismiss={handleDismiss}
          onRestore={handleRestore}
        />
      ))}
    </section>
  )
}
