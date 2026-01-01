'use client'

/**
 * usePickups Hook
 *
 * Abstracts pickup data fetching and mutations for both demo and production modes.
 * Supports week-based filtering for week planner views.
 *
 * PERFORMANCE: Uses optimistic updates for instant UI feedback.
 * When a parent assigns a pickup, the UI updates immediately while
 * the server sync happens in the background. Rollback on failure.
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - needsFetch: household loaded but fetch for current params not done
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold, useHouseholdId } from './useHousehold'
import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'
import { generateTempId, isTempId } from '@/hooks/useOptimisticMutation'
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
  /** Whether an optimistic update is syncing to server */
  isSyncing: boolean
  /** Update a pickup (create, update, or delete) - instant with optimistic update */
  updatePickup: (childId: string, date: string, pickerId: string | null, time?: string | null) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get pickups with optional filtering by date range
 */
export function usePickups(options: UsePickupsOptions = {}): UsePickupsReturn {
  const { startDate, endDate, children = [], members = [] } = options
  const { isDemo, supabase, demoState, demoMutations } = useDataSource()
  // Use JWT-based household ID for faster access
  const householdId = useHouseholdId()
  const { loading: householdLoading } = useHousehold()

  const [pickups, setPickups] = useState<Pickup[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastFetchKey, setLastFetchKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Track abort controller for cleanup
  const abortControllerRef = useRef<AbortController | null>(null)
  // Track pending optimistic updates for rollback
  const pendingUpdatesRef = useRef<Map<string, Pickup | null>>(new Map())

  const startDateStr = startDate ? formatDateISO(startDate) : null
  const endDateStr = endDate ? formatDateISO(endDate) : null

  // Memoize fetch key to prevent unnecessary re-renders
  const currentFetchKey = useMemo(
    () => `${householdId}-${startDateStr}-${endDateStr}`,
    [householdId, startDateStr, endDateStr]
  )

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !householdId) return

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
        .eq('household_id', householdId)

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

      // Merge server data with any pending optimistic updates
      // This ensures optimistic changes aren't lost during refetch
      let mergedData = data || []
      pendingUpdatesRef.current.forEach((originalPickup, key) => {
        const [childId, date] = key.split('|')
        // Keep optimistic version if still pending
        const serverVersion = mergedData.find(p => p.child_id === childId && p.date === date)
        if (!serverVersion && originalPickup === null) {
          // Optimistic insert not yet on server - keep the temp version
          const tempPickup = pickups.find(p => p.child_id === childId && p.date === date && isTempId(p.id))
          if (tempPickup) {
            mergedData = [...mergedData, tempPickup]
          }
        }
      })

      setPickups(mergedData)
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
  }, [isDemo, supabase, householdId, startDateStr, endDateStr, currentFetchKey, pickups])

  // Debounced refetch for realtime - prevents thundering herd when multiple changes come in
  const realtimeRefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedRefetch = useCallback(() => {
    if (realtimeRefetchTimer.current) {
      clearTimeout(realtimeRefetchTimer.current)
    }
    realtimeRefetchTimer.current = setTimeout(() => {
      fetchData()
    }, 300) // 300ms debounce for realtime changes
  }, [fetchData])

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (realtimeRefetchTimer.current) {
        clearTimeout(realtimeRefetchTimer.current)
      }
    }
  }, [])

  // Subscribe to realtime changes for instant sync between parents
  useRealtimeSubscription<Pickup>({
    table: 'pickups',
    filter: householdId ? createHouseholdFilter(householdId) : undefined,
    enabled: !isDemo && !!householdId,
    onAny: debouncedRefetch,
  })

  // Fetch when household or date range changes
  useEffect(() => {
    if (!isDemo && householdId && lastFetchKey !== currentFetchKey) {
      fetchData()
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [isDemo, householdId, lastFetchKey, currentFetchKey, fetchData])

  // Update pickup mutation with OPTIMISTIC UPDATE
  // UI updates instantly, server sync happens in background
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

    if (!supabase || !householdId) return

    const updateKey = `${childId}|${date}`
    const existingPickup = pickups.find(p => p.child_id === childId && p.date === date)

    // 1. OPTIMISTIC UPDATE - instant UI feedback
    if (pickerId) {
      if (existingPickup) {
        // Update existing pickup optimistically
        pendingUpdatesRef.current.set(updateKey, existingPickup)
        setPickups(prev => prev.map(p =>
          p.child_id === childId && p.date === date
            ? { ...p, picker_id: pickerId }
            : p
        ))
      } else {
        // Insert new pickup optimistically with temp ID
        pendingUpdatesRef.current.set(updateKey, null) // null = was insert
        const tempPickup: Pickup = {
          id: generateTempId(),
          household_id: householdId,
          child_id: childId,
          date,
          picker_id: pickerId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        setPickups(prev => [...prev, tempPickup])
      }
    } else {
      // Delete optimistically
      if (existingPickup) {
        pendingUpdatesRef.current.set(updateKey, existingPickup)
        setPickups(prev => prev.filter(p => !(p.child_id === childId && p.date === date)))
      }
    }

    // 2. SYNC TO SERVER in background
    setIsSyncing(true)
    try {
      if (existingPickup && !isTempId(existingPickup.id)) {
        if (pickerId) {
          // Update
          const { error } = await supabase
            .from('pickups')
            .update({ picker_id: pickerId, updated_at: new Date().toISOString() })
            .eq('id', existingPickup.id)
          if (error) throw error
        } else {
          // Delete
          const { error } = await supabase
            .from('pickups')
            .delete()
            .eq('id', existingPickup.id)
          if (error) throw error
        }
      } else if (pickerId) {
        // Insert
        const { data, error } = await supabase
          .from('pickups')
          .insert({
            household_id: householdId,
            child_id: childId,
            date,
            picker_id: pickerId,
          })
          .select()
          .single()
        if (error) throw error

        // Replace temp ID with real ID
        if (data) {
          setPickups(prev => prev.map(p =>
            p.child_id === childId && p.date === date && isTempId(p.id)
              ? { ...p, id: data.id }
              : p
          ))
        }
      }

      // Success - clear pending update
      pendingUpdatesRef.current.delete(updateKey)
    } catch (err) {
      console.error('Error updating pickup:', err)

      // 3. ROLLBACK on failure
      const originalPickup = pendingUpdatesRef.current.get(updateKey)
      if (originalPickup === null) {
        // Was an insert - remove the optimistic entry
        setPickups(prev => prev.filter(p => !(p.child_id === childId && p.date === date && isTempId(p.id))))
      } else if (originalPickup) {
        // Was an update or delete - restore original
        setPickups(prev => {
          const withoutCurrent = prev.filter(p => !(p.child_id === childId && p.date === date))
          return [...withoutCurrent, originalPickup]
        })
      }
      pendingUpdatesRef.current.delete(updateKey)

      setError(err instanceof Error ? err.message : 'Kunne ikke lagre')
      throw err
    } finally {
      setIsSyncing(false)
    }
  }, [isDemo, supabase, householdId, demoMutations, pickups])

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
      isSyncing: false,
      updatePickup,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state
  const needsFetch = !!householdId && lastFetchKey !== currentFetchKey && !isFetching
  const loading = householdLoading || needsFetch || isFetching

  return {
    pickups: pickupsWithDetails,
    loading,
    error,
    isSyncing,
    updatePickup,
    refetch: fetchData,
  }
}
