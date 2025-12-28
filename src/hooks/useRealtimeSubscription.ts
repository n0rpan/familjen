'use client'

import { useEffect, useRef, useState, useCallback, useId } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE'

export interface RealtimeEvent<T = Record<string, unknown>> {
  eventType: RealtimeEventType
  table: string
  old: T | null
  new: T | null
  timestamp: number
}

interface UseRealtimeSubscriptionOptions<T> {
  table: string
  schema?: string
  filter?: string // e.g., 'household_id=eq.uuid'
  onInsert?: (record: T) => void
  onUpdate?: (newRecord: T, oldRecord: T | null) => void
  onDelete?: (oldRecord: T) => void
  onAny?: (event: RealtimeEvent<T>) => void
  enabled?: boolean
}

interface UseRealtimeSubscriptionResult {
  isConnected: boolean
  lastEvent: RealtimeEvent | null
  error: string | null
}

export function useRealtimeSubscription<T extends object>({
  table,
  schema = 'public',
  filter,
  onInsert,
  onUpdate,
  onDelete,
  onAny,
  enabled = true,
}: UseRealtimeSubscriptionOptions<T>): UseRealtimeSubscriptionResult {
  // Stable ID for this hook instance - prevents creating new channels on every effect run
  const instanceId = useId()

  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(true)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const supabaseRef = useRef(createClient())

  // Pause subscriptions when page is hidden to save battery/data
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Store callbacks in refs to avoid re-subscribing when they change
  const callbacksRef = useRef({ onInsert, onUpdate, onDelete, onAny })

  // Keep callbacks ref in sync via effect to avoid updating ref during render
  useEffect(() => {
    callbacksRef.current = { onInsert, onUpdate, onDelete, onAny }
  }, [onInsert, onUpdate, onDelete, onAny])

  const handleChange = useCallback((
    payload: RealtimePostgresChangesPayload<T>
  ) => {
    const event: RealtimeEvent<T> = {
      eventType: payload.eventType as RealtimeEventType,
      table: payload.table,
      old: payload.old as T | null,
      new: payload.new as T | null,
      timestamp: Date.now(),
    }

    setLastEvent(event as RealtimeEvent)

    // Call specific handlers
    const { onInsert, onUpdate, onDelete, onAny } = callbacksRef.current

    if (onAny) {
      onAny(event)
    }

    switch (event.eventType) {
      case 'INSERT':
        if (onInsert && event.new) {
          onInsert(event.new)
        }
        break
      case 'UPDATE':
        if (onUpdate && event.new) {
          onUpdate(event.new, event.old)
        }
        break
      case 'DELETE':
        if (onDelete && event.old) {
          onDelete(event.old)
        }
        break
    }
  }, [])

  useEffect(() => {
    // Track if this effect instance is still active (not cleaned up)
    let isActive = true

    // Clean up any existing channel before potentially creating a new one
    const cleanupExisting = async () => {
      if (channelRef.current) {
        const channelToRemove = channelRef.current
        channelRef.current = null
        await supabaseRef.current.removeChannel(channelToRemove)
      }
    }

    // Only subscribe when enabled AND visible (pause when backgrounded)
    if (!enabled || !isVisible) {
      // Clean up existing subscription if we're pausing
      cleanupExisting().then(() => {
        if (isActive) {
          setIsConnected(false)
        }
      })
      return () => {
        isActive = false
      }
    }

    const supabase = supabaseRef.current

    // Create unique channel name with stable instance ID to avoid conflicts
    const channelName = `realtime:${schema}:${table}:${filter || 'all'}:${instanceId}`

    // Subscribe after cleaning up the old channel
    const setupSubscription = async () => {
      await cleanupExisting()

      // Check if we were cancelled during cleanup
      if (!isActive) return

      // Subscribe to changes
      const channel = supabase.channel(channelName)

      // Build the subscription config
      const subscriptionConfig: {
        event: '*'
        schema: string
        table: string
        filter?: string
      } = {
        event: '*',
        schema,
        table,
      }

      if (filter) {
        subscriptionConfig.filter = filter
      }

      channel
        .on(
          'postgres_changes',
          subscriptionConfig,
          handleChange as (payload: RealtimePostgresChangesPayload<{ [key: string]: unknown }>) => void
        )
        .subscribe((status) => {
          // Only update state if this effect instance is still active
          if (!isActive) return

          if (status === 'SUBSCRIBED') {
            setIsConnected(true)
            setError(null)
          } else if (status === 'CHANNEL_ERROR') {
            setIsConnected(false)
            setError('Failed to connect to realtime channel')
          } else if (status === 'TIMED_OUT') {
            setIsConnected(false)
            setError('Connection timed out')
          } else if (status === 'CLOSED') {
            setIsConnected(false)
          }
        })

      // Only store the channel if we're still active
      if (isActive) {
        channelRef.current = channel
      } else {
        // We were cancelled during setup, clean up immediately
        supabase.removeChannel(channel)
      }
    }

    setupSubscription()

    return () => {
      isActive = false
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      setIsConnected(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- instanceId from useId() is stable for component lifetime
  }, [table, schema, filter, enabled, isVisible, handleChange])

  return {
    isConnected,
    lastEvent,
    error,
  }
}

// Helper to create a household filter string
export function createHouseholdFilter(householdId: string): string {
  return `household_id=eq.${householdId}`
}

// Helper to create a list_id filter for a single shopping list
export function createListFilter(listId: string): string {
  return `list_id=eq.${listId}`
}

// Validation regexes
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMN_REGEX = /^[a-z_][a-z0-9_]*$/i

/**
 * Helper to create an "in" filter for multiple UUID values
 * Validates column name and UUIDs to prevent filter injection
 * @example createInFilter('list_id', ['uuid1', 'uuid2']) => 'list_id=in.(uuid1,uuid2)'
 */
export function createInFilter(column: string, values: string[]): string | undefined {
  // Validate column name (alphanumeric + underscore only)
  if (!COLUMN_REGEX.test(column)) return undefined
  if (values.length === 0) return undefined
  // Validate UUIDs to prevent filter injection
  const validValues = values.filter(v => UUID_REGEX.test(v))
  if (validValues.length === 0) return undefined
  if (validValues.length === 1) return `${column}=eq.${validValues[0]}`
  return `${column}=in.(${validValues.join(',')})`
}
