'use client'

/**
 * useHousehold Hook
 *
 * Abstracts household data fetching for both demo and production modes.
 * In demo mode, returns demo household data.
 * In production, uses JWT for household_id (fast) and fetches details from DB.
 *
 * PERFORMANCE: This hook is optimized for fast startup:
 * 1. Gets household_id from JWT (instant, no network)
 * 2. Fetches household details only when needed
 * 3. Caches results in IndexedDB for instant subsequent loads
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useAuthState } from '../useAuthState'
import { getCached, setCache, isCacheFresh, deleteCache } from '@/lib/cache'
import type { Household, HouseholdMember } from '@/lib/types'

// Cache household data for 5 minutes
const HOUSEHOLD_CACHE_KEY = 'household-data'
const HOUSEHOLD_CACHE_MAX_AGE = 5 * 60 * 1000

interface CachedHouseholdData {
  household: Household
  currentMember: HouseholdMember
}

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
  const { user, householdId: jwtHouseholdId, loading: authLoading } = useAuthState()

  const [household, setHousehold] = useState<Household | null>(null)
  const [currentMember, setCurrentMember] = useState<HouseholdMember | null>(null)
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)
  const hasFetchedRef = useRef(false)

  const fetchData = useCallback(async (skipCache = false) => {
    if (isDemo || !supabase || !user) return

    // If no household in JWT, user needs to create/join one
    if (!jwtHouseholdId) {
      setLoading(false)
      return
    }

    setError(null)

    try {
      // Try to load from cache first (instant)
      if (!skipCache) {
        const cached = await getCached<CachedHouseholdData>(HOUSEHOLD_CACHE_KEY)
        if (cached && isCacheFresh(cached, HOUSEHOLD_CACHE_MAX_AGE)) {
          // Verify cached data matches current household
          if (cached.data.household.id === jwtHouseholdId) {
            setHousehold(cached.data.household)
            setCurrentMember(cached.data.currentMember)
            setLoading(false)
            // Still fetch fresh data in background
            fetchFreshData()
            return
          }
        }
      }

      await fetchFreshData()
    } catch (err) {
      console.error('Error fetching household:', err)
      setError(err instanceof Error ? err.message : 'Failed to load household')
      setLoading(false)
    }

    async function fetchFreshData() {
      if (!supabase || !user || !jwtHouseholdId) return

      // Fetch member and household in a single query using JWT household_id
      const { data: member, error: memberError } = await supabase
        .from('household_members')
        .select('*, household:households(*)')
        .eq('user_id', user.id)
        .eq('household_id', jwtHouseholdId)
        .single()

      if (memberError) {
        if (memberError.code === 'PGRST116') {
          // No membership found - user's access was revoked or JWT is stale
          // Clear cached data to prevent showing stale household info
          setHousehold(null)
          setCurrentMember(null)
          await deleteCache(HOUSEHOLD_CACHE_KEY)
          setLoading(false)
          return
        }
        throw memberError
      }

      if (member) {
        const householdData = member.household as Household
        setCurrentMember(member)
        setHousehold(householdData)
        setLoading(false)

        // Cache for next load
        await setCache<CachedHouseholdData>(HOUSEHOLD_CACHE_KEY, {
          household: householdData,
          currentMember: member,
        })
      } else {
        setLoading(false)
      }
    }
  }, [isDemo, supabase, user, jwtHouseholdId])

  // Fetch when auth is ready
  useEffect(() => {
    if (isDemo || authLoading || hasFetchedRef.current) return

    if (user) {
      hasFetchedRef.current = true
      fetchData()
    } else {
      setLoading(false)
    }
  }, [isDemo, authLoading, user, fetchData])

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
    loading: loading || authLoading,
    error,
    refetch: () => fetchData(true), // Skip cache on manual refetch
  }
}

/**
 * Hook to get just the household ID (for components that only need the ID)
 * Uses JWT directly for instant access - no DB call needed
 */
export function useHouseholdId(): string | null {
  const { householdId, loading } = useAuthState()
  // Return null while loading to avoid flicker
  return loading ? null : householdId
}
