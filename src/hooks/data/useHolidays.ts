'use client'

/**
 * useHolidays Hook
 *
 * Abstracts holidays data for both demo and production modes.
 * Holidays include system holidays and birthdays.
 */

import { useState, useEffect, useCallback } from 'react'
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
  const { household } = useHousehold()

  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const startDateStr = startDate ? formatDateISO(startDate) : null
  const endDateStr = endDate ? formatDateISO(endDate) : null

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setLoading(true)
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

      if (fetchError) {
        // Calendar events table might not exist in all environments
        if (fetchError.code === '42P01') {
          setHolidays([])
          setLoading(false)
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
    } catch (err) {
      console.error('Error fetching holidays:', err)
      setError(err instanceof Error ? err.message : 'Failed to load holidays')
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

  return {
    holidays,
    loading,
    error,
    refetch: fetchData,
  }
}
