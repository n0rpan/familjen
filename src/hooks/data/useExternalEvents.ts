'use client'

/**
 * useExternalEvents Hook
 *
 * Abstracts external events data fetching for both demo and production modes.
 * External events are synced from integrations like Spond, MyKid, etc.
 * These are read-only in the app (modifications happen via local overrides).
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - needsFetch: household loaded but fetch for current params not done
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { formatDateISO } from '@/lib/utils'
import type { ExternalEvent } from '@/lib/types'

export interface UseExternalEventsOptions {
  /** Start date for filtering (inclusive) */
  startDate?: Date
  /** End date for filtering (inclusive) */
  endDate?: Date
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
  const { startDate, endDate } = options
  const { isDemo, supabase, demoState } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [events, setEvents] = useState<ExternalEvent[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [lastFetchKey, setLastFetchKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startDateStr = startDate ? formatDateISO(startDate) : null
  const endDateStr = endDate ? formatDateISO(endDate) : null

  // Generate a key for the current fetch parameters
  const currentFetchKey = `${household?.id}-${startDateStr}-${endDateStr}`

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setIsFetching(true)
    setError(null)

    try {
      // Get integration IDs for this household
      const { data: integrations } = await supabase
        .from('external_integrations')
        .select('id')
        .eq('household_id', household.id)

      if (!integrations || integrations.length === 0) {
        setEvents([])
        setLastFetchKey(currentFetchKey)
        setIsFetching(false)
        return
      }

      const integrationIds = integrations.map(i => i.id)

      let query = supabase
        .from('external_events')
        .select('*, integration:external_integrations(service, display_name, household_id)')
        .in('integration_id', integrationIds)
        .eq('is_hidden', false)

      if (startDateStr) {
        query = query.gte('event_date', startDateStr)
      }
      if (endDateStr) {
        query = query.lte('event_date', endDateStr)
      }

      query = query.order('event_date', { ascending: true })

      const { data, error: fetchError } = await query

      if (fetchError) throw fetchError

      setEvents(data || [])
      setLastFetchKey(currentFetchKey)
    } catch (err) {
      console.error('Error fetching external events:', err)
      setError(err instanceof Error ? err.message : 'Failed to load events')
      setLastFetchKey(currentFetchKey)
    } finally {
      setIsFetching(false)
    }
  }, [isDemo, supabase, household?.id, startDateStr, endDateStr, currentFetchKey])

  // Fetch when household or date range changes
  useEffect(() => {
    if (!isDemo && household?.id && lastFetchKey !== currentFetchKey) {
      fetchData()
    }
  }, [isDemo, household?.id, lastFetchKey, currentFetchKey, fetchData])

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

  // Derive loading state
  const needsFetch = !!household?.id && lastFetchKey !== currentFetchKey && !isFetching
  const loading = householdLoading || needsFetch || isFetching

  return {
    events,
    loading,
    error,
    refetch: fetchData,
  }
}
