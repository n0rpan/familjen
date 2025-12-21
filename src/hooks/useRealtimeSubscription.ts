'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
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
  callbacksRef.current = { onInsert, onUpdate, onDelete, onAny }

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
    // Only subscribe when enabled AND visible (pause when backgrounded)
    if (!enabled || !isVisible) {
      // Clean up existing subscription if we're pausing
      if (channelRef.current) {
        supabaseRef.current.removeChannel(channelRef.current)
        channelRef.current = null
        setIsConnected(false)
      }
      return
    }

    const supabase = supabaseRef.current

    // Create unique channel name
    const channelName = `realtime:${schema}:${table}:${filter || 'all'}`

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

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      setIsConnected(false)
    }
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

// Helper to create a list_id filter for shopping items
export function createListFilter(listId: string): string {
  return `list_id=eq.${listId}`
}
