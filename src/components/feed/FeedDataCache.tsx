'use client'

/**
 * FeedDataCache - Client Components for Stale-While-Revalidate Pattern
 *
 * Two responsibilities:
 * 1. FeedCacheFallback: Acts as Suspense fallback, shows cached data if available
 * 2. FeedDataCacher: Caches server data to IndexedDB after it renders
 *
 * This enables instant feed page loads by using stale-while-revalidate
 * pattern with localStorage (sync) + IndexedDB (async).
 */

import React, { useEffect, useState, useRef, type ReactNode } from 'react'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'
import { setStoredHouseholdId } from '@/components/SmartLoading'
import { getCachedSync, setCacheSync, isSyncCacheFresh } from '@/lib/cache-sync'
import { CACHE_KEYS, CACHE_VERSION } from '@/lib/cache-constants'
import { safeTransformMessages, safeTransformPhotos } from '@/lib/feed-transforms'
import { FeedPageContent, type FeedPageContentProps } from './FeedPageContent'
import { FeedPageSkeleton } from '@/components/Skeleton'
import type { FeedPageData } from '@/lib/data/server'

// Shape of cached feed data
export interface CachedFeedData extends FeedPageData {
  version?: number
}

/**
 * Compute FeedPageContentProps from cached data.
 *
 * This helper transforms the raw cached data structure into the props
 * expected by FeedPageContent. The main transformations are:
 * - Converting integration records to IntegrationStatus format
 * - Setting empty reminders (AI-generated, not cached)
 *
 * Used by both FeedCacheFallback (Suspense fallback) and feed/loading.tsx
 * (SmartLoading) to ensure consistent prop computation.
 *
 * Type assertions explanation:
 * FeedPageData uses Record<string, unknown>[] for Supabase query flexibility,
 * but we know the runtime shape matches our specific types. The CacheErrorBoundary
 * wrapper provides safety - if cached data causes render errors, we fall back
 * to skeleton gracefully. This is intentional to avoid duplicating type definitions.
 */
export function computeFeedPropsFromCache(cachedData: CachedFeedData): FeedPageContentProps {
  // Validate cached data structure before transformation
  // Log warnings for corrupted cache to help debug issues without crashing
  if (!cachedData.messages || !Array.isArray(cachedData.messages)) {
    console.warn('[FeedCache] Invalid or missing messages in cached data, using empty array')
  }
  if (!cachedData.photos || !Array.isArray(cachedData.photos)) {
    console.warn('[FeedCache] Invalid or missing photos in cached data, using empty array')
  }

  // Use safe transformation utilities that handle both raw and already-transformed data
  // These return empty arrays for invalid input, preventing crashes
  const transformedMessages = safeTransformMessages(cachedData.messages)
  const transformedPhotos = safeTransformPhotos(cachedData.photos)

  return {
    messages: transformedMessages,
    photos: transformedPhotos,
    // Reminders are AI-generated at render time, not cached
    reminders: [],
    notifications: cachedData.notifications as unknown as FeedPageContentProps['notifications'],
    integrationChildren: cachedData.integrationChildren as unknown as FeedPageContentProps['integrationChildren'],
    // Transform integration records to IntegrationStatus format
    integrationStatuses: cachedData.integrations.map(i => ({
      id: i.id,
      service: i.service as 'spond' | 'kidplan' | 'iskole' | 'mykid',
      displayName: i.display_name,
      lastSyncStatus: i.last_sync_status,
      lastSyncError: i.last_sync_error,
      lastSyncAt: i.last_sync_at,
    })),
    duplicateSuggestions: cachedData.duplicateSuggestions as unknown as FeedPageContentProps['duplicateSuggestions'],
    mergedDuplicates: cachedData.mergedDuplicates as unknown as FeedPageContentProps['mergedDuplicates'],
    isDemo: false,
  }
}

// Max age for cached data: 30 minutes
const CACHE_MAX_AGE = 30 * 60 * 1000

interface FeedCacheFallbackProps {
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
    console.warn('[FeedCache] Cached data caused render error, falling back to skeleton:', error.message)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

/**
 * Get initial feed cache state synchronously from localStorage
 */
function getInitialFeedCacheState(householdId: string): CachedFeedData | null {
  const cacheKey = CACHE_KEYS.feed(householdId)
  const syncCached = getCachedSync<CachedFeedData>(cacheKey)

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
 * FeedCacheFallback - Suspense fallback that shows cached data
 */
export function FeedCacheFallback({ householdId }: FeedCacheFallbackProps) {
  // Initialize state synchronously from localStorage (instant, no skeleton flash!)
  const initialCache = getInitialFeedCacheState(householdId)
  const [cachedData, setCachedData] = useState<CachedFeedData | null>(initialCache)
  const [cacheChecked, setCacheChecked] = useState(initialCache !== null)

  // If localStorage didn't have data, try IndexedDB as fallback (async)
  useEffect(() => {
    if (cachedData) return

    let mounted = true

    async function checkIndexedDB() {
      try {
        const cacheKey = CACHE_KEYS.feed(householdId)
        const cached = await getCached<CachedFeedData>(cacheKey)

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
        console.warn('[FeedCache] Failed to read IndexedDB cache:', error)
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
    return <FeedPageSkeleton />
  }

  // If we have valid cached data, show it immediately
  if (cachedData) {
    const props = computeFeedPropsFromCache(cachedData)
    return (
      <CacheErrorBoundary fallback={<FeedPageSkeleton />}>
        <FeedPageContent {...props} />
      </CacheErrorBoundary>
    )
  }

  // No cache available - show standard skeleton
  return <FeedPageSkeleton />
}

interface FeedDataCacherProps {
  householdId: string
  data: FeedPageData
}

/**
 * Generate a fingerprint for feed data to detect actual content changes
 */
function getFeedDataFingerprint(data: FeedPageData): string {
  return [
    data.integrationsEnabled,
    data.integrations.length,
    data.messages.length,
    data.photos.length,
    data.notifications.length,
    data.duplicateSuggestions.length,
    // Include first message ID for change detection
    (data.messages[0] as { id?: string })?.id ?? '',
  ].join('|')
}

/**
 * FeedDataCacher - Caches server-rendered data to localStorage + IndexedDB
 *
 * OPTIMIZATION: Uses fingerprint comparison to skip re-caching when
 * data object reference changes but content is the same.
 */
export function FeedDataCacher({ householdId, data }: FeedDataCacherProps) {
  const lastFingerprintRef = useRef<string | null>(null)

  useEffect(() => {
    const fingerprint = getFeedDataFingerprint(data)

    // Skip re-caching if data content hasn't changed
    if (lastFingerprintRef.current === fingerprint) {
      return
    }
    lastFingerprintRef.current = fingerprint

    async function cacheData() {
      const cacheKey = CACHE_KEYS.feed(householdId)
      const dataWithVersion = { ...data, version: CACHE_VERSION }

      // Store householdId for SmartLoading to use during navigation
      setStoredHouseholdId(householdId)

      // Write to localStorage first (sync, instant reads next time)
      setCacheSync(cacheKey, dataWithVersion)

      // Then write to IndexedDB (async, durability + larger capacity)
      try {
        await setCache(cacheKey, dataWithVersion)
      } catch (error) {
        console.warn('[FeedCache] Failed to cache to IndexedDB:', error)
      }
    }

    cacheData()
  }, [householdId, data])

  return null
}
