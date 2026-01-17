'use client'

/**
 * RecipesDataCache - Client Components for Stale-While-Revalidate Pattern
 *
 * Two responsibilities:
 * 1. RecipesCacheFallback: Acts as Suspense fallback, shows cached data if available
 * 2. RecipesDataCacher: Caches server data to IndexedDB after it renders
 */

import React, { useEffect, useState, useRef, type ReactNode } from 'react'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'
import { setStoredHouseholdId } from '@/components/SmartLoading'
import { getCachedSync, setCacheSync, isSyncCacheFresh } from '@/lib/cache-sync'
import { CACHE_KEYS, CACHE_VERSION } from '@/lib/cache-constants'
import { RecipesPageContent } from './RecipesPageContent'
import { RecipesPageSkeleton } from '@/components/Skeleton'
import type { RecipesPageData } from '@/lib/data/server'

// Shape of cached recipes data
export interface CachedRecipesData extends RecipesPageData {
  version?: number
}

// Max age for cached data: 30 minutes
const CACHE_MAX_AGE = 30 * 60 * 1000

interface RecipesCacheFallbackProps {
  householdId: string
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
    console.warn('[RecipesCache] Cached data caused render error, falling back to skeleton:', error.message)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

/**
 * Get initial recipes cache state synchronously from localStorage
 */
function getInitialRecipesCacheState(householdId: string): CachedRecipesData | null {
  const cacheKey = CACHE_KEYS.recipes(householdId)
  const syncCached = getCachedSync<CachedRecipesData>(cacheKey)

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
 * RecipesCacheFallback - Suspense fallback that shows cached data
 */
export function RecipesCacheFallback({ householdId }: RecipesCacheFallbackProps) {
  // Initialize state synchronously from localStorage (instant, no skeleton flash!)
  const initialCache = getInitialRecipesCacheState(householdId)
  const [cachedData, setCachedData] = useState<CachedRecipesData | null>(initialCache)
  const [cacheChecked, setCacheChecked] = useState(initialCache !== null)

  // If localStorage didn't have data, try IndexedDB as fallback (async)
  useEffect(() => {
    if (cachedData) return

    let mounted = true

    async function checkIndexedDB() {
      try {
        const cacheKey = CACHE_KEYS.recipes(householdId)
        const cached = await getCached<CachedRecipesData>(cacheKey)

        if (
          cached &&
          isCacheFresh(cached, CACHE_MAX_AGE) &&
          cached.data.version === CACHE_VERSION
        ) {
          if (mounted) {
            setCachedData(cached.data)
            setCacheSync(cacheKey, cached.data)
          }
        }
      } catch (error) {
        console.warn('[RecipesCache] Failed to read IndexedDB cache:', error)
      } finally {
        if (mounted) setCacheChecked(true)
      }
    }

    checkIndexedDB()

    return () => {
      mounted = false
    }
  }, [householdId, cachedData])

  // If cache not checked yet, show skeleton
  if (!cacheChecked) {
    return <RecipesPageSkeleton />
  }

  // If we have valid cached data, show it immediately
  if (cachedData) {
    return (
      <CacheErrorBoundary fallback={<RecipesPageSkeleton />}>
        <RecipesPageContent
          initialData={cachedData}
          isDemo={false}
        />
      </CacheErrorBoundary>
    )
  }

  // No cache available - show standard skeleton
  return <RecipesPageSkeleton />
}

interface RecipesDataCacherProps {
  householdId: string
  data: RecipesPageData
}

/**
 * Generate a fingerprint for recipes data to detect actual content changes
 */
function getRecipesDataFingerprint(data: RecipesPageData): string {
  return [
    data.household?.id ?? '',
    data.recipes.length,
    // Include first recipe ID for change detection
    data.recipes[0]?.id ?? '',
    // Include last recipe ID to detect additions
    data.recipes[data.recipes.length - 1]?.id ?? '',
  ].join('|')
}

/**
 * RecipesDataCacher - Caches server-rendered data to localStorage + IndexedDB
 *
 * OPTIMIZATION: Uses fingerprint comparison to skip re-caching when
 * data object reference changes but content is the same.
 */
export function RecipesDataCacher({ householdId, data }: RecipesDataCacherProps) {
  const lastFingerprintRef = useRef<string | null>(null)

  useEffect(() => {
    const fingerprint = getRecipesDataFingerprint(data)

    // Skip re-caching if data content hasn't changed
    if (lastFingerprintRef.current === fingerprint) {
      return
    }
    lastFingerprintRef.current = fingerprint

    async function cacheData() {
      const cacheKey = CACHE_KEYS.recipes(householdId)
      const dataWithVersion = { ...data, version: CACHE_VERSION }

      // Store householdId for SmartLoading to use during navigation
      setStoredHouseholdId(householdId)

      // Write to localStorage first (sync, instant reads next time)
      setCacheSync(cacheKey, dataWithVersion)

      // Then write to IndexedDB (async, durability + larger capacity)
      try {
        await setCache(cacheKey, dataWithVersion)
      } catch (error) {
        console.warn('[RecipesCache] Failed to cache to IndexedDB:', error)
      }
    }

    cacheData()
  }, [householdId, data])

  return null
}
