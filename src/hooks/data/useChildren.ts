'use client'

/**
 * useChildren Hook
 *
 * Abstracts children data fetching for both demo and production modes.
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
  const { household } = useHousehold()

  const [children, setChildren] = useState<Child[]>([])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setLoading(true)
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
      setLoading(false)
    }
  }, [isDemo, supabase, household?.id])

  // Initial fetch for production mode
  useEffect(() => {
    if (isDemo) return

    if (household?.id) {
      fetchData()
    } else {
      // No household - nothing to fetch, clear loading state
      setLoading(false)
    }
  }, [isDemo, household?.id, fetchData])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    return {
      children: demoState.children,
      loading: false,
      error: null,
      refetch: () => {}, // No-op in demo
    }
  }

  return {
    children,
    loading,
    error,
    refetch: fetchData,
  }
}
