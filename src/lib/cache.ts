/**
 * IndexedDB Data Cache
 * Stores page data for instant loading with stale-while-revalidate pattern
 */

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
      dbPromise = null
      reject(request.error)
    }
    request.onsuccess = () => {
      const db = request.result
      dbInstance = db

      // Handle connection close (database deleted, version change, etc.)
      // Reset instance so next call reopens the connection
      db.onclose = () => {
        console.log('[Cache] IndexedDB connection closed, will reopen on next use')
        dbInstance = null
        dbPromise = null
      }

      // Handle version change (another tab upgraded the database)
      db.onversionchange = () => {
        console.log('[Cache] IndexedDB version change detected, closing connection')
        db.close()
        dbInstance = null
        dbPromise = null
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
 */
export async function getCached<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(key)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const result = request.result as CacheEntry<T> | undefined
        resolve(result || null)
      }
    })
  } catch (error) {
    console.warn('[Cache] Failed to get cached data:', error)
    return null
  }
}

/**
 * Store data in cache
 */
export async function setCache<T>(key: string, data: T): Promise<void> {
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

      const request = store.put(entry)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.warn('[Cache] Failed to set cache:', error)
  }
}

/**
 * Clear a specific cache entry
 */
export async function clearCache(key: string): Promise<void> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(key)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.warn('[Cache] Failed to clear cache:', error)
  }
}

/**
 * Clear all cache entries matching a prefix
 * e.g., clearCacheByPrefix('week:') clears all week data
 */
export async function clearCacheByPrefix(prefix: string): Promise<void> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.openCursor()

      request.onerror = () => reject(request.error)
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          if (cursor.key.toString().startsWith(prefix)) {
            cursor.delete()
          }
          cursor.continue()
        } else {
          resolve()
        }
      }
    })
  } catch (error) {
    console.warn('[Cache] Failed to clear cache by prefix:', error)
  }
}

/**
 * Clear all cache entries for a household
 * Use when user logs out or switches household
 */
export async function clearAllCache(): Promise<void> {
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
    console.warn('[Cache] Failed to clear all cache:', error)
  }
}

/**
 * Check if a cache entry is fresh (within maxAge)
 */
export function isCacheFresh(entry: CacheEntry | null, maxAge: number): boolean {
  if (!entry) return false
  return Date.now() - entry.timestamp < maxAge
}

// Default max age: 5 minutes (aligned with service worker nav cache)
export const DEFAULT_MAX_AGE = 5 * 60 * 1000
