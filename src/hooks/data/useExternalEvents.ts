'use client'

/**
 * useExternalEvents Hook
 *
 * Abstracts external events data fetching for both demo and production modes.
 * External events are synced from integrations like Spond, MyKid, etc.
 * These are read-only in the app (modifications happen via local overrides).
 *
 * PERFORMANCE: This hook supports deferred loading to not block initial render.
 * External events are "nice to have" not critical - pickups and meals matter more.
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - needsFetch: household loaded but fetch for current params not done
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { useHouseholdId } from './useHousehold'
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription'
import { formatDateISO } from '@/lib/utils'
import type { ExternalEvent } from '@/lib/types'

// Default delay for deferred loading (ms)
const DEFAULT_DEFER_MS = 300

export interface UseExternalEventsOptions {
  /** Start date for filtering (inclusive) */
  startDate?: Date
  /** End date for filtering (inclusive) */
  endDate?: Date
  /**
   * Defer initial fetch by this many ms after component mount.
   * Improves startup performance by loading external events after core data.
   * Set to 0 or false to disable deferral. Default: 300ms
   */
  deferMs?: number | false
}

export interface UseExternalEventsReturn {
  events: ExternalEvent[]
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Hook to get external events with optional filtering by date range
 */
export function useExternalEvents(options: UseExternalEventsOptions = {}): UseExternalEventsReturn {
  const { startDate, endDate, deferMs = DEFAULT_DEFER_MS } = options
  const { isDemo, supabase, demoState } = useDataSource()
  // Use JWT-based household ID for faster access
  const householdId = useHouseholdId()
  const { loading: householdLoading } = useHousehold()

  const [events, setEvents] = useState<ExternalEvent[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [lastFetchKey, setLastFetchKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDeferralComplete, setIsDeferralComplete] = useState(deferMs === false || deferMs === 0)

  // Track abort controller for cleanup
  const abortControllerRef = useRef<AbortController | null>(null)

  const startDateStr = startDate ? formatDateISO(startDate) : null
  const endDateStr = endDate ? formatDateISO(endDate) : null

  // Memoize fetch key to prevent unnecessary re-renders
  const currentFetchKey = useMemo(
    () => `${householdId}-${startDateStr}-${endDateStr}`,
    [householdId, startDateStr, endDateStr]
  )

  // Handle deferral - delay fetch to not block initial render
  useEffect(() => {
    if (deferMs === false || deferMs === 0) {
      setIsDeferralComplete(true)
      return
    }

    const timer = setTimeout(() => {
      setIsDeferralComplete(true)
    }, deferMs)

    return () => clearTimeout(timer)
  }, [deferMs])

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !householdId) return

    // Abort any pending request
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const { signal } = abortControllerRef.current

    setIsFetching(true)
    setError(null)

    try {
      // Single optimized query: join through integration to filter by household
      // This replaces 2 sequential queries with 1
      let query = supabase
        .from('external_events')
        .select('*, integration:external_integrations!inner(id, service, display_name, household_id)')
        .eq('integration.household_id', householdId)
        .eq('is_hidden', false)

      if (startDateStr) {
        query = query.gte('event_date', startDateStr)
      }
      if (endDateStr) {
        query = query.lte('event_date', endDateStr)
      }

      query = query.order('event_date', { ascending: true })

      const { data, error: fetchError } = await query

      // Check if request was aborted
      if (signal.aborted) return

      if (fetchError) throw fetchError

      setEvents(data || [])
      setLastFetchKey(currentFetchKey)
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return

      console.error('Error fetching external events:', err)
      setError(err instanceof Error ? err.message : 'Failed to load events')
      setLastFetchKey(currentFetchKey)
    } finally {
      // Only update if not aborted
      if (!abortControllerRef.current?.signal.aborted) {
        setIsFetching(false)
      }
    }
  }, [isDemo, supabase, householdId, startDateStr, endDateStr, currentFetchKey])

  // Subscribe to realtime changes for instant sync when integrations update
  // Note: external_events doesn't have household_id directly, so we subscribe without filter
  // and let fetchData() apply the proper join filter on refetch
  useRealtimeSubscription<ExternalEvent>({
    table: 'external_events',
    enabled: !isDemo && !!householdId && isDeferralComplete,
    onAny: fetchData,
    deferMs: 0, // Already deferred via isDeferralComplete check
  })

  // Fetch when household or date range changes (only after deferral complete)
  useEffect(() => {
    if (!isDemo && householdId && lastFetchKey !== currentFetchKey && isDeferralComplete) {
      fetchData()
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [isDemo, householdId, lastFetchKey, currentFetchKey, isDeferralComplete, fetchData])

  // Demo mode initializing: show loading while demoState is not yet available
  if (isDemo && !demoState) {
    return {
      events: [],
      loading: true,
      error: null,
      refetch: () => {},
    }
  }

  // Demo mode: return demo data with filtering
  if (isDemo && demoState) {
    const filteredEvents = demoState.externalEvents.filter(e => {
      if (startDateStr && e.event_date < startDateStr) return false
      if (endDateStr && e.event_date > endDateStr) return false
      return true
    })

    return {
      events: filteredEvents,
      loading: false,
      error: null,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state (account for deferral)
  const needsFetch = !!householdId && lastFetchKey !== currentFetchKey && !isFetching && isDeferralComplete
  const loading = householdLoading || needsFetch || isFetching || !isDeferralComplete

  return {
    events,
    loading,
    error,
    refetch: fetchData,
  }
}
