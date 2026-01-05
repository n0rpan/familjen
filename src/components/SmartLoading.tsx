'use client'

/**
 * SmartLoading - Client component for route loading states
 *
 * Next.js shows loading.tsx during navigation BEFORE our page renders.
 * This means the Suspense fallback in page.tsx never gets to show cached data.
 *
 * Solution: Make loading.tsx render this client component which:
 * 1. Checks localStorage for cached data (synchronous, instant)
 * 2. If cache exists and is fresh, render the cached content
 * 3. If no cache, fall back to skeleton
 *
 * This eliminates the skeleton flash for cached pages.
 */

import { getCachedSync, isSyncCacheFresh } from '@/lib/cache-sync'
import { CACHE_KEYS, CACHE_VERSION } from '@/lib/cache-constants'
import { getWeekStart, formatDateISO } from '@/lib/utils'

// Cache max age (30 minutes) - same as cache fallback components
const CACHE_MAX_AGE = 30 * 60 * 1000

// Key for storing current household ID (set by DataCacher components)
const HOUSEHOLD_ID_KEY = 'familjen-current-household'

interface SmartLoadingProps {
  /** Page identifier for cache key lookup */
  page: 'home' | 'week' | 'feed' | 'shopping' | 'recipes' | 'settings' | 'styring'
  /** Skeleton component to show when no cache */
  skeleton: React.ReactNode
  /** Component to render with cached data */
  children: (data: unknown) => React.ReactNode
}

/**
 * Get householdId from localStorage (set by DataCacher components)
 */
function getStoredHouseholdId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(HOUSEHOLD_ID_KEY)
  } catch {
    return null
  }
}

/**
 * Get cache key for a page
 */
function getCacheKey(page: string, householdId: string): string {
  switch (page) {
    case 'home':
      return CACHE_KEYS.home(householdId)
    case 'week': {
      // Week page uses current week start in cache key
      const weekStart = getWeekStart(new Date())
      return CACHE_KEYS.week(householdId, formatDateISO(weekStart))
    }
    case 'feed':
      return CACHE_KEYS.feed(householdId)
    case 'shopping':
      return CACHE_KEYS.shopping(householdId)
    case 'recipes':
      return CACHE_KEYS.recipes(householdId)
    case 'settings':
      return CACHE_KEYS.settings(householdId)
    case 'styring':
      return CACHE_KEYS.styring(householdId)
    default:
      return ''
  }
}

export function SmartLoading({ page, skeleton, children }: SmartLoadingProps) {
  // Get householdId from localStorage
  const householdId = getStoredHouseholdId()

  // No household ID = can't check cache, show skeleton
  if (!householdId) {
    return <>{skeleton}</>
  }

  // Check localStorage synchronously (this runs during initial render)
  const cacheKey = getCacheKey(page, householdId)
  const cached = getCachedSync<{ version?: number }>(cacheKey)

  // No cache or stale cache = show skeleton
  if (!cached || !isSyncCacheFresh(cached, CACHE_MAX_AGE)) {
    return <>{skeleton}</>
  }

  // Version mismatch = show skeleton (data structure may have changed)
  if (cached.data.version !== CACHE_VERSION) {
    return <>{skeleton}</>
  }

  // Cache hit! Render cached content
  return <>{children(cached.data)}</>
}

/**
 * Store householdId for SmartLoading to use
 * Call this from DataCacher components after caching data
 */
export function setStoredHouseholdId(householdId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(HOUSEHOLD_ID_KEY, householdId)
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear stored householdId (call on logout)
 */
export function clearStoredHouseholdId(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(HOUSEHOLD_ID_KEY)
  } catch {
    // Ignore storage errors
  }
}
