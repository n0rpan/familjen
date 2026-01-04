'use client'

/**
 * useChildren Hook
 *
 * Abstracts children data fetching for both demo and production modes.
 *
 * Loading state is derived from:
 * - householdLoading: waiting for household to load
 * - shouldFetch: household loaded with ID, but initial fetch not done yet
 * - isFetching: actively fetching data
 *
 * This ensures no "flash" between household loading and data fetching.
 */

import { useState, useEffect, useCallback } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import type { Child } from '@/lib/types'

export interface UseChildrenReturn {
  children: Child[]
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Hook to get all children in the household
 */
export function useChildren(): UseChildrenReturn {
  const { isDemo, supabase, demoState } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [children, setChildren] = useState<Child[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [initialFetchDone, setInitialFetchDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setIsFetching(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('children')
        .select('*')
        .eq('household_id', household.id)
        .order('sort_order', { ascending: true })

      if (fetchError) throw fetchError

      setChildren(data || [])
    } catch (err) {
      console.error('Error fetching children:', err)
      setError(err instanceof Error ? err.message : 'Failed to load children')
    } finally {
      setIsFetching(false)
      setInitialFetchDone(true)
    }
  }, [isDemo, supabase, household?.id])

  // Fetch when household becomes available
  useEffect(() => {
    if (!isDemo && household?.id && !initialFetchDone) {
      fetchData()
    }
  }, [isDemo, household?.id, initialFetchDone, fetchData])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    return {
      children: demoState.children,
      loading: false,
      error: null,
      refetch: () => {}, // No-op in demo
    }
  }

  // Demo mode initializing: show loading
  if (isDemo && !demoState) {
    return {
      children: [],
      loading: true,
      error: null,
      refetch: () => {},
    }
  }

  // Derive loading state:
  // - householdLoading: waiting for household to load
  // - shouldFetch: household has ID but we haven't fetched yet
  // - isFetching: actively fetching
  const shouldFetch = !!household?.id && !initialFetchDone && !isFetching
  const loading = householdLoading || shouldFetch || isFetching

  return {
    children,
    loading,
    error,
    refetch: fetchData,
  }
}
