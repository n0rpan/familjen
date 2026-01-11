/**
 * Offline Change Queue
 * Stores changes when offline and syncs when back online
 */

const DB_NAME = 'familjen-offline'
const DB_VERSION = 1
const STORE_NAME = 'pending-changes'

export interface PendingChange {
  id: string
  table: string
  operation: 'insert' | 'update' | 'upsert' | 'delete'
  data: Record<string, unknown>
  createdAt: string
  retries: number
  /**
   * For updates: the updated_at timestamp of the record when the user started editing.
   * Used for conflict detection - if server's updated_at is newer, there's a conflict.
   */
  originalUpdatedAt?: string
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
      db.onclose = () => {
        console.log('[OfflineQueue] IndexedDB connection closed, will reopen on next use')
        dbInstance = null
        dbPromise = null
      }

      // Handle version change (another tab upgraded the database)
      db.onversionchange = () => {
        console.log('[OfflineQueue] IndexedDB version change detected, closing connection')
        db.close()
        dbInstance = null
        dbPromise = null
      }

      resolve(db)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('table', 'table', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
  })

  return dbPromise
}

export interface QueueChangeOptions {
  table: string
  operation: 'insert' | 'update' | 'upsert' | 'delete'
  data: Record<string, unknown>
  /**
   * For updates: the updated_at timestamp of the record when the user started editing.
   * Used for conflict detection during sync.
   */
  originalUpdatedAt?: string
}

// Add a change to the queue
export async function queueChange(change: QueueChangeOptions): Promise<string> {
  const db = await openDB()
  const id = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    const pendingChange: PendingChange = {
      table: change.table,
      operation: change.operation,
      data: change.data,
      originalUpdatedAt: change.originalUpdatedAt,
      id,
      createdAt: new Date().toISOString(),
      retries: 0,
    }

    const request = store.add(pendingChange)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(id)
  })
}

// Get all pending changes
export async function getPendingChanges(): Promise<PendingChange[]> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const changes = request.result as PendingChange[]
      // Sort by createdAt ascending
      resolve(changes.sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    }
  })
}

// Get pending changes count
export async function getPendingCount(): Promise<number> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.count()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

// Remove a change from the queue
export async function removeChange(id: string): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(id)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

// Update retry count
export async function incrementRetry(id: string): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getRequest = store.get(id)

    getRequest.onerror = () => reject(getRequest.error)
    getRequest.onsuccess = () => {
      const change = getRequest.result as PendingChange | undefined
      if (change) {
        change.retries += 1
        const putRequest = store.put(change)
        putRequest.onerror = () => reject(putRequest.error)
        putRequest.onsuccess = () => resolve()
      } else {
        resolve()
      }
    }
  })
}

// Clear all pending changes
export async function clearAllChanges(): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.clear()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * Find and update a queued insert's data by matching a field value.
 * Used when editing an item that was created offline (before sync).
 */
export async function updateQueuedInsert(
  table: string,
  matchField: string,
  matchValue: unknown,
  updates: Record<string, unknown>
): Promise<boolean> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('table')
    const request = index.openCursor(IDBKeyRange.only(table))

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        const change = cursor.value as PendingChange
        if (change.operation === 'insert' && change.data[matchField] === matchValue) {
          // Found the matching insert - update its data
          change.data = { ...change.data, ...updates }
          const updateRequest = cursor.update(change)
          updateRequest.onerror = () => reject(updateRequest.error)
          updateRequest.onsuccess = () => resolve(true)
          return
        }
        cursor.continue()
      } else {
        // No matching insert found
        resolve(false)
      }
    }
  })
}

/**
 * Find and remove a queued insert by matching a field value.
 * Used when deleting an item that was created offline (before sync).
 */
export async function removeQueuedInsert(
  table: string,
  matchField: string,
  matchValue: unknown
): Promise<boolean> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('table')
    const request = index.openCursor(IDBKeyRange.only(table))

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        const change = cursor.value as PendingChange
        if (change.operation === 'insert' && change.data[matchField] === matchValue) {
          // Found the matching insert - delete it
          const deleteRequest = cursor.delete()
          deleteRequest.onerror = () => reject(deleteRequest.error)
          deleteRequest.onsuccess = () => resolve(true)
          return
        }
        cursor.continue()
      } else {
        // No matching insert found
        resolve(false)
      }
    }
  })
}

// ============================================================================
// Safe Wrappers - Return success/error instead of throwing
// ============================================================================

/**
 * Result of a safe queue operation
 */
export interface QueueOperationResult {
  success: boolean
  error?: string
  id?: string // For queueChange, returns the generated ID
}

/**
 * Safe wrapper for queueChange that catches errors and returns a result object.
 * Use this in components to avoid unhandled promise rejections.
 */
export async function safeQueueChange(change: QueueChangeOptions): Promise<QueueOperationResult> {
  try {
    const id = await queueChange(change)
    return { success: true, id }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue change'
    console.error('[OfflineQueue] Failed to queue change:', error)
    return { success: false, error: message }
  }
}

/**
 * Safe wrapper for updateQueuedInsert that catches errors and returns a result object.
 * Returns success: false if item not found OR if an error occurred.
 */
export async function safeUpdateQueuedInsert(
  table: string,
  matchField: string,
  matchValue: unknown,
  updates: Record<string, unknown>
): Promise<QueueOperationResult> {
  try {
    const updated = await updateQueuedInsert(table, matchField, matchValue, updates)
    if (!updated) {
      return { success: false, error: 'Item not found in queue' }
    }
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update queued item'
    console.error('[OfflineQueue] Failed to update queued insert:', error)
    return { success: false, error: message }
  }
}

/**
 * Safe wrapper for removeQueuedInsert that catches errors and returns a result object.
 * Returns success: false if item not found OR if an error occurred.
 */
export async function safeRemoveQueuedInsert(
  table: string,
  matchField: string,
  matchValue: unknown
): Promise<QueueOperationResult> {
  try {
    const removed = await removeQueuedInsert(table, matchField, matchValue)
    if (!removed) {
      return { success: false, error: 'Item not found in queue' }
    }
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove queued item'
    console.error('[OfflineQueue] Failed to remove queued insert:', error)
    return { success: false, error: message }
  }
}
