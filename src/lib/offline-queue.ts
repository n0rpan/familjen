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
}

let dbInstance: IDBDatabase | null = null

// Open IndexedDB
async function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(request.result)
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
}

// Add a change to the queue
export async function queueChange(change: Omit<PendingChange, 'id' | 'createdAt' | 'retries'>): Promise<string> {
  const db = await openDB()
  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    const pendingChange: PendingChange = {
      ...change,
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
