/**
 * IndexedDB Data Cache
 * Stores page data for instant loading with stale-while-revalidate pattern
 *
 * Note: This works alongside cache-sync.ts (localStorage) for dual-layer caching.
 * - localStorage: Synchronous reads for instant display
 * - IndexedDB: Async reads, larger capacity, durability
 */

import { clearAllCacheSync, deleteCacheSync } from './cache-sync'

// Key for SmartLoading household ID (also defined in SmartLoading.tsx)
const HOUSEHOLD_ID_KEY = 'familjen-current-household'

const DB_NAME = 'familjen-cache'
const DB_VERSION = 1
const STORE_NAME = 'data'

export interface CacheEntry<T = unknown> {
  key: string
  data: T
  timestamp: number
}

let dbInstance: IDBDatabase | null = null
let dbPromise: Promise<IDBDatabase> | null = null

/**
 * Reset the database connection (called on errors to allow reconnection)
 */
function resetConnection(): void {
  if (dbInstance) {
    try {
      dbInstance.close()
    } catch {
      // Ignore close errors
    }
  }
  dbInstance = null
  dbPromise = null
}

/**
 * Check if an error is recoverable by reconnecting
 */
function isRecoverableError(error: unknown): boolean {
  if (error instanceof Error) {
    // These errors often indicate a stale/broken connection
    return (
      error.message.includes('InvalidStateError') ||
      error.message.includes('connection is closing') ||
      error.message.includes('database connection is closed') ||
      error.name === 'InvalidStateError' ||
      error.name === 'TransactionInactiveError'
    )
  }
  return false
}

// Open IndexedDB (singleton with connection pooling)
async function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      // Reset both on error to allow fresh connection attempt
      resetConnection()
      reject(request.error)
    }
    request.onsuccess = () => {
      const db = request.result
      dbInstance = db

      // Handle connection close (database deleted, version change, etc.)
      // Reset instance so next call reopens the connection
      db.onclose = () => {
        console.log('[Cache] IndexedDB connection closed, will reopen on next use')
        resetConnection()
      }

      // Handle version change (another tab upgraded the database)
      db.onversionchange = () => {
        console.log('[Cache] IndexedDB version change detected, closing connection')
        resetConnection()
      }

      // Handle errors on the connection
      db.onerror = (event) => {
        console.warn('[Cache] IndexedDB error:', event)
        resetConnection()
      }

      resolve(db)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
  })

  return dbPromise
}

/**
 * Get cached data by key
 * Returns null if not found or IndexedDB unavailable
 * Automatically retries once on recoverable errors
 */
export async function getCached<T>(key: string, retryCount = 0): Promise<CacheEntry<T> | null> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(key)

      // Handle transaction abort (connection issue)
      tx.onabort = () => reject(tx.error)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const result = request.result as CacheEntry<T> | undefined
        resolve(result || null)
      }
    })
  } catch (error) {
    // If it's a recoverable error and we haven't retried yet, reset and retry
    if (isRecoverableError(error) && retryCount < 1) {
      console.log('[Cache] Recoverable error, resetting connection and retrying:', error)
      resetConnection()
      return getCached<T>(key, retryCount + 1)
    }
    console.warn('[Cache] Failed to get cached data:', error)
    return null
  }
}

/**
 * Store data in cache
 * Automatically retries once on recoverable errors
 */
export async function setCache<T>(key: string, data: T, retryCount = 0): Promise<void> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      const entry: CacheEntry<T> = {
        key,
        data,
        timestamp: Date.now(),
      }

      // Handle transaction abort (connection issue)
      tx.onabort = () => reject(tx.error)

      const request = store.put(entry)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    // If it's a recoverable error and we haven't retried yet, reset and retry
    if (isRecoverableError(error) && retryCount < 1) {
      console.log('[Cache] Recoverable error, resetting connection and retrying:', error)
      resetConnection()
      return setCache<T>(key, data, retryCount + 1)
    }
    console.warn('[Cache] Failed to set cache:', error)
  }
}

/**
 * Delete a specific cache entry by key
 * Use when cached data is known to be stale (e.g., membership revoked)
 * Deletes from both localStorage and IndexedDB
 */
export async function deleteCache(key: string, retryCount = 0): Promise<void> {
  // Delete from localStorage first (synchronous)
  deleteCacheSync(key)

  // Then delete from IndexedDB (async)
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      // Handle transaction abort (connection issue)
      tx.onabort = () => reject(tx.error)

      const request = store.delete(key)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    // If it's a recoverable error and we haven't retried yet, reset and retry
    if (isRecoverableError(error) && retryCount < 1) {
      console.log('[Cache] Recoverable error, resetting connection and retrying:', error)
      resetConnection()
      return deleteCache(key, retryCount + 1)
    }
    console.warn('[Cache] Failed to delete from IndexedDB:', error)
  }
}

/**
 * Clear all cache entries for a household
 * Use when user logs out or switches household
 * Clears both localStorage (sync) and IndexedDB (async) caches
 */
export async function clearAllCache(): Promise<void> {
  // Clear localStorage cache first (synchronous)
  clearAllCacheSync()

  // Clear SmartLoading household ID
  try {
    localStorage.removeItem(HOUSEHOLD_ID_KEY)
  } catch {
    // Ignore storage errors
  }

  // Then clear IndexedDB cache (async)
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.clear()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.warn('[Cache] Failed to clear IndexedDB cache:', error)
  }
}

/**
 * Check if a cache entry is fresh (within maxAge)
 */
export function isCacheFresh(entry: CacheEntry | null, maxAge: number): boolean {
  if (!entry) return false
  return Date.now() - entry.timestamp < maxAge
}

// Default max age: 3 minutes (aligned with service worker nav cache)
export const DEFAULT_MAX_AGE = 3 * 60 * 1000

/**
 * Store data in cache with a specific timestamp (for preserving original fetch time)
 * Used when updating cache with realtime changes - preserves original data freshness
 */
export async function setCacheWithTimestamp<T>(
  key: string,
  data: T,
  timestamp: number,
  retryCount = 0
): Promise<void> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      const entry: CacheEntry<T> = {
        key,
        data,
        timestamp, // Use provided timestamp instead of Date.now()
      }

      tx.onabort = () => reject(tx.error)

      const request = store.put(entry)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    if (isRecoverableError(error) && retryCount < 1) {
      console.log('[Cache] Recoverable error, resetting connection and retrying:', error)
      resetConnection()
      return setCacheWithTimestamp<T>(key, data, timestamp, retryCount + 1)
    }
    console.warn('[Cache] Failed to set cache with timestamp:', error)
  }
}

/**
 * Update cached data with a realtime change
 * This keeps the cache fresh for the next cold start without a server round-trip
 *
 * @param key Cache key to update
 * @param table Table name (pickups, meals, etc.)
 * @param event Event type (INSERT, UPDATE, DELETE)
 * @param data The new/old data from the realtime payload
 * @param idField Field name to use as ID (default: 'id')
 */
export async function updateCacheWithRealtimeChange<T extends Record<string, unknown>>(
  key: string,
  table: string,
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  data: Record<string, unknown>,
  idField = 'id'
): Promise<void> {
  try {
    // Validate data is a valid object (guard against malformed realtime payloads)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return

    const cached = await getCached<T>(key)
    if (!cached) return // No cache to update

    const cacheData = cached.data as Record<string, unknown>

    // Find the array field that corresponds to this table
    // Map table names to cache data fields
    const tableToField: Record<string, string> = {
      // Core data
      pickups: 'pickups',
      meals: 'meals',
      child_tasks: 'tasks',
      children: 'children',
      household_members: 'members',
      // Events
      member_events: 'memberEvents',
      household_events: 'householdEvents',
      external_events: 'externalEvents',
      // Integrations
      external_messages: 'messages',
      external_photos: 'photos',
      event_change_notifications: 'notifications',
      // Shopping & Wishlists
      shopping_lists: 'shoppingLists',
      shopping_list_items: 'items',
      wishlist_items: 'wishlistItems',
      // Recipes
      recipes: 'recipes',
    }

    const arrayField = tableToField[table]
    if (!arrayField) {
      console.warn(`[Cache] Unknown table "${table}" - cannot update cache`)
      return
    }
    if (!Array.isArray(cacheData[arrayField])) return

    const array = cacheData[arrayField] as Record<string, unknown>[]
    const id = data[idField]

    switch (event) {
      case 'INSERT':
        array.push(data)
        break

      case 'UPDATE': {
        const updateIndex = array.findIndex(item => item[idField] === id)
        if (updateIndex !== -1) {
          array[updateIndex] = { ...array[updateIndex], ...data }
        }
        break
      }

      case 'DELETE': {
        const deleteIndex = array.findIndex(item => item[idField] === id)
        if (deleteIndex !== -1) {
          array.splice(deleteIndex, 1)
        }
        break
      }
    }

    // Update the cache with modified data, preserving original timestamp
    await setCacheWithTimestamp(key, cacheData, cached.timestamp)
    console.log(`[Cache] Updated ${table} cache with ${event}`)
  } catch (error) {
    console.warn('[Cache] Failed to update cache with realtime change:', error)
  }
}
