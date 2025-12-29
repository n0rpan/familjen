'use client'

/**
 * useMembers Hook
 *
 * Abstracts household members data fetching for both demo and production modes.
 *
 * Loading state is derived from:
 * - householdLoading: waiting for household to load
 * - shouldFetch: household loaded with ID, but initial fetch not done yet
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import type { HouseholdMember } from '@/lib/types'

export interface UseMembersReturn {
  members: HouseholdMember[]
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Hook to get all members in the household
 */
export function useMembers(): UseMembersReturn {
  const { isDemo, supabase, demoState } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [initialFetchDone, setInitialFetchDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setIsFetching(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('household_members')
        .select('*')
        .eq('household_id', household.id)
        .order('created_at', { ascending: true })

      if (fetchError) throw fetchError

      setMembers(data || [])
    } catch (err) {
      console.error('Error fetching members:', err)
      setError(err instanceof Error ? err.message : 'Failed to load members')
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
      members: demoState.members,
      loading: false,
      error: null,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state
  const shouldFetch = !!household?.id && !initialFetchDone && !isFetching
  const loading = householdLoading || shouldFetch || isFetching

  return {
    members,
    loading,
    error,
    refetch: fetchData,
  }
}
