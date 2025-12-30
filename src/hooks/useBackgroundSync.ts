'use client'

import { useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getPendingChanges, removeChange, incrementRetry, type PendingChange } from '@/lib/offline-queue'

const MAX_RETRIES = 3
const LOW_BATTERY_THRESHOLD = 0.15 // 15% battery

// Custom events for sync status
export const SYNC_EVENTS = {
  SYNC_SUCCESS: 'familjen:sync:success',
  SYNC_FAILURE: 'familjen:sync:failure',
  SYNC_START: 'familjen:sync:start',
  SYNC_COMPLETE: 'familjen:sync:complete',
  SYNC_CONFLICT: 'familjen:sync:conflict',
} as const

export interface SyncFailureDetail {
  table: string
  operation: string
  error: string
  droppedAfterRetries: boolean
}

export interface SyncConflictDetail {
  table: string
  itemId: string
  localData: Record<string, unknown>
  serverUpdatedAt: string
  localUpdatedAt: string
  /** If true, the local change was applied anyway (last-write-wins fallback) */
  autoResolved: boolean
}

function dispatchSyncEvent(type: string, detail?: unknown) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(type, { detail }))
  }
}

/**
 * Check if we should pause sync due to low battery
 * Returns true if battery is low and not charging
 */
async function shouldPauseForBattery(): Promise<boolean> {
  // Battery API is not available in all browsers
  if (!('getBattery' in navigator)) return false

  try {
    // @ts-expect-error - getBattery is not in TypeScript's lib
    const battery = await navigator.getBattery()
    // Pause if battery is low and not charging
    return battery.level < LOW_BATTERY_THRESHOLD && !battery.charging
  } catch {
    // Ignore errors (e.g., permission denied)
    return false
  }
}

/**
 * Background sync hook - processes offline queue when back online
 * Should be mounted once in the app (e.g., in RealtimeWrapper or layout)
 *
 * Battery-aware: Pauses sync when battery is low (<15%) and not charging
 */
export function useBackgroundSync() {
  const isSyncingRef = useRef(false)
  const supabaseRef = useRef(createClient())

  const processQueue = useCallback(async () => {
    if (isSyncingRef.current) return
    if (!navigator.onLine) return

    // Be gentle on mobile - skip sync if battery is critically low
    if (await shouldPauseForBattery()) {
      console.log('[BackgroundSync] Skipping sync - battery low')
      return
    }

    isSyncingRef.current = true

    try {
      const changes = await getPendingChanges()
      if (changes.length === 0) {
        isSyncingRef.current = false
        return
      }

      console.log(`[BackgroundSync] Processing ${changes.length} queued changes`)
      dispatchSyncEvent(SYNC_EVENTS.SYNC_START, { count: changes.length })
      const supabase = supabaseRef.current

      for (const change of changes) {
        try {
          await processChange(supabase, change)
          await removeChange(change.id)
          console.log(`[BackgroundSync] Synced: ${change.table} ${change.operation}`)
          dispatchSyncEvent(SYNC_EVENTS.SYNC_SUCCESS, { table: change.table, operation: change.operation })
        } catch (error) {
          console.warn(`[BackgroundSync] Failed to sync change:`, error)

          const droppedAfterRetries = change.retries >= MAX_RETRIES
          if (droppedAfterRetries) {
            // Give up after max retries
            console.error(`[BackgroundSync] Removing failed change after ${MAX_RETRIES} retries:`, change)
            await removeChange(change.id)
          } else {
            await incrementRetry(change.id)
          }

          // Dispatch failure event so UI can show toast
          dispatchSyncEvent(SYNC_EVENTS.SYNC_FAILURE, {
            table: change.table,
            operation: change.operation,
            error: error instanceof Error ? error.message : 'Unknown error',
            droppedAfterRetries,
          } as SyncFailureDetail)
        }
      }

      dispatchSyncEvent(SYNC_EVENTS.SYNC_COMPLETE)
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

/**
 * Process a single queued change with conflict detection
 *
 * Conflict handling:
 * - insert: Uses upsert with ignoreDuplicates to skip if item already exists
 * - update: Checks updated_at timestamp for conflicts before applying
 * - delete: May fail silently if item was already deleted
 *
 * When a conflict is detected (server has newer data), emits SYNC_CONFLICT event
 * and uses "last write wins" as fallback to maintain data consistency.
 */
async function processChange(
  supabase: ReturnType<typeof createClient>,
  change: PendingChange
): Promise<void> {
  const { table, operation, data, originalUpdatedAt } = change

  switch (operation) {
    case 'insert': {
      // Strip internal _tempId field before sending to DB
      const { _tempId, ...insertData } = data
      // Use upsert with ignoreDuplicates for inserts
      // If another device already created this item, we skip it
      const { error } = await supabase.from(table).upsert(insertData, {
        onConflict: 'id',
        ignoreDuplicates: true,
      })
      if (error) throw error
      break
    }
    case 'update': {
      const { id, ...updateData } = data
      const itemId = id as string

      // Check for conflicts if we have the original timestamp
      if (originalUpdatedAt) {
        const { data: currentData, error: fetchError } = await supabase
          .from(table)
          .select('updated_at')
          .eq('id', itemId)
          .single()

        if (!fetchError && currentData?.updated_at) {
          const serverTime = new Date(currentData.updated_at).getTime()
          const localTime = new Date(originalUpdatedAt).getTime()

          if (serverTime > localTime) {
            // Conflict detected! Server has newer data
            dispatchSyncEvent(SYNC_EVENTS.SYNC_CONFLICT, {
              table,
              itemId,
              localData: updateData,
              serverUpdatedAt: currentData.updated_at,
              localUpdatedAt: originalUpdatedAt,
              autoResolved: true, // We're applying local changes anyway (last-write-wins)
            } as SyncConflictDetail)

            // Continue with update anyway (last-write-wins fallback)
            // In future, we could skip and let user resolve manually
          }
        }
      }

      // Apply the update
      const updateWithId = { id: itemId, ...updateData, updated_at: new Date().toISOString() }
      const { error } = await supabase.from(table).upsert(updateWithId, {
        onConflict: 'id',
      })
      if (error) throw error
      break
    }
    case 'upsert': {
      const { error } = await supabase.from(table).upsert(data, {
        onConflict: 'id',
      })
      if (error) throw error
      break
    }
    case 'delete': {
      // Delete may fail if already deleted by another device - that's OK
      const { id } = data
      const { error } = await supabase.from(table).delete().eq('id', id as string)
      // Ignore "not found" errors for deletes (PGRST116)
      if (error && !error.message?.includes('PGRST116')) throw error
      break
    }
  }
}
