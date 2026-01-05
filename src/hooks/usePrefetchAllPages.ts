/**
 * usePrefetchAllPages Hook
 *
 * When mounted on home page:
 * 1. Prefetches all page data in menu order
 * 2. Sets up background refresh every 10 minutes
 * 3. Refreshes when app returns from background (visibility change)
 *
 * This ensures instant navigation to any page and fresh data
 * even without realtime (e.g., when app was backgrounded).
 */

import { useEffect, useRef } from 'react'
import {
  prefetchAllPages,
  refreshAllCaches,
  BACKGROUND_REFRESH_INTERVAL,
} from '@/lib/prefetch/pages'

interface UsePrefetchAllPagesOptions {
  householdId: string | null
  enabled?: boolean // Set to false for demo mode or when not on home
}

export function usePrefetchAllPages({ householdId, enabled = true }: UsePrefetchAllPagesOptions) {
  const lastRefreshRef = useRef<number>(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!enabled || !householdId) return

    // Prefetch all pages on mount (with staggered delays)
    prefetchAllPages(householdId)
    lastRefreshRef.current = Date.now()

    // Set up background refresh interval
    intervalRef.current = setInterval(() => {
      refreshAllCaches(householdId)
      lastRefreshRef.current = Date.now()
    }, BACKGROUND_REFRESH_INTERVAL)

    // Refresh when app returns from background
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const timeSinceLastRefresh = Date.now() - lastRefreshRef.current

        // If more than 5 minutes since last refresh, refresh now
        if (timeSinceLastRefresh > 5 * 60 * 1000) {
          refreshAllCaches(householdId)
          lastRefreshRef.current = Date.now()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Cleanup
    const interval = intervalRef.current
    return () => {
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [householdId, enabled])
}
