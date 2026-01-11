'use client'

/**
 * useMemberEvents Hook
 *
 * Abstracts member events data fetching and mutations for both demo and production modes.
 * Member events are personal events for household members (work trips, dinners, etc.)
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - needsFetch: household loaded but fetch for current params not done
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'
import { formatDateISO } from '@/lib/utils'
import type { MemberEvent } from '@/lib/types'

export interface UseMemberEventsOptions {
  /** Start date for filtering (inclusive) */
  startDate?: Date
  /** End date for filtering (inclusive) */
  endDate?: Date
}

export interface UseMemberEventsReturn {
  events: MemberEvent[]
  loading: boolean
  error: string | null
  addEvent: (event: Omit<MemberEvent, 'id' | 'created_at' | 'updated_at'>) => Promise<void>
  updateEvent: (eventId: string, updates: Partial<MemberEvent>) => Promise<void>
  deleteEvent: (eventId: string) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get member events with optional filtering by date range
 */
export function useMemberEvents(options: UseMemberEventsOptions = {}): UseMemberEventsReturn {
  const { startDate, endDate } = options
  const { isDemo, supabase, demoState } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [events, setEvents] = useState<MemberEvent[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [lastFetchKey, setLastFetchKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Track abort controller for cleanup
  const abortControllerRef = useRef<AbortController | null>(null)

  const startDateStr = startDate ? formatDateISO(startDate) : null
  const endDateStr = endDate ? formatDateISO(endDate) : null

  // Memoize fetch key to prevent unnecessary re-renders
  const currentFetchKey = useMemo(
    () => `${household?.id}-${startDateStr}-${endDateStr}`,
    [household?.id, startDateStr, endDateStr]
  )

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    // Abort any pending request
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const { signal } = abortControllerRef.current

    setIsFetching(true)
    setError(null)

    try {
      let query = supabase
        .from('member_events')
        .select('*')
        .eq('household_id', household.id)

      if (startDateStr) {
        query = query.gte('date', startDateStr)
      }
      if (endDateStr) {
        query = query.lte('date', endDateStr)
      }

      query = query.order('date', { ascending: true })

      const { data, error: fetchError } = await query

      // Check if request was aborted
      if (signal.aborted) return

      if (fetchError) throw fetchError

      setEvents(data || [])
      setLastFetchKey(currentFetchKey)
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return

      console.error('Error fetching member events:', err)
      setError(err instanceof Error ? err.message : 'Failed to load events')
      setLastFetchKey(currentFetchKey)
    } finally {
      // Only update if not aborted
      if (!abortControllerRef.current?.signal.aborted) {
        setIsFetching(false)
      }
    }
  }, [isDemo, supabase, household?.id, startDateStr, endDateStr, currentFetchKey])

  // Subscribe to realtime changes for instant sync between family members
  useRealtimeSubscription<MemberEvent>({
    table: 'member_events',
    filter: household?.id ? createHouseholdFilter(household.id) : undefined,
    enabled: !isDemo && !!household?.id,
    onAny: fetchData,
  })

  // Fetch when household or date range changes
  useEffect(() => {
    if (!isDemo && household?.id && lastFetchKey !== currentFetchKey) {
      fetchData()
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [isDemo, household?.id, lastFetchKey, currentFetchKey, fetchData])

  // Add event mutation
  const addEvent = useCallback(async (
    event: Omit<MemberEvent, 'id' | 'created_at' | 'updated_at'>
  ) => {
    if (isDemo) {
      console.log('Demo mode: Would add member event', event)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('member_events')
        .insert(event)

      await fetchData()
    } catch (err) {
      console.error('Error adding event:', err)
      throw err
    }
  }, [isDemo, supabase, fetchData])

  // Update event mutation
  const updateEvent = useCallback(async (
    eventId: string,
    updates: Partial<MemberEvent>
  ) => {
    if (isDemo) {
      console.log('Demo mode: Would update member event', eventId, updates)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('member_events')
        .update(updates)
        .eq('id', eventId)

      await fetchData()
    } catch (err) {
      console.error('Error updating event:', err)
      throw err
    }
  }, [isDemo, supabase, fetchData])

  // Delete event mutation
  const deleteEvent = useCallback(async (eventId: string) => {
    if (isDemo) {
      console.log('Demo mode: Would delete member event', eventId)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('member_events')
        .delete()
        .eq('id', eventId)

      await fetchData()
    } catch (err) {
      console.error('Error deleting event:', err)
      throw err
    }
  }, [isDemo, supabase, fetchData])

  // Demo mode initializing: show loading while demoState is not yet available
  if (isDemo && !demoState) {
    return {
      events: [],
      loading: true,
      error: null,
      addEvent,
      updateEvent,
      deleteEvent,
      refetch: () => {},
    }
  }

  // Demo mode: return demo data with filtering
  if (isDemo && demoState) {
    const filteredEvents = demoState.memberEvents.filter(e => {
      if (startDateStr && e.date < startDateStr) return false
      if (endDateStr && e.date > endDateStr) return false
      return true
    })

    return {
      events: filteredEvents,
      loading: false,
      error: null,
      addEvent,
      updateEvent,
      deleteEvent,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state
  const needsFetch = !!household?.id && lastFetchKey !== currentFetchKey && !isFetching
  const loading = householdLoading || needsFetch || isFetching

  return {
    events,
    loading,
    error,
    addEvent,
    updateEvent,
    deleteEvent,
    refetch: fetchData,
  }
}
