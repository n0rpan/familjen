'use client'

import { useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getPendingChanges, removeChange, incrementRetry, type PendingChange } from '@/lib/offline-queue'

const MAX_RETRIES = 3

/**
 * Background sync hook - processes offline queue when back online
 * Should be mounted once in the app (e.g., in RealtimeWrapper or layout)
 */
export function useBackgroundSync() {
  const isSyncingRef = useRef(false)
  const supabaseRef = useRef(createClient())

  const processQueue = useCallback(async () => {
    if (isSyncingRef.current) return
    if (!navigator.onLine) return

    isSyncingRef.current = true

    try {
      const changes = await getPendingChanges()
      if (changes.length === 0) {
        isSyncingRef.current = false
        return
      }

      console.log(`[BackgroundSync] Processing ${changes.length} queued changes`)
      const supabase = supabaseRef.current

      for (const change of changes) {
        try {
          await processChange(supabase, change)
          await removeChange(change.id)
          console.log(`[BackgroundSync] Synced: ${change.table} ${change.operation}`)
        } catch (error) {
          console.warn(`[BackgroundSync] Failed to sync change:`, error)

          if (change.retries >= MAX_RETRIES) {
            // Give up after max retries
            console.error(`[BackgroundSync] Removing failed change after ${MAX_RETRIES} retries:`, change)
            await removeChange(change.id)
          } else {
            await incrementRetry(change.id)
          }
        }
      }
    } catch (error) {
      console.error('[BackgroundSync] Queue processing error:', error)
    } finally {
      isSyncingRef.current = false
    }
  }, [])

  useEffect(() => {
    // Process queue on mount if online
    if (navigator.onLine) {
      processQueue()
    }

    // Listen for online events
    const handleOnline = () => {
      console.log('[BackgroundSync] Back online, processing queue')
      processQueue()
    }

    window.addEventListener('online', handleOnline)

    // Also check when tab becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        processQueue()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [processQueue])
}

// Process a single change
async function processChange(
  supabase: ReturnType<typeof createClient>,
  change: PendingChange
): Promise<void> {
  const { table, operation, data } = change

  switch (operation) {
    case 'insert': {
      const { error } = await supabase.from(table).insert(data)
      if (error) throw error
      break
    }
    case 'update': {
      const { id, ...updateData } = data
      const { error } = await supabase.from(table).update(updateData).eq('id', id)
      if (error) throw error
      break
    }
    case 'upsert': {
      const { error } = await supabase.from(table).upsert(data)
      if (error) throw error
      break
    }
    case 'delete': {
      const { id } = data
      const { error } = await supabase.from(table).delete().eq('id', id as string)
      if (error) throw error
      break
    }
  }
}
