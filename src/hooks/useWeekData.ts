'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCachedWeekData, fetchAndCacheWeekData, getWeekCacheKey } from '@/lib/prefetch/fetchers'
import { setCache } from '@/lib/cache'
import type { WeekCacheData } from '@/lib/types'

interface UseWeekDataOptions {
  weekOffset: number
  enabled?: boolean
}

interface UseWeekDataReturn {
  data: WeekCacheData | null
  isLoading: boolean
  isValidating: boolean
  error: string | null
  revalidate: () => Promise<void>
  mutate: (updater: (current: WeekCacheData | null) => WeekCacheData | null) => void
}

/**
 * Hook for loading week data with cache-first pattern
 * Shows cached data immediately, then refreshes in background
 */
export function useWeekData({ weekOffset, enabled = true }: UseWeekDataOptions): UseWeekDataReturn {
  const [data, setData] = useState<WeekCacheData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [householdId, setHouseholdId] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])
  const mountedRef = useRef(true)
  const currentOffsetRef = useRef(weekOffset)
  currentOffsetRef.current = weekOffset
  const hasDataRef = useRef(false)

  // Get user's household ID on mount
  useEffect(() => {
    if (!enabled) return

    const getHouseholdId = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setIsLoading(false)
          return
        }

        const { data: membership } = await supabase
          .from('household_members')
          .select('household_id')
          .eq('user_id', user.id)
          .maybeSingle()

        if (membership?.household_id) {
          setHouseholdId(membership.household_id)
        } else {
          setIsLoading(false)
        }
      } catch (err) {
        console.error('[useWeekData] Failed to get household:', err)
        setIsLoading(false)
      }
    }

    getHouseholdId()
  }, [supabase, enabled])

  // Load data when householdId or weekOffset changes
  useEffect(() => {
    if (!householdId || !enabled) return

    let cancelled = false

    const loadData = async () => {
      // First, try to load from cache (instant)
      try {
        const cached = await getCachedWeekData(householdId, weekOffset)
        if (cached && !cancelled && currentOffsetRef.current === weekOffset) {
          setData(cached)
          hasDataRef.current = true
          setIsLoading(false)
          // Don't return - still fetch fresh in background
        }
      } catch (err) {
        console.warn('[useWeekData] Cache read failed:', err)
      }

      // Then fetch fresh data in background
      if (!cancelled) {
        setIsValidating(true)
      }

      try {
        const freshData = await fetchAndCacheWeekData(householdId, weekOffset)
        if (!cancelled && mountedRef.current && currentOffsetRef.current === weekOffset) {
          setData(freshData)
          hasDataRef.current = true
          setIsLoading(false)
          setIsValidating(false)
          setError(null)
        }
      } catch (err) {
        if (!cancelled && mountedRef.current && currentOffsetRef.current === weekOffset) {
          console.error('[useWeekData] Fetch failed:', err)
          setError(err instanceof Error ? err.message : 'Failed to load data')
          setIsValidating(false)
          // Keep cached data visible if we have it
          if (!hasDataRef.current) {
            setIsLoading(false)
          }
        }
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [householdId, weekOffset, enabled])

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Force revalidation
  const revalidate = useCallback(async () => {
    if (!householdId) return

    const offsetAtStart = weekOffset
    setIsValidating(true)
    try {
      const freshData = await fetchAndCacheWeekData(householdId, offsetAtStart)
      // Only update state if still on same week (prevent stale data on wrong week)
      if (mountedRef.current && currentOffsetRef.current === offsetAtStart) {
        setData(freshData)
        hasDataRef.current = true
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current && currentOffsetRef.current === offsetAtStart) {
        setError(err instanceof Error ? err.message : 'Failed to refresh')
      }
    } finally {
      if (mountedRef.current) {
        setIsValidating(false)
      }
    }
  }, [householdId, weekOffset])

  // Mutate cached data (for realtime updates)
  const mutate = useCallback((updater: (current: WeekCacheData | null) => WeekCacheData | null) => {
    if (!householdId) return

    setData(current => {
      const updated = updater(current)
      if (updated) {
        // Also update the cache
        const cacheKey = getWeekCacheKey(householdId, weekOffset)
        setCache(cacheKey, updated).catch(err => {
          console.warn('[useWeekData] Failed to update cache:', err)
        })
      }
      return updated
    })
  }, [householdId, weekOffset])

  return {
    data,
    isLoading,
    isValidating,
    error,
    revalidate,
    mutate,
  }
}
