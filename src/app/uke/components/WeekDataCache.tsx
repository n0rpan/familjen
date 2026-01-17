'use client'

/**
 * WeekDataCache - Client Components for Stale-While-Revalidate Pattern
 *
 * Two responsibilities:
 * 1. WeekCacheFallback: Acts as Suspense fallback, shows cached data if available
 * 2. WeekDataCacher: Caches server data to IndexedDB after it renders
 *
 * This enables instant week page loads by using stale-while-revalidate
 * pattern with IndexedDB, same as home page.
 */

import React, { useEffect, useState, useMemo, type ReactNode } from 'react'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'
import { setStoredHouseholdId } from '@/components/SmartLoading'
import { getCachedSync, setCacheSync, isSyncCacheFresh } from '@/lib/cache-sync'
import { CACHE_KEYS, CACHE_VERSION } from '@/lib/cache-constants'
import { WeekPageContent } from './WeekPageContent'
import { WeekPageSkeleton } from '@/components/Skeleton'
import { getWeekStart, getWeekNumber, formatDateISO } from '@/lib/utils'
import type {
  Child,
  HouseholdMember,
  PickupWithDetails,
  MealWithRecipe,
  Recipe,
  MemberEvent,
  HouseholdEvent,
  ExternalEvent,
  ChildTask,
  Household,
} from '@/lib/types'
import type { Holiday } from '@/lib/utils'

// Shape of cached week data in IndexedDB
export interface CachedWeekData {
  version?: number
  household: Household | null
  children: Child[]
  members: HouseholdMember[]
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
  recipes: Recipe[]
  memberEvents: MemberEvent[]
  householdEvents: HouseholdEvent[]
  externalEvents: ExternalEvent[]
  tasks: ChildTask[]
  holidays: Holiday[]
  weekStart: string  // ISO date string
  weekEnd: string    // ISO date string
  weekContext: string
  currentUserId?: string
}

// Max age for cached data: 30 minutes
const CACHE_MAX_AGE = 30 * 60 * 1000

interface WeekCacheFallbackProps {
  householdId: string
  weekStart: Date
}

/**
 * Simple error boundary for cached content rendering
 */
class CacheErrorBoundary extends React.Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.warn('[WeekCache] Cached data caused render error, falling back to skeleton:', error.message)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

/**
 * Get initial week cache state synchronously from localStorage
 * This runs during component initialization (before render), enabling instant cache display
 */
function getInitialWeekCacheState(householdId: string, weekStartStr: string): CachedWeekData | null {
  const cacheKey = CACHE_KEYS.week(householdId, weekStartStr)
  const syncCached = getCachedSync<CachedWeekData>(cacheKey)

  // Check freshness AND version - old cache without version should be ignored
  if (
    syncCached &&
    isSyncCacheFresh(syncCached, CACHE_MAX_AGE) &&
    syncCached.data.version === CACHE_VERSION
  ) {
    return syncCached.data
  }

  return null
}

/**
 * WeekCacheFallback - Suspense fallback that shows cached data
 *
 * Use this AS the Suspense fallback instead of WeekPageSkeleton:
 *
 * <Suspense fallback={<WeekCacheFallback householdId={id} weekStart={date} />}>
 *   <WeekDataLoader ... />
 * </Suspense>
 */
export function WeekCacheFallback({ householdId, weekStart }: WeekCacheFallbackProps) {
  const weekStartStr = formatDateISO(weekStart)

  // Initialize state synchronously from localStorage (instant, no skeleton flash!)
  const initialCache = getInitialWeekCacheState(householdId, weekStartStr)
  const [cachedData, setCachedData] = useState<CachedWeekData | null>(initialCache)
  const [cacheChecked, setCacheChecked] = useState(initialCache !== null)

  // If localStorage didn't have data, try IndexedDB as fallback (async)
  useEffect(() => {
    // Skip if we already have data from localStorage
    if (cachedData) return

    let mounted = true

    async function checkIndexedDB() {
      try {
        const cacheKey = CACHE_KEYS.week(householdId, weekStartStr)
        const cached = await getCached<CachedWeekData>(cacheKey)

        // Validate cache: must exist, be fresh, and have compatible version
        if (
          cached &&
          isCacheFresh(cached, CACHE_MAX_AGE) &&
          cached.data.version === CACHE_VERSION
        ) {
          if (mounted) {
            setCachedData(cached.data)
            // Also populate localStorage for next time
            setCacheSync(cacheKey, cached.data)
          }
        }
      } catch (error) {
        console.warn('[WeekCache] Failed to read IndexedDB cache:', error)
      } finally {
        if (mounted) setCacheChecked(true)
      }
    }

    checkIndexedDB()

    return () => {
      mounted = false
    }
  }, [householdId, weekStartStr, cachedData])

  // Compute props for cached data rendering
  const cachedProps = useMemo(() => {
    if (!cachedData) return null

    const parsedWeekStart = new Date(cachedData.weekStart + 'T00:00:00')
    const parsedWeekEnd = new Date(cachedData.weekEnd + 'T00:00:00')
    const currentWeekNumber = getWeekNumber(new Date())
    const displayWeekNumber = getWeekNumber(parsedWeekStart)

    return {
      householdId: cachedData.household?.id || householdId,
      currentUserId: cachedData.currentUserId,
      household: cachedData.household,
      children: cachedData.children,
      members: cachedData.members,
      pickups: cachedData.pickups,
      meals: cachedData.meals,
      recipes: cachedData.recipes,
      memberEvents: cachedData.memberEvents,
      householdEvents: cachedData.householdEvents,
      externalEvents: cachedData.externalEvents,
      childTasks: cachedData.tasks,
      holidays: cachedData.holidays,
      weekStart: parsedWeekStart,
      weekEnd: parsedWeekEnd,
      weekContext: cachedData.weekContext,
      weekNumber: displayWeekNumber,
      isCurrentWeek: displayWeekNumber === currentWeekNumber && parsedWeekStart.getFullYear() === new Date().getFullYear(),
      isDemo: false,
    }
  }, [cachedData, householdId])

  // If cache not checked yet, show skeleton (brief flash while checking IndexedDB)
  if (!cacheChecked) {
    return <WeekPageSkeleton />
  }

  // If we have valid cached data, show it immediately
  if (cachedData && cachedProps) {
    return (
      <CacheErrorBoundary fallback={<WeekPageSkeleton />}>
        <WeekPageContent {...cachedProps} />
      </CacheErrorBoundary>
    )
  }

  // No cache available - show standard skeleton
  return <WeekPageSkeleton />
}

interface WeekDataCacherProps {
  householdId: string
  weekStart: Date
  data: CachedWeekData
}

/**
 * WeekDataCacher - Caches server-rendered data to localStorage + IndexedDB
 *
 * Include this as a child of WeekDataLoader to cache data after render.
 *
 * Dual storage strategy:
 * - localStorage: Instant synchronous reads on next navigation
 * - IndexedDB: Durability, larger storage capacity, background sync
 */
export function WeekDataCacher({ householdId, weekStart, data }: WeekDataCacherProps) {
  const weekStartStr = formatDateISO(weekStart)

  useEffect(() => {
    async function cacheData() {
      const cacheKey = CACHE_KEYS.week(householdId, weekStartStr)
      const dataWithVersion = { ...data, version: CACHE_VERSION }

      // Store householdId for SmartLoading to use during navigation
      setStoredHouseholdId(householdId)

      // Write to localStorage first (sync, instant reads next time)
      setCacheSync(cacheKey, dataWithVersion)

      // Then write to IndexedDB (async, durability + larger capacity)
      try {
        await setCache(cacheKey, dataWithVersion)
      } catch (error) {
        console.warn('[WeekCache] Failed to cache to IndexedDB:', error)
      }
    }

    cacheData()
  }, [householdId, weekStartStr, data])

  return null
}
