'use client'

/**
 * useMembers Hook
 *
 * Abstracts household members data fetching for both demo and production modes.
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
  const { household } = useHousehold()

  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setLoading(true)
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
      setLoading(false)
    }
  }, [isDemo, supabase, household?.id])

  // Initial fetch for production mode
  useEffect(() => {
    if (!isDemo && household?.id) {
      fetchData()
    }
  }, [isDemo, household?.id, fetchData])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    return {
      members: demoState.members,
      loading: false,
      error: null,
      refetch: () => {}, // No-op in demo
    }
  }

  return {
    members,
    loading,
    error,
    refetch: fetchData,
  }
}
