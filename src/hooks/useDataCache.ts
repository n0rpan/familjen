'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getCached, setCache, clearCache, DEFAULT_MAX_AGE, type CacheEntry } from '@/lib/cache'

interface UseDataCacheOptions {
  /**
   * Max age in milliseconds before data is considered stale
   * Default: 5 minutes (aligned with service worker)
   */
  maxAge?: number
  /**
   * Skip initial fetch if false (useful for conditional fetching)
   */
  enabled?: boolean
  /**
   * Called when fresh data is fetched
   */
  onSuccess?: (data: unknown) => void
}

interface UseDataCacheReturn<T> {
  /**
   * The cached or fetched data
   */
  data: T | null
  /**
   * True while fetching fresh data (cached data may still be shown)
   */
  isValidating: boolean
  /**
   * True if no data (cached or fresh) has been loaded yet
   */
  isLoading: boolean
  /**
   * Error from the last fetch attempt
   */
  error: Error | null
  /**
   * Manually update the data (updates both state and cache)
   */
  mutate: (newData: T | ((current: T | null) => T)) => Promise<void>
  /**
   * Force a revalidation (fetch fresh data)
   */
  revalidate: () => Promise<void>
  /**
   * Clear the cache for this key
   */
  invalidate: () => Promise<void>
}

/**
 * SWR-like hook with IndexedDB caching
 *
 * Usage:
 * ```tsx
 * const { data, isValidating, mutate } = useDataCache(
 *   `week:${householdId}:${weekOffset}`,
 *   () => fetchWeekData(householdId, weekOffset)
 * )
 * ```
 */
export function useDataCache<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseDataCacheOptions = {}
): UseDataCacheReturn<T> {
  const { maxAge = DEFAULT_MAX_AGE, enabled = true, onSuccess } = options

  const [data, setData] = useState<T | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Track if component is mounted
  const mountedRef = useRef(true)
  // Track current key to avoid stale updates
  const keyRef = useRef(key)
  keyRef.current = key
  // Track if we have data to avoid stale closure in error handler
  const hasDataRef = useRef(false)

  // Load cached data on mount
  useEffect(() => {
    if (!key || !enabled) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    const loadFromCache = async () => {
      try {
        const cached = await getCached<T>(key)
        if (cancelled || keyRef.current !== key) return

        if (cached) {
          setData(cached.data)
          hasDataRef.current = true
          setIsLoading(false)

          // If cache is fresh, we're done
          const isFresh = Date.now() - cached.timestamp < maxAge
          if (isFresh) {
            return
          }
        }

        // Fetch fresh data
        await fetchFresh()
      } catch (err) {
        if (!cancelled && keyRef.current === key) {
          setIsLoading(false)
          setError(err instanceof Error ? err : new Error('Failed to load'))
        }
      }
    }

    const fetchFresh = async () => {
      if (cancelled || keyRef.current !== key) return

      setIsValidating(true)
      setError(null)

      try {
        const freshData = await fetcher()
        if (cancelled || keyRef.current !== key) return

        setData(freshData)
        hasDataRef.current = true
        setIsLoading(false)
        setIsValidating(false)

        // Update cache
        await setCache(key, freshData)

        onSuccess?.(freshData)
      } catch (err) {
        if (!cancelled && keyRef.current === key) {
          setIsValidating(false)
          // Only set error if we don't have cached data
          if (!hasDataRef.current) {
            setError(err instanceof Error ? err : new Error('Failed to fetch'))
          }
          console.error('[useDataCache] Fetch error:', err)
        }
      }
    }

    loadFromCache()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Mutate function to update data
  const mutate = useCallback(async (newData: T | ((current: T | null) => T)) => {
    if (!key) return

    const resolvedData = typeof newData === 'function'
      ? (newData as (current: T | null) => T)(data)
      : newData

    setData(resolvedData)
    await setCache(key, resolvedData)
  }, [key, data])

  // Force revalidation
  const revalidate = useCallback(async () => {
    if (!key || !enabled || !mountedRef.current) return

    setIsValidating(true)
    setError(null)

    try {
      const freshData = await fetcher()
      if (!mountedRef.current || keyRef.current !== key) return

      setData(freshData)
      setIsValidating(false)
      await setCache(key, freshData)
      onSuccess?.(freshData)
    } catch (err) {
      if (mountedRef.current && keyRef.current === key) {
        setIsValidating(false)
        setError(err instanceof Error ? err : new Error('Failed to revalidate'))
      }
    }
  }, [key, enabled, fetcher, onSuccess])

  // Invalidate cache
  const invalidate = useCallback(async () => {
    if (!key) return
    await clearCache(key)
    setData(null)
    hasDataRef.current = false
    setIsLoading(true)
  }, [key])

  return {
    data,
    isValidating,
    isLoading,
    error,
    mutate,
    revalidate,
    invalidate,
  }
}
