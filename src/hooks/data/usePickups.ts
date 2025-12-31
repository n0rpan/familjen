'use client'

/**
 * usePickups Hook
 *
 * Abstracts pickup data fetching and mutations for both demo and production modes.
 * Supports week-based filtering for week planner views.
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - needsFetch: household loaded but fetch for current params not done
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'
import { formatDateISO } from '@/lib/utils'
import type { Pickup, PickupWithDetails, Child, HouseholdMember } from '@/lib/types'

export interface UsePickupsOptions {
  /** Start date for filtering (inclusive) */
  startDate?: Date
  /** End date for filtering (inclusive) */
  endDate?: Date
  /** Children data for hydrating pickups (required for PickupWithDetails) */
  children?: Child[]
  /** Members data for hydrating pickups (required for PickupWithDetails) */
  members?: HouseholdMember[]
}

export interface UsePickupsReturn {
  pickups: PickupWithDetails[]
  loading: boolean
  error: string | null
  /** Update a pickup (create, update, or delete) */
  updatePickup: (childId: string, date: string, pickerId: string | null, time?: string | null) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get pickups with optional filtering by date range
 */
export function usePickups(options: UsePickupsOptions = {}): UsePickupsReturn {
  const { startDate, endDate, children = [], members = [] } = options
  const { isDemo, supabase, demoState, demoMutations } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [pickups, setPickups] = useState<Pickup[]>([])
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
      let query = supabase
        .from('pickups')
        .select('*')
        .eq('household_id', household.id)

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

      if (fetchError) throw fetchError

      setPickups(data || [])
      setLastFetchKey(currentFetchKey)
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return

      console.error('Error fetching pickups:', err)
      setError(err instanceof Error ? err.message : 'Failed to load pickups')
      setLastFetchKey(currentFetchKey) // Mark as fetched even on error
    } finally {
      // Only update if not aborted
      if (!abortControllerRef.current?.signal.aborted) {
        setIsFetching(false)
      }
    }
  }, [isDemo, supabase, household?.id, startDateStr, endDateStr, currentFetchKey])

  // Subscribe to realtime changes for instant sync between parents
  useRealtimeSubscription<Pickup>({
    table: 'pickups',
    filter: household?.id ? createHouseholdFilter(household.id) : undefined,
    enabled: !isDemo && !!household?.id,
    onAny: useCallback(() => {
      // Refetch when any pickup change is detected from another client
      fetchData()
    }, [fetchData]),
  })

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

  // Update pickup mutation
  const updatePickup = useCallback(async (
    childId: string,
    date: string,
    pickerId: string | null,
    time?: string | null
  ) => {
    if (isDemo) {
      demoMutations.updatePickup(childId, date, pickerId, time)
      return
    }

    if (!supabase || !household?.id) return

    try {
      // Check if pickup exists
      const { data: existing } = await supabase
        .from('pickups')
        .select('id')
        .eq('household_id', household.id)
        .eq('child_id', childId)
        .eq('date', date)
        .single()

      if (existing) {
        if (pickerId) {
          // Update
          await supabase
            .from('pickups')
            .update({ picker_id: pickerId })
            .eq('id', existing.id)
        } else {
          // Delete
          await supabase
            .from('pickups')
            .delete()
            .eq('id', existing.id)
        }
      } else if (pickerId) {
        // Insert
        await supabase
          .from('pickups')
          .insert({
            household_id: household.id,
            child_id: childId,
            date,
            picker_id: pickerId,
          })
      }

      // Refetch
      await fetchData()
    } catch (err) {
      console.error('Error updating pickup:', err)
      throw err
    }
  }, [isDemo, supabase, household?.id, demoMutations, fetchData])

  // Hydrate pickups with child and picker details
  const pickupsWithDetails = useMemo((): PickupWithDetails[] => {
    const sourcePickups = isDemo && demoState
      ? demoState.pickups.filter(p => {
          if (startDateStr && p.date < startDateStr) return false
          if (endDateStr && p.date > endDateStr) return false
          return true
        })
      : pickups

    const sourceChildren = isDemo && demoState ? demoState.children : children
    const sourceMembers = isDemo && demoState ? demoState.members : members

    return sourcePickups.map(p => ({
      ...p,
      child: sourceChildren.find(c => c.id === p.child_id)!,
      picker: sourceMembers.find(m => m.id === p.picker_id) || null,
    })).filter(p => p.child) // Filter out pickups with missing child
  }, [isDemo, demoState, pickups, children, members, startDateStr, endDateStr])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    return {
      pickups: pickupsWithDetails,
      loading: false,
      error: null,
      updatePickup,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state
  const needsFetch = !!household?.id && lastFetchKey !== currentFetchKey && !isFetching
  const loading = householdLoading || needsFetch || isFetching

  return {
    pickups: pickupsWithDetails,
    loading,
    error,
    updatePickup,
    refetch: fetchData,
  }
}
