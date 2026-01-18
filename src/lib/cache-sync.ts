/**
 * Synchronous localStorage Cache Layer
 *
 * Provides instant cache reads during initial render (no skeleton flash).
 * localStorage is synchronous, unlike IndexedDB which requires async/useEffect.
 *
 * Strategy:
 * - Write to BOTH localStorage (fast reads) and IndexedDB (large storage, durability)
 * - Read from localStorage first (sync), fall back to IndexedDB (async) if needed
 * - Keep IndexedDB as source of truth for larger data and background sync
 *
 * Size limit: 5MB total for localStorage (plenty for home/week data ~50-100KB)
 */

import { CACHE_VERSION } from './cache-constants'

const STORAGE_PREFIX = 'familjen-cache:'

export interface SyncCacheEntry<T = unknown> {
  data: T
  timestamp: number
  version: number
}

/**
 * Check if localStorage is available
 */
function isLocalStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const testKey = '__test__'
    localStorage.setItem(testKey, testKey)
    localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}

/**
 * Get cached data synchronously from localStorage
 * Returns null if not found, invalid, or localStorage unavailable
 *
 * Use this during initial render for instant cache access!
 */
export function getCachedSync<T>(key: string): SyncCacheEntry<T> | null {
  if (!isLocalStorageAvailable()) return null

  try {
    const storageKey = STORAGE_PREFIX + key
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null

    const entry = JSON.parse(raw) as SyncCacheEntry<T>

    // Validate version to prevent schema mismatch crashes
    if (entry.version !== CACHE_VERSION) {
      // Clear stale entry
      localStorage.removeItem(storageKey)
      return null
    }

    return entry
  } catch (error) {
    console.warn('[CacheSync] Failed to read from localStorage:', error)
    return null
  }
}

/**
 * Store data synchronously to localStorage
 * Silently fails if localStorage is full or unavailable
 */
export function setCacheSync<T>(key: string, data: T): void {
  if (!isLocalStorageAvailable()) return

  try {
    const storageKey = STORAGE_PREFIX + key
    const entry: SyncCacheEntry<T> = {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    }

    localStorage.setItem(storageKey, JSON.stringify(entry))
  } catch (error) {
    // QuotaExceededError or other storage errors
    // Silently fail - IndexedDB is the fallback
    console.warn('[CacheSync] Failed to write to localStorage:', error)

    // Try to make space by clearing old cache entries
    try {
      clearOldCacheEntries()
      // Retry after cleanup
      const storageKey = STORAGE_PREFIX + key
      const entry: SyncCacheEntry<T> = {
        data,
        timestamp: Date.now(),
        version: CACHE_VERSION,
      }
      localStorage.setItem(storageKey, JSON.stringify(entry))
    } catch {
      // Still failed, give up silently
    }
  }
}

/**
 * Delete a specific cache entry from localStorage
 */
export function deleteCacheSync(key: string): void {
  if (!isLocalStorageAvailable()) return

  try {
    localStorage.removeItem(STORAGE_PREFIX + key)
  } catch {
    // Ignore errors
  }
}

/**
 * Delete all cache entries matching a prefix from localStorage
 * Useful for clearing all week caches (week-{householdId}-*) at once
 */
export function deleteCacheSyncByPrefix(prefix: string): void {
  if (!isLocalStorageAvailable()) return

  try {
    const fullPrefix = STORAGE_PREFIX + prefix
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(fullPrefix)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))
  } catch {
    // Ignore errors
  }
}

/**
 * Clear all familjen cache entries from localStorage
 */
export function clearAllCacheSync(): void {
  if (!isLocalStorageAvailable()) return

  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))
  } catch {
    // Ignore errors
  }
}

/**
 * Clear old cache entries when storage is full
 * Removes entries older than 1 hour
 */
function clearOldCacheEntries(): void {
  const ONE_HOUR = 60 * 60 * 1000
  const now = Date.now()

  try {
    const keysToRemove: string[] = []

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(STORAGE_PREFIX)) continue

      try {
        const raw = localStorage.getItem(key)
        if (!raw) continue

        const entry = JSON.parse(raw) as SyncCacheEntry
        if (now - entry.timestamp > ONE_HOUR) {
          keysToRemove.push(key)
        }
      } catch {
        // Invalid entry, remove it
        keysToRemove.push(key)
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key))
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Check if a sync cache entry is fresh (within maxAge)
 */
export function isSyncCacheFresh(entry: SyncCacheEntry | null, maxAge: number): boolean {
  if (!entry) return false
  return Date.now() - entry.timestamp < maxAge
}
