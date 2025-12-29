'use client'

/**
 * useHousehold Hook
 *
 * Abstracts household data fetching for both demo and production modes.
 * In demo mode, returns demo household data.
 * In production, fetches from Supabase.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDataSource } from './useDataSource'
import type { Household, HouseholdMember } from '@/lib/types'

export interface UseHouseholdReturn {
  household: Household | null
  currentMember: HouseholdMember | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Hook to get the current household and current user's membership
 */
export function useHousehold(): UseHouseholdReturn {
  const { isDemo, supabase, demoState } = useDataSource()

  const [household, setHousehold] = useState<Household | null>(null)
  const [currentMember, setCurrentMember] = useState<HouseholdMember | null>(null)
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase) return

    setLoading(true)
    setError(null)

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      // Get current member and their household
      const { data: member, error: memberError } = await supabase
        .from('household_members')
        .select('*, household:households(*)')
        .eq('user_id', user.id)
        .single()

      if (memberError) {
        if (memberError.code === 'PGRST116') {
          // No membership found - not an error, user needs to join/create household
          setLoading(false)
          return
        }
        throw memberError
      }

      if (member) {
        setCurrentMember(member)
        setHousehold(member.household as Household)
      }
    } catch (err) {
      console.error('Error fetching household:', err)
      setError(err instanceof Error ? err.message : 'Failed to load household')
    } finally {
      setLoading(false)
    }
  }, [isDemo, supabase])

  // Initial fetch for production mode
  useEffect(() => {
    if (!isDemo) {
      fetchData()
    }
  }, [isDemo, fetchData])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    // Find the first member as the "current" member in demo
    const demoCurrentMember = demoState.members[0] || null

    return {
      household: demoState.household,
      currentMember: demoCurrentMember,
      loading: false,
      error: null,
      refetch: () => {}, // No-op in demo
    }
  }

  return {
    household,
    currentMember,
    loading,
    error,
    refetch: fetchData,
  }
}

/**
 * Hook to get just the household ID (for components that only need the ID)
 */
export function useHouseholdId(): string | null {
  const { household } = useHousehold()
  return household?.id || null
}
