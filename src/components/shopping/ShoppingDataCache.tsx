'use client'

/**
 * ShoppingDataCache - Client Components for Stale-While-Revalidate Pattern
 *
 * Two responsibilities:
 * 1. ShoppingCacheFallback: Acts as Suspense fallback, shows cached data if available
 * 2. ShoppingDataCacher: Caches server data to IndexedDB after it renders
 */

import React, { useEffect, useState, type ReactNode } from 'react'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'
import { setStoredHouseholdId } from '@/components/SmartLoading'
import { getCachedSync, setCacheSync, isSyncCacheFresh } from '@/lib/cache-sync'
import { CACHE_KEYS, CACHE_VERSION } from '@/lib/cache-constants'
import { ShoppingPageContent } from './ShoppingPageContent'
import { ShoppingPageSkeleton } from '@/components/Skeleton'
import type { ShoppingPageData } from '@/lib/data/server'

// Shape of cached shopping data
export interface CachedShoppingData extends ShoppingPageData {
  version?: number
}

// Max age for cached data: 30 minutes
const CACHE_MAX_AGE = 30 * 60 * 1000

interface ShoppingCacheFallbackProps {
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
    console.warn('[ShoppingCache] Cached data caused render error, falling back to skeleton:', error.message)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

/**
 * Get initial shopping cache state synchronously from localStorage
 */
function getInitialShoppingCacheState(householdId: string): CachedShoppingData | null {
  const cacheKey = CACHE_KEYS.shopping(householdId)
  const syncCached = getCachedSync<CachedShoppingData>(cacheKey)

  if (syncCached && isSyncCacheFresh(syncCached, CACHE_MAX_AGE)) {
    return syncCached.data
  }

  return null
}

/**
 * ShoppingCacheFallback - Suspense fallback that shows cached data
 */
export function ShoppingCacheFallback({ householdId }: ShoppingCacheFallbackProps) {
  // Initialize state synchronously from localStorage (instant, no skeleton flash!)
  const initialCache = getInitialShoppingCacheState(householdId)
  const [cachedData, setCachedData] = useState<CachedShoppingData | null>(initialCache)
  const [cacheChecked, setCacheChecked] = useState(initialCache !== null)

  // If localStorage didn't have data, try IndexedDB as fallback (async)
  useEffect(() => {
    if (cachedData) return

    let mounted = true

    async function checkIndexedDB() {
      try {
        const cacheKey = CACHE_KEYS.shopping(householdId)
        const cached = await getCached<CachedShoppingData>(cacheKey)

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
        console.warn('[ShoppingCache] Failed to read IndexedDB cache:', error)
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
    return <ShoppingPageSkeleton />
  }

  // If we have valid cached data, show it immediately
  if (cachedData) {
    return (
      <CacheErrorBoundary fallback={<ShoppingPageSkeleton />}>
        <ShoppingPageContent
          initialData={cachedData}
          isDemo={false}
        />
      </CacheErrorBoundary>
    )
  }

  // No cache available - show standard skeleton
  return <ShoppingPageSkeleton />
}

interface ShoppingDataCacherProps {
  householdId: string
  data: ShoppingPageData
}

/**
 * ShoppingDataCacher - Caches server-rendered data to localStorage + IndexedDB
 */
export function ShoppingDataCacher({ householdId, data }: ShoppingDataCacherProps) {
  useEffect(() => {
    async function cacheData() {
      const cacheKey = CACHE_KEYS.shopping(householdId)
      const dataWithVersion = { ...data, version: CACHE_VERSION }

      // Store householdId for SmartLoading to use during navigation
      setStoredHouseholdId(householdId)

      // Write to localStorage first (sync, instant reads next time)
      setCacheSync(cacheKey, dataWithVersion)

      // Then write to IndexedDB (async, durability + larger capacity)
      try {
        await setCache(cacheKey, dataWithVersion)
      } catch (error) {
        console.warn('[ShoppingCache] Failed to cache to IndexedDB:', error)
      }
    }

    cacheData()
  }, [householdId, data])

  return null
}
