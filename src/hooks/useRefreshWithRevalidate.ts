'use client'

/**
 * useRefreshWithRevalidate Hook
 *
 * Provides deduplicated router.refresh() calls with pending state tracking.
 * Prevents multiple concurrent refresh operations and provides UI feedback.
 *
 * Features:
 * - Request deduplication: concurrent calls are coalesced into one
 * - Pending state tracking: prevents redundant refreshes
 * - Type-safe refresh functions for each page type
 *
 * NOTE: Server-side cache (unstable_cache) was removed, so revalidation is no
 * longer needed. This hook now just provides deduplication and pending state.
 *
 * @example
 * ```typescript
 * const { refreshWeek, refreshFeed, isPending } = useRefreshWithRevalidate(householdId)
 *
 * // After a mutation:
 * await supabase.from('pickups').update(data)
 * await refreshWeek(weekStart) // Deduplicated refresh
 *
 * // Check pending state for UI feedback:
 * <button disabled={isPending}>Save</button>
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateISO, getWeekStart } from '@/lib/utils'

export interface RefreshWithRevalidateResult {
  /**
   * Refresh after week-related mutations (pickups, meals, events, tasks).
   * @param weekStart - The week start date (defaults to current week)
   */
  refreshWeek: (weekStart?: Date | string) => Promise<void>

  /**
   * Refresh after mutations that affect multiple weeks or household-wide data.
   * Use sparingly - prefer refreshWeek when possible.
   */
  refreshHousehold: () => Promise<void>

  /**
   * Refresh after feed-related mutations (messages, photos, reminders).
   */
  refreshFeed: () => Promise<void>

  /**
   * Refresh after recipe mutations.
   */
  refreshRecipes: () => Promise<void>

  /**
   * Refresh after shopping list mutations.
   */
  refreshShopping: () => Promise<void>

  /**
   * Refresh after settings mutations.
   */
  refreshSettings: () => Promise<void>

  /**
   * Refresh after home control (styring) mutations.
   */
  refreshStyring: () => Promise<void>

  /**
   * Whether any refresh operation is currently in progress.
   * Use for UI feedback (e.g., disable save button while syncing).
   */
  isPending: boolean
}

/**
 * Hook that provides deduplicated refresh functions with pending state.
 *
 * @param householdId - The household ID (used for deduplication keys)
 * @returns Object with typed refresh functions for different page types + isPending state
 */
export function useRefreshWithRevalidate(householdId: string | null): RefreshWithRevalidateResult {
  const router = useRouter()

  // Track pending state for UI feedback
  const [isPending, setIsPending] = useState(false)

  // Track in-flight requests by type to prevent concurrent calls
  // If a request is in-flight, new callers await the existing promise instead of starting a new one
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map())

  // Track mounted state to prevent setState after unmount
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  /**
   * Wrapper that prevents concurrent calls and tracks pending state.
   * If a request of the same type is already in-flight, returns that promise.
   */
  const withDeduplication = useCallback(
    async (type: string, operation: () => Promise<void>) => {
      // Check if this operation type is already in-flight
      const existing = inFlightRef.current.get(type)
      if (existing) {
        // Return existing promise - caller will await the same result
        return existing
      }

      // Start new operation
      setIsPending(true)
      const promise = operation().finally(() => {
        inFlightRef.current.delete(type)
        // Only clear pending if mounted and no other operations are in-flight
        if (isMountedRef.current && inFlightRef.current.size === 0) {
          setIsPending(false)
        }
      })

      inFlightRef.current.set(type, promise)
      return promise
    },
    []
  )

  const refreshWeek = useCallback(
    async (weekStart?: Date | string) => {
      // Default to current week if not provided
      const weekStartStr = weekStart
        ? typeof weekStart === 'string'
          ? weekStart
          : formatDateISO(weekStart)
        : formatDateISO(getWeekStart(new Date()))

      // Use household+week-specific key to allow different weeks/households to refresh independently
      const dedupeKey = householdId ? `${householdId}-week-${weekStartStr}` : `week-${weekStartStr}`

      await withDeduplication(dedupeKey, async () => {
        router.refresh()
      })
    },
    [householdId, router, withDeduplication]
  )

  const refreshHousehold = useCallback(async () => {
    const dedupeKey = householdId ? `${householdId}-household` : 'household'

    await withDeduplication(dedupeKey, async () => {
      router.refresh()
    })
  }, [householdId, router, withDeduplication])

  const refreshFeed = useCallback(async () => {
    const dedupeKey = householdId ? `${householdId}-feed` : 'feed'

    await withDeduplication(dedupeKey, async () => {
      router.refresh()
    })
  }, [householdId, router, withDeduplication])

  const refreshRecipes = useCallback(async () => {
    const dedupeKey = householdId ? `${householdId}-recipes` : 'recipes'

    await withDeduplication(dedupeKey, async () => {
      router.refresh()
    })
  }, [householdId, router, withDeduplication])

  const refreshShopping = useCallback(async () => {
    const dedupeKey = householdId ? `${householdId}-shopping` : 'shopping'

    await withDeduplication(dedupeKey, async () => {
      router.refresh()
    })
  }, [householdId, router, withDeduplication])

  const refreshSettings = useCallback(async () => {
    const dedupeKey = householdId ? `${householdId}-settings` : 'settings'

    await withDeduplication(dedupeKey, async () => {
      router.refresh()
    })
  }, [householdId, router, withDeduplication])

  const refreshStyring = useCallback(async () => {
    const dedupeKey = householdId ? `${householdId}-styring` : 'styring'

    await withDeduplication(dedupeKey, async () => {
      router.refresh()
    })
  }, [householdId, router, withDeduplication])

  return {
    refreshWeek,
    refreshHousehold,
    refreshFeed,
    refreshRecipes,
    refreshShopping,
    refreshSettings,
    refreshStyring,
    isPending,
  }
}
