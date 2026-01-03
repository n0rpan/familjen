'use client'

/**
 * useEventNotifications Hook
 *
 * Manages event change notifications with optimistic updates.
 * No page reload on dismiss/restore - instant UI feedback.
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { EventNotification } from '@/components/feed/EventChangeNotification'

export interface UseEventNotificationsReturn {
  // Data
  notifications: EventNotification[]
  pendingCount: number

  // State
  loading: boolean
  syncing: boolean
  error: string | null

  // Single actions (optimistic)
  dismiss: (id: string) => Promise<boolean>
  restore: (id: string) => Promise<{ success: boolean; eventId?: string; error?: string }>

  // Batch actions
  dismissAll: () => Promise<{ success: boolean; count: number }>
  restoreAll: () => Promise<{ success: boolean; count: number; eventIds?: string[] }>

  // Manual refresh (for initial load)
  refresh: () => Promise<void>

  /**
   * Set notifications from external source (e.g., useFeed).
   * Validates input is an array of valid EventNotification objects.
   */
  setNotifications: (notifications: EventNotification[]) => void
}

/**
 * Hook to manage event notifications with optimistic updates
 */
export function useEventNotifications(
  initialNotifications: EventNotification[] = []
): UseEventNotificationsReturn {
  const [notifications, setNotificationsInternal] = useState<EventNotification[]>(initialNotifications)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Validated setter for notifications.
   * Ensures input is an array of objects with required fields.
   */
  const setNotifications = useCallback((newNotifications: EventNotification[]) => {
    if (!Array.isArray(newNotifications)) {
      console.error('setNotifications: expected array, got', typeof newNotifications)
      return
    }
    // Validate each notification has required fields
    const valid = newNotifications.filter((n) => {
      if (!n || typeof n !== 'object') return false
      if (typeof n.id !== 'string' || !n.id) return false
      if (!['unread', 'read', 'restored', 'dismissed'].includes(n.status)) return false
      return true
    })
    if (valid.length !== newNotifications.length) {
      console.warn(
        `setNotifications: filtered ${newNotifications.length - valid.length} invalid notifications`
      )
    }
    setNotificationsInternal(valid)
  }, [])

  // Sync initial notifications when they change
  useEffect(() => {
    if (initialNotifications.length > 0) {
      setNotifications(initialNotifications)
    }
  }, [initialNotifications, setNotifications])

  const supabase = useMemo(() => createClient(), [])

  // Count of pending (unread/read) notifications - memoized for performance
  const pendingCount = useMemo(
    () => notifications.filter((n) => n.status === 'unread' || n.status === 'read').length,
    [notifications]
  )

  /**
   * Dismiss a single notification (optimistic)
   */
  const dismiss = useCallback(
    async (id: string): Promise<boolean> => {
      // Optimistic: immediately update local state
      setNotificationsInternal((prev) =>
        prev.map((n) => (n.id === id ? { ...n, status: 'dismissed' as const } : n))
      )

      try {
        const { error: updateError } = await supabase
          .from('event_change_notifications')
          .update({ status: 'dismissed', updated_at: new Date().toISOString() })
          .eq('id', id)

        if (updateError) {
          // Rollback on error
          setNotificationsInternal((prev) =>
            prev.map((n) => (n.id === id ? { ...n, status: 'unread' as const } : n))
          )
          setError(updateError.message)
          return false
        }

        return true
      } catch (err) {
        // Rollback on error
        setNotificationsInternal((prev) =>
          prev.map((n) => (n.id === id ? { ...n, status: 'unread' as const } : n))
        )
        setError(err instanceof Error ? err.message : 'Failed to dismiss')
        return false
      }
    },
    [supabase]
  )

  /**
   * Restore a single notification (creates event, optimistic)
   */
  const restore = useCallback(
    async (
      id: string
    ): Promise<{ success: boolean; eventId?: string; error?: string }> => {
      // Optimistic: immediately update local state
      setNotificationsInternal((prev) =>
        prev.map((n) => (n.id === id ? { ...n, status: 'restored' as const } : n))
      )

      try {
        const { data, error: rpcError } = await supabase.rpc('restore_removed_event', {
          p_notification_id: id,
        })

        if (rpcError) {
          // Rollback on error
          setNotificationsInternal((prev) =>
            prev.map((n) => (n.id === id ? { ...n, status: 'unread' as const } : n))
          )
          return { success: false, error: rpcError.message }
        }

        return { success: true, eventId: data as string }
      } catch (err) {
        // Rollback on error
        setNotificationsInternal((prev) =>
          prev.map((n) => (n.id === id ? { ...n, status: 'unread' as const } : n))
        )
        const errorMsg = err instanceof Error ? err.message : 'Failed to restore'
        return { success: false, error: errorMsg }
      }
    },
    [supabase]
  )

  /**
   * Dismiss all notifications (batch operation)
   */
  const dismissAll = useCallback(async (): Promise<{ success: boolean; count: number }> => {
    const activeIds = notifications
      .filter((n) => n.status === 'unread' || n.status === 'read')
      .map((n) => n.id)

    if (activeIds.length === 0) {
      return { success: true, count: 0 }
    }

    // Optimistic: immediately update all
    setNotificationsInternal((prev) =>
      prev.map((n) =>
        activeIds.includes(n.id) ? { ...n, status: 'dismissed' as const } : n
      )
    )
    setSyncing(true)

    try {
      const { data, error: rpcError } = await supabase.rpc('dismiss_all_notifications')

      if (rpcError) {
        // Rollback on error
        setNotificationsInternal((prev) =>
          prev.map((n) =>
            activeIds.includes(n.id) ? { ...n, status: 'unread' as const } : n
          )
        )
        setError(rpcError.message)
        return { success: false, count: 0 }
      }

      return { success: true, count: data as number }
    } catch (err) {
      // Rollback on error
      setNotificationsInternal((prev) =>
        prev.map((n) =>
          activeIds.includes(n.id) ? { ...n, status: 'unread' as const } : n
        )
      )
      setError(err instanceof Error ? err.message : 'Failed to dismiss all')
      return { success: false, count: 0 }
    } finally {
      setSyncing(false)
    }
  }, [notifications, supabase])

  /**
   * Restore all notifications (batch operation)
   */
  const restoreAll = useCallback(async (): Promise<{
    success: boolean
    count: number
    eventIds?: string[]
  }> => {
    const activeIds = notifications
      .filter((n) => n.status === 'unread' || n.status === 'read')
      .map((n) => n.id)

    if (activeIds.length === 0) {
      return { success: true, count: 0, eventIds: [] }
    }

    // Optimistic: immediately update all
    setNotificationsInternal((prev) =>
      prev.map((n) =>
        activeIds.includes(n.id) ? { ...n, status: 'restored' as const } : n
      )
    )
    setSyncing(true)

    try {
      const { data, error: rpcError } = await supabase.rpc('restore_all_notifications')

      if (rpcError) {
        // Rollback on error
        setNotificationsInternal((prev) =>
          prev.map((n) =>
            activeIds.includes(n.id) ? { ...n, status: 'unread' as const } : n
          )
        )
        setError(rpcError.message)
        return { success: false, count: 0 }
      }

      const result = data as { restored_count: number; event_ids: string[] }
      return {
        success: true,
        count: result.restored_count,
        eventIds: result.event_ids,
      }
    } catch (err) {
      // Rollback on error
      setNotificationsInternal((prev) =>
        prev.map((n) =>
          activeIds.includes(n.id) ? { ...n, status: 'unread' as const } : n
        )
      )
      setError(err instanceof Error ? err.message : 'Failed to restore all')
      return { success: false, count: 0 }
    } finally {
      setSyncing(false)
    }
  }, [notifications, supabase])

  /**
   * Refresh notifications from server (for initial load)
   */
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('event_change_notifications')
        .select('*')
        .in('status', ['unread', 'read'])
        .order('created_at', { ascending: false })
        .limit(50)

      if (fetchError) {
        setError(fetchError.message)
        return
      }

      setNotificationsInternal((data || []) as EventNotification[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  return {
    notifications,
    pendingCount,
    loading,
    syncing,
    error,
    dismiss,
    restore,
    dismissAll,
    restoreAll,
    refresh,
    setNotifications,
  }
}
