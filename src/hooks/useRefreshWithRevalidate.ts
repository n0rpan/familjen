'use client'

/**
 * useRefreshWithRevalidate Hook
 *
 * Ensures server cache is invalidated BEFORE calling router.refresh().
 * This prevents the race condition where router.refresh() fetches stale data
 * because unstable_cache hasn't been invalidated yet.
 *
 * ALWAYS use this hook instead of calling router.refresh() directly after mutations.
 *
 * @example
 * ```typescript
 * const { refreshWeek, refreshFeed } = useRefreshWithRevalidate(householdId)
 *
 * // After a mutation:
 * await supabase.from('pickups').update(data)
 * await refreshWeek(weekStart) // Revalidates cache THEN refreshes
 * ```
 */

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  revalidateWeek,
  revalidateHousehold,
  revalidateFeed,
  revalidateRecipes,
  revalidateShopping,
  revalidateSettings,
  revalidateStyring,
} from '@/lib/revalidate'
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
}

/**
 * Hook that provides safe refresh functions that always revalidate cache first.
 *
 * @param householdId - The household ID (required for cache invalidation)
 * @returns Object with typed refresh functions for different page types
 */
export function useRefreshWithRevalidate(householdId: string | null): RefreshWithRevalidateResult {
  const router = useRouter()

  const refreshWeek = useCallback(
    async (weekStart?: Date | string) => {
      if (!householdId || householdId === 'demo') {
        router.refresh()
        return
      }

      // Default to current week if not provided
      const weekStartStr = weekStart
        ? typeof weekStart === 'string'
          ? weekStart
          : formatDateISO(weekStart)
        : formatDateISO(getWeekStart(new Date()))

      await revalidateWeek(householdId, weekStartStr)
      router.refresh()
    },
    [householdId, router]
  )

  const refreshHousehold = useCallback(async () => {
    if (!householdId || householdId === 'demo') {
      router.refresh()
      return
    }

    await revalidateHousehold(householdId)
    router.refresh()
  }, [householdId, router])

  const refreshFeed = useCallback(async () => {
    if (!householdId || householdId === 'demo') {
      router.refresh()
      return
    }

    await revalidateFeed(householdId)
    router.refresh()
  }, [householdId, router])

  const refreshRecipes = useCallback(async () => {
    if (!householdId || householdId === 'demo') {
      router.refresh()
      return
    }

    await revalidateRecipes(householdId)
    router.refresh()
  }, [householdId, router])

  const refreshShopping = useCallback(async () => {
    if (!householdId || householdId === 'demo') {
      router.refresh()
      return
    }

    await revalidateShopping(householdId)
    router.refresh()
  }, [householdId, router])

  const refreshSettings = useCallback(async () => {
    if (!householdId || householdId === 'demo') {
      router.refresh()
      return
    }

    await revalidateSettings(householdId)
    router.refresh()
  }, [householdId, router])

  const refreshStyring = useCallback(async () => {
    if (!householdId || householdId === 'demo') {
      router.refresh()
      return
    }

    await revalidateStyring(householdId)
    router.refresh()
  }, [householdId, router])

  return {
    refreshWeek,
    refreshHousehold,
    refreshFeed,
    refreshRecipes,
    refreshShopping,
    refreshSettings,
    refreshStyring,
  }
}
