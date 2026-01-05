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
 * to prevent crashes from schema mismatches. See CACHE_VERSION below.
 */

import { useEffect, useState, useMemo } from 'react'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'
import { CACHE_KEYS } from '@/lib/prefetch/pages'
import { HomePageContent, type HomePageContentProps } from './HomePageContent'
import { HomePageSkeleton, RefreshingSkeleton } from '@/components/Skeleton'
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

/**
 * Cache version - increment this when the CachedHomeData structure changes
 * to prevent crashes from stale data with incompatible schema
 *
 * Exported so prefetchHomeData can use the same version
 */
export const CACHE_VERSION = 1

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

interface HomeCacheFallbackProps {
  householdId: string
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
 */
export function HomeCacheFallback({ householdId }: HomeCacheFallbackProps) {
  const [cachedData, setCachedData] = useState<CachedHomeData | null>(null)
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null)
  const [cacheChecked, setCacheChecked] = useState(false)

  // Check IndexedDB cache on mount
  useEffect(() => {
    let mounted = true

    async function checkCache() {
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
            // Store actual cache timestamp for accurate "last updated" display
            setCacheTimestamp(cached.timestamp)
          }
        }
      } catch (error) {
        console.warn('[HomeCache] Failed to read cache:', error)
      } finally {
        if (mounted) setCacheChecked(true)
      }
    }

    checkCache()

    return () => {
      mounted = false
    }
  }, [householdId])

  // Compute props for cached data rendering
  const cachedProps = useMemo(() => {
    if (!cachedData || !cacheTimestamp) return null

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
      // currentUserId is safe to cache - IndexedDB is per-device like session cookies
      // This enables "You are picking up" to show correctly during stale phase
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
      holidays: [] as Holiday[], // Holidays not cached, will update when server data arrives
      weekStart,
      aiHeadsUps: [],
      recentPhotos: [],
      childrenWithoutPickup,
      noMeal,
      isAllReady,
      isDemo: false,
      // Use actual cache timestamp for accurate "last updated" display
      dataTimestamp: cacheTimestamp,
    } as HomePageContentProps
  }, [cachedData, cacheTimestamp, householdId])

  // If cache not checked yet, show skeleton (brief flash while checking IndexedDB)
  if (!cacheChecked) {
    return <HomePageSkeleton />
  }

  // If we have valid cached data, show it with refresh indicator
  if (cachedData && cachedProps) {
    return (
      <div className="relative">
        {/* Refreshing indicator at top */}
        <RefreshingSkeleton />
        {/* Cached content - user sees real data instantly */}
        <HomePageContent {...cachedProps} />
      </div>
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
 * HomeDataCacher - Caches server-rendered data to IndexedDB
 *
 * Include this as a child of HomeDataLoader to cache data after render.
 * This ensures the cache is populated for next PWA restart.
 */
export function HomeDataCacher({ householdId, data }: HomeDataCacherProps) {
  useEffect(() => {
    async function cacheData() {
      try {
        const cacheKey = CACHE_KEYS.home(householdId)
        // Add version to cached data for schema compatibility
        await setCache(cacheKey, { ...data, version: CACHE_VERSION })
      } catch (error) {
        console.warn('[HomeCache] Failed to cache data:', error)
      }
    }

    cacheData()
  }, [householdId, data])

  return null
}
