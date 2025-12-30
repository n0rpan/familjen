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

// Default max age: 3 minutes (aligned with service worker nav cache)
export const DEFAULT_MAX_AGE = 3 * 60 * 1000
