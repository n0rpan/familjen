'use client'

/**
 * HomeDataCache - Client Components for Stale-While-Revalidate Pattern
 *
 * Two responsibilities:
 * 1. HomeCacheFallback: Acts as Suspense fallback, shows cached data if available
 * 2. HomeDataCacher: Caches server data to IndexedDB after it renders
 *
 * This enables instant home page loads after PWA updates by using
 * stale-while-revalidate pattern with IndexedDB.
 *
 * IMPORTANT: The cache version must be incremented when the data structure changes
 * to prevent crashes from schema mismatches. See CACHE_VERSION in @/lib/cache-constants.
 *
 * Cache Invalidation:
 * - Cache is cleared on logout and account deletion (see src/lib/cache.ts clearAllCache)
 * - Cache is household-scoped via key: home-{householdId}
 * - Switching households naturally uses different cache key
 * - Version mismatch causes cache to be ignored (falls back to skeleton)
 */

import React, { useEffect, useState, useMemo, useRef, type ReactNode } from 'react'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'
import { getCachedSync, setCacheSync, isSyncCacheFresh } from '@/lib/cache-sync'
import { CACHE_KEYS, CACHE_VERSION } from '@/lib/cache-constants'
import { setStoredHouseholdId } from '@/components/SmartLoading'
import { HomePageContent, type HomePageContentProps } from './HomePageContent'
import { HomePageSkeleton } from '@/components/Skeleton'
import { formatDateISO, getWeekStart } from '@/lib/utils'
import type {
  Child,
  HouseholdMember,
  PickupWithDetails,
  MealWithRecipe,
  MemberEvent,
  HouseholdEvent,
  ExternalEvent,
  ChildTaskWithChild,
  DaySummary,
} from '@/lib/types'
import type { Holiday } from '@/lib/utils'

// Shape of cached home data in IndexedDB
export interface CachedHomeData {
  // Version for schema compatibility
  version?: number
  // Core data
  household: { id: string } | null
  children: Child[]
  members: HouseholdMember[]
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
  tasks: ChildTaskWithChild[]
  memberEvents: MemberEvent[]
  householdEvents: HouseholdEvent[]
  externalEvents: ExternalEvent[]
  weekStart: string
  weekEnd: string
  // User context - safe to cache since IndexedDB is per-device like session cookies
  currentUserId?: string
}

// Max age for cached data: 30 minutes
const CACHE_MAX_AGE = 30 * 60 * 1000

/**
 * Transform raw cached data into HomePageContentProps
 * Used by both HomeCacheFallback and loading.tsx
 */
export function computeHomePropsFromCache(
  cachedData: CachedHomeData,
  householdId: string,
  cacheTimestamp?: number
): HomePageContentProps {
  const todayStr = formatDateISO(new Date())
  const weekStart = cachedData.weekStart
    ? new Date(cachedData.weekStart + 'T00:00:00')
    : getWeekStart(new Date())

  // Calculate today's summary
  const todaySummary: DaySummary = {
    date: todayStr,
    pickups: cachedData.pickups.filter(p => p.date === todayStr),
    meal: cachedData.meals.find(m => m.date === todayStr) || null,
    tasks: cachedData.tasks.filter(t => t.date === todayStr),
    householdEvents: cachedData.householdEvents.filter(e => e.event_date === todayStr),
    memberEvents: cachedData.memberEvents.filter(e => e.date === todayStr),
    externalEvents: cachedData.externalEvents.filter(e => e.event_date === todayStr),
  }

  // Calculate status for attention banner
  const todayPickups = cachedData.pickups.filter(p => p.date === todayStr)
  const todayMeal = cachedData.meals.find(m => m.date === todayStr)
  const childrenWithoutPickup = cachedData.children.filter(child =>
    !todayPickups.some(p => p.child_id === child.id && p.picker_id)
  ) as Child[]
  const noMeal = !todayMeal || (!todayMeal.recipe_id && !todayMeal.custom_meal)
  const isAllReady = childrenWithoutPickup.length === 0 && !noMeal

  return {
    householdId: cachedData.household?.id || householdId,
    currentUserId: cachedData.currentUserId,
    children: cachedData.children,
    members: cachedData.members,
    todaySummary,
    pickups: cachedData.pickups,
    meals: cachedData.meals,
    memberEvents: cachedData.memberEvents,
    householdEvents: cachedData.householdEvents,
    externalEvents: cachedData.externalEvents,
    childTasks: cachedData.tasks,
    holidays: [] as Holiday[],
    weekStart,
    aiHeadsUps: [],
    recentPhotos: [],
    childrenWithoutPickup,
    noMeal,
    isAllReady,
    isDemo: false,
    dataTimestamp: cacheTimestamp,
  }
}

interface HomeCacheFallbackProps {
  householdId: string
}

/**
 * Simple error boundary for cached content rendering
 * Falls back to skeleton if cached data causes render errors
 */
interface ErrorBoundaryState {
  hasError: boolean
}

class CacheErrorBoundary extends React.Component<
  { children: ReactNode; fallback: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.warn('[HomeCache] Cached data caused render error, falling back to skeleton:', error.message)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

/**
 * HomeCacheFallback - Suspense fallback that shows cached data
 *
 * Use this AS the Suspense fallback instead of HomePageSkeleton:
 *
 * <Suspense fallback={<HomeCacheFallback householdId={id} />}>
 *   <HomeDataLoader ... />
 * </Suspense>
 *
 * Flow:
 * 1. On mount, immediately check IndexedDB for cached home data
 * 2. If fresh cache exists with valid version, render HomePageContent + RefreshingSkeleton
 * 3. If no cache or stale, render HomePageSkeleton
 * 4. When server content streams in, Suspense replaces this component entirely
 *
 * Error Handling:
 * - If cached data has schema mismatch despite version check, CacheErrorBoundary catches
 *   the render error and gracefully falls back to HomePageSkeleton
 */
/**
 * Get initial cache state synchronously from localStorage
 * This runs during component initialization (before render), enabling instant cache display
 */
function getInitialCacheState(householdId: string): {
  data: CachedHomeData | null
  timestamp: number | null
} {
  const cacheKey = CACHE_KEYS.home(householdId)
  const syncCached = getCachedSync<CachedHomeData>(cacheKey)

  if (syncCached && isSyncCacheFresh(syncCached, CACHE_MAX_AGE)) {
    return { data: syncCached.data, timestamp: syncCached.timestamp }
  }

  return { data: null, timestamp: null }
}

export function HomeCacheFallback({ householdId }: HomeCacheFallbackProps) {
  // Initialize state synchronously from localStorage (instant, no skeleton flash!)
  const initialCache = getInitialCacheState(householdId)
  const [cachedData, setCachedData] = useState<CachedHomeData | null>(initialCache.data)
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(initialCache.timestamp)
  const [cacheChecked, setCacheChecked] = useState(initialCache.data !== null)

  // If localStorage didn't have data, try IndexedDB as fallback (async)
  useEffect(() => {
    // Skip if we already have data from localStorage
    if (cachedData) return

    let mounted = true

    async function checkIndexedDB() {
      try {
        const cacheKey = CACHE_KEYS.home(householdId)
        const cached = await getCached<CachedHomeData>(cacheKey)

        // Validate cache: must exist, be fresh, and have compatible version
        if (
          cached &&
          isCacheFresh(cached, CACHE_MAX_AGE) &&
          cached.data.version === CACHE_VERSION
        ) {
          if (mounted) {
            setCachedData(cached.data)
            setCacheTimestamp(cached.timestamp)
            // Also populate localStorage for next time
            setCacheSync(cacheKey, cached.data)
          }
        }
      } catch (error) {
        console.warn('[HomeCache] Failed to read IndexedDB cache:', error)
      } finally {
        if (mounted) setCacheChecked(true)
      }
    }

    checkIndexedDB()

    return () => {
      mounted = false
    }
  }, [householdId, cachedData])

  // Compute props for cached data rendering using shared helper
  const cachedProps = useMemo(() => {
    if (!cachedData || !cacheTimestamp) return null
    return computeHomePropsFromCache(cachedData, householdId, cacheTimestamp)
  }, [cachedData, cacheTimestamp, householdId])

  // If cache not checked yet, show skeleton (brief flash while checking IndexedDB)
  if (!cacheChecked) {
    return <HomePageSkeleton />
  }

  // If we have valid cached data, show it immediately without any loading indicator
  // The server content will seamlessly replace this when ready via Suspense
  // No "Oppdaterer..." indicator - cached data is trusted, realtime keeps it fresh
  if (cachedData && cachedProps) {
    return (
      <CacheErrorBoundary fallback={<HomePageSkeleton />}>
        <HomePageContent {...cachedProps} />
      </CacheErrorBoundary>
    )
  }

  // No cache available - show standard skeleton
  return <HomePageSkeleton />
}

interface HomeDataCacherProps {
  householdId: string
  data: CachedHomeData
}

/**
 * Generate a fingerprint for home data to detect actual content changes
 * Uses data counts and key IDs to avoid expensive JSON.stringify
 */
function getHomeDataFingerprint(data: CachedHomeData): string {
  return [
    data.household?.id ?? '',
    data.children.length,
    data.members.length,
    data.pickups.length,
    data.meals.length,
    data.tasks.length,
    data.memberEvents.length,
    data.householdEvents.length,
    data.externalEvents.length,
    data.weekStart,
    // Include first item IDs for change detection
    data.pickups[0]?.id ?? '',
    data.meals[0]?.id ?? '',
  ].join('|')
}

/**
 * HomeDataCacher - Caches server-rendered data to localStorage + IndexedDB
 *
 * Include this as a child of HomeDataLoader to cache data after render.
 * This ensures the cache is populated for next PWA restart.
 *
 * Dual storage strategy:
 * - localStorage: Instant synchronous reads on next navigation
 * - IndexedDB: Durability, larger storage capacity, background sync
 *
 * OPTIMIZATION: Uses fingerprint comparison to skip re-caching when
 * data object reference changes but content is the same.
 */
export function HomeDataCacher({ householdId, data }: HomeDataCacherProps) {
  const lastFingerprintRef = useRef<string | null>(null)

  useEffect(() => {
    const fingerprint = getHomeDataFingerprint(data)

    // Skip re-caching if data content hasn't changed
    if (lastFingerprintRef.current === fingerprint) {
      return
    }
    lastFingerprintRef.current = fingerprint

    async function cacheData() {
      const cacheKey = CACHE_KEYS.home(householdId)
      const dataWithVersion = { ...data, version: CACHE_VERSION }

      // Store householdId for SmartLoading to use during navigation
      setStoredHouseholdId(householdId)

      // Write to localStorage first (sync, instant reads next time)
      setCacheSync(cacheKey, dataWithVersion)

      // Then write to IndexedDB (async, durability + larger capacity)
      try {
        await setCache(cacheKey, dataWithVersion)
      } catch (error) {
        console.warn('[HomeCache] Failed to cache to IndexedDB:', error)
      }
    }

    cacheData()
  }, [householdId, data])

  return null
}
