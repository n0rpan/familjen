'use client'

/**
 * useExternalEvents Hook
 *
 * Abstracts external events data fetching for both demo and production modes.
 * External events are synced from integrations like Spond, MyKid, etc.
 * These are read-only in the app (modifications happen via local overrides).
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
  const { household } = useHousehold()

  const [events, setEvents] = useState<ExternalEvent[]>([])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const startDateStr = startDate ? formatDateISO(startDate) : null
  const endDateStr = endDate ? formatDateISO(endDate) : null

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setLoading(true)
    setError(null)

    try {
      // Get integration IDs for this household
      const { data: integrations } = await supabase
        .from('external_integrations')
        .select('id')
        .eq('household_id', household.id)

      if (!integrations || integrations.length === 0) {
        setEvents([])
        setLoading(false)
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
    } catch (err) {
      console.error('Error fetching external events:', err)
      setError(err instanceof Error ? err.message : 'Failed to load events')
    } finally {
      setLoading(false)
    }
  }, [isDemo, supabase, household?.id, startDateStr, endDateStr])

  // Initial fetch for production mode
  useEffect(() => {
    if (!isDemo && household?.id) {
      fetchData()
    }
  }, [isDemo, household?.id, fetchData])

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

  return {
    events,
    loading,
    error,
    refetch: fetchData,
  }
}
