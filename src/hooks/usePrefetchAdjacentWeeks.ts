'use client'

/**
 * usePrefetchAdjacentWeeks Hook
 *
 * Prefetches data for adjacent weeks (previous and next) in the background.
 * This ensures instant navigation when users click week navigation arrows.
 *
 * PERFORMANCE: Uses requestIdleCallback to avoid competing with main content.
 * Only prefetches when the main content is loaded and browser is idle.
 */

import { useEffect, useRef } from 'react'
import { prefetchWeekData } from '@/lib/prefetch/fetchers'

interface UsePrefetchAdjacentWeeksOptions {
  /** Household ID - required for prefetching */
  householdId: string | null
  /** Current week offset (0 = this week, 1 = next week, -1 = previous week) */
  weekOffset?: number
  /** Whether the main content is still loading */
  loading?: boolean
  /** Whether to enable prefetching (default: true) */
  enabled?: boolean
  /** Delay before starting prefetch in ms (default: 1000) */
  delayMs?: number
}

/**
 * Prefetch adjacent weeks for instant week navigation
 */
export function usePrefetchAdjacentWeeks({
  householdId,
  weekOffset = 0,
  loading = false,
  enabled = true,
  delayMs = 1000,
}: UsePrefetchAdjacentWeeksOptions) {
  // Track which weeks we've already prefetched to avoid duplicate fetches
  const prefetchedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    // Don't prefetch if disabled, loading, or no household
    if (!enabled || loading || !householdId) return

    // Bound the set size to prevent memory leak over time
    if (prefetchedRef.current.size > 20) {
      prefetchedRef.current.clear()
    }

    const prefetchAdjacent = () => {
      const prevKey = `${householdId}:${weekOffset - 1}`
      const nextKey = `${householdId}:${weekOffset + 1}`

      // Prefetch previous week if not already done
      if (!prefetchedRef.current.has(prevKey)) {
        prefetchedRef.current.add(prevKey)
        prefetchWeekData(householdId, weekOffset - 1).catch(() => {
          // Remove from set so we can retry later
          prefetchedRef.current.delete(prevKey)
        })
      }

      // Prefetch next week if not already done
      if (!prefetchedRef.current.has(nextKey)) {
        prefetchedRef.current.add(nextKey)
        prefetchWeekData(householdId, weekOffset + 1).catch(() => {
          // Remove from set so we can retry later
          prefetchedRef.current.delete(nextKey)
        })
      }
    }

    // Use requestIdleCallback if available for truly idle prefetching
    // Otherwise fall back to setTimeout with delay
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let idleId: number | undefined

    timeoutId = setTimeout(() => {
      if (typeof requestIdleCallback !== 'undefined') {
        idleId = requestIdleCallback(prefetchAdjacent, { timeout: 5000 })
      } else {
        prefetchAdjacent()
      }
    }, delayMs)

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (idleId && typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(idleId)
      }
    }
  }, [householdId, weekOffset, loading, enabled, delayMs])
}
