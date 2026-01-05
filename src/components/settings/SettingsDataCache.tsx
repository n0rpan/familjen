'use client'

/**
 * SettingsDataCache - Client Components for Stale-While-Revalidate Pattern
 *
 * Two responsibilities:
 * 1. SettingsCacheFallback: Acts as Suspense fallback, shows cached data if available
 * 2. SettingsDataCacher: Caches server data to IndexedDB after it renders
 */

import React, { useEffect, useState, type ReactNode } from 'react'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'
import { getCachedSync, setCacheSync, isSyncCacheFresh } from '@/lib/cache-sync'
import { CACHE_KEYS, CACHE_VERSION } from '@/lib/cache-constants'
import { SettingsPageContent } from './SettingsPageContent'
import { SettingsPageSkeleton } from '@/components/Skeleton'
import type { SettingsPageData } from '@/lib/data/server'

// Shape of cached settings data
export interface CachedSettingsData extends SettingsPageData {
  version?: number
}

// Max age for cached data: 30 minutes
const CACHE_MAX_AGE = 30 * 60 * 1000

interface SettingsCacheFallbackProps {
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
    console.warn('[SettingsCache] Cached data caused render error, falling back to skeleton:', error.message)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

/**
 * Get initial settings cache state synchronously from localStorage
 */
function getInitialSettingsCacheState(householdId: string): CachedSettingsData | null {
  const cacheKey = CACHE_KEYS.settings(householdId)
  const syncCached = getCachedSync<CachedSettingsData>(cacheKey)

  if (syncCached && isSyncCacheFresh(syncCached, CACHE_MAX_AGE)) {
    return syncCached.data
  }

  return null
}

/**
 * SettingsCacheFallback - Suspense fallback that shows cached data
 */
export function SettingsCacheFallback({ householdId }: SettingsCacheFallbackProps) {
  // Initialize state synchronously from localStorage (instant, no skeleton flash!)
  const initialCache = getInitialSettingsCacheState(householdId)
  const [cachedData, setCachedData] = useState<CachedSettingsData | null>(initialCache)
  const [cacheChecked, setCacheChecked] = useState(initialCache !== null)

  // If localStorage didn't have data, try IndexedDB as fallback (async)
  useEffect(() => {
    if (cachedData) return

    let mounted = true

    async function checkIndexedDB() {
      try {
        const cacheKey = CACHE_KEYS.settings(householdId)
        const cached = await getCached<CachedSettingsData>(cacheKey)

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
        console.warn('[SettingsCache] Failed to read IndexedDB cache:', error)
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
    return <SettingsPageSkeleton />
  }

  // If we have valid cached data, show it immediately
  if (cachedData) {
    // Find first member as "myProfile" for cached view
    const myProfile = cachedData.members[0] || null

    return (
      <CacheErrorBoundary fallback={<SettingsPageSkeleton />}>
        <SettingsPageContent
          initialData={{
            household: cachedData.household,
            members: cachedData.members,
            children: cachedData.children,
            myProfile,
            connectedCalendarEmail: cachedData.connectedCalendarEmail,
            user: null, // User not available from cache
          }}
          isDemo={false}
        />
      </CacheErrorBoundary>
    )
  }

  // No cache available - show standard skeleton
  return <SettingsPageSkeleton />
}

interface SettingsDataCacherProps {
  householdId: string
  data: SettingsPageData
}

/**
 * SettingsDataCacher - Caches server-rendered data to localStorage + IndexedDB
 */
export function SettingsDataCacher({ householdId, data }: SettingsDataCacherProps) {
  useEffect(() => {
    async function cacheData() {
      const cacheKey = CACHE_KEYS.settings(householdId)
      const dataWithVersion = { ...data, version: CACHE_VERSION }

      // Write to localStorage first (sync, instant reads next time)
      setCacheSync(cacheKey, dataWithVersion)

      // Then write to IndexedDB (async, durability + larger capacity)
      try {
        await setCache(cacheKey, dataWithVersion)
      } catch (error) {
        console.warn('[SettingsCache] Failed to cache to IndexedDB:', error)
      }
    }

    cacheData()
  }, [householdId, data])

  return null
}
