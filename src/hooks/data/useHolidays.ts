'use client'

/**
 * useHolidays Hook
 *
 * Abstracts holidays data for both demo and production modes.
 * Holidays include system holidays and birthdays.
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - needsFetch: household loaded but fetch for current params not done
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { formatDateISO, type Holiday } from '@/lib/utils'

export interface UseHolidaysOptions {
  /** Start date for filtering (inclusive) */
  startDate?: Date
  /** End date for filtering (inclusive) */
  endDate?: Date
}

export interface UseHolidaysReturn {
  holidays: Holiday[]
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Hook to get holidays with optional filtering by date range
 */
export function useHolidays(options: UseHolidaysOptions = {}): UseHolidaysReturn {
  const { startDate, endDate } = options
  const { isDemo, supabase, demoState } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [holidays, setHolidays] = useState<Holiday[]>([])
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
      // Fetch calendar events that are holidays
      // Schema: calendar_events has columns: date, name, event_type (not event_date, title)
      let query = supabase
        .from('calendar_events')
        .select('date, name, event_type')
        .or(`household_id.eq.${household.id},household_id.is.null`) // Include system holidays
        .in('event_type', ['holiday', 'birthday', 'flag_day'])

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

      if (fetchError) {
        // Calendar events table might not exist in all environments
        if (fetchError.code === '42P01') {
          setHolidays([])
          setLastFetchKey(currentFetchKey)
          setIsFetching(false)
          return
        }
        throw fetchError
      }

      // Convert to Holiday format (map flag_day to holiday)
      const holidayData: Holiday[] = (data || []).map(e => ({
        date: e.date,
        name: e.name || '',
        type: (e.event_type === 'birthday' ? 'birthday' : 'holiday') as 'holiday' | 'birthday',
      }))

      setHolidays(holidayData)
      setLastFetchKey(currentFetchKey)
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return

      console.error('Error fetching holidays:', err)
      setError(err instanceof Error ? err.message : 'Failed to load holidays')
      setLastFetchKey(currentFetchKey)
    } finally {
      // Only update if not aborted
      if (!abortControllerRef.current?.signal.aborted) {
        setIsFetching(false)
      }
    }
  }, [isDemo, supabase, household?.id, startDateStr, endDateStr, currentFetchKey])

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

  // Demo mode: return demo data with filtering
  if (isDemo && demoState) {
    const filteredHolidays = demoState.holidays.filter(h => {
      if (startDateStr && h.date < startDateStr) return false
      if (endDateStr && h.date > endDateStr) return false
      return true
    })

    return {
      holidays: filteredHolidays,
      loading: false,
      error: null,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state
  const needsFetch = !!household?.id && lastFetchKey !== currentFetchKey && !isFetching
  const loading = householdLoading || needsFetch || isFetching

  return {
    holidays,
    loading,
    error,
    refetch: fetchData,
  }
}
