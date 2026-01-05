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
 * WeekCacheFallback - Suspense fallback that shows cached data
 *
 * Use this AS the Suspense fallback instead of WeekPageSkeleton:
 *
 * <Suspense fallback={<WeekCacheFallback householdId={id} weekStart={date} />}>
 *   <WeekDataLoader ... />
 * </Suspense>
 */
export function WeekCacheFallback({ householdId, weekStart }: WeekCacheFallbackProps) {
  const [cachedData, setCachedData] = useState<CachedWeekData | null>(null)
  const [cacheChecked, setCacheChecked] = useState(false)

  const weekStartStr = formatDateISO(weekStart)

  // Check IndexedDB cache on mount
  useEffect(() => {
    let mounted = true

    async function checkCache() {
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
          }
        }
      } catch (error) {
        console.warn('[WeekCache] Failed to read cache:', error)
      } finally {
        if (mounted) setCacheChecked(true)
      }
    }

    checkCache()

    return () => {
      mounted = false
    }
  }, [householdId, weekStartStr])

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
 * WeekDataCacher - Caches server-rendered data to IndexedDB
 *
 * Include this as a child of WeekDataLoader to cache data after render.
 */
export function WeekDataCacher({ householdId, weekStart, data }: WeekDataCacherProps) {
  const weekStartStr = formatDateISO(weekStart)

  useEffect(() => {
    async function cacheData() {
      try {
        const cacheKey = CACHE_KEYS.week(householdId, weekStartStr)
        await setCache(cacheKey, { ...data, version: CACHE_VERSION })
      } catch (error) {
        console.warn('[WeekCache] Failed to cache data:', error)
      }
    }

    cacheData()
  }, [householdId, weekStartStr, data])

  return null
}
