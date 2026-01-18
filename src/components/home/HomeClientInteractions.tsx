'use client'

/**
 * HomeClientInteractions - Client Component
 *
 * Handles all client-side interactivity for the home page:
 * - Realtime subscriptions for the current week
 * - Page refresh on data changes
 * - IndexedDB cache updates for instant cold starts
 * - Prefetching adjacent weeks
 *
 * This component renders nothing visible - it just sets up the subscriptions.
 */

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePrefetchAdjacentWeeks } from '@/hooks/usePrefetchAdjacentWeeks'
import { usePrefetchRoutes, KEY_ROUTES, SECONDARY_ROUTES } from '@/hooks/usePrefetchRoutes'
import { usePrefetchAllPages } from '@/hooks/usePrefetchAllPages'
import { useRefreshWithRevalidate } from '@/hooks/useRefreshWithRevalidate'
import { formatDateISO, getWeekStart, addDays } from '@/lib/utils'
import { updateCacheWithRealtimeChange } from '@/lib/cache'
import { CACHE_KEYS } from '@/lib/cache-constants'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

interface HomeClientInteractionsProps {
  householdId: string
  isDemo: boolean
}

export function HomeClientInteractions({ householdId, isDemo }: HomeClientInteractionsProps) {
  const { refreshWeek } = useRefreshWithRevalidate(householdId)
  const supabaseRef = useRef(isDemo ? null : createClient())

  // Prefetch adjacent weeks for instant navigation to /uke
  usePrefetchAdjacentWeeks({
    householdId,
    weekOffset: 0,
    loading: false,
    enabled: !isDemo,
  })

  // Prefetch other key routes (feed, shopping, etc.)
  // Pass empty array in demo mode to skip prefetching
  usePrefetchRoutes(isDemo ? [] : [...KEY_ROUTES, ...SECONDARY_ROUTES])

  // Prefetch ALL page data and set up background refresh (every 10 min)
  // This ensures instant navigation to any page
  usePrefetchAllPages({
    householdId,
    enabled: !isDemo,
  })

  // Throttle state for realtime events - prevents flooding while keeping first update instant
  // Throttle (not debounce): first event fires immediately, then limits rate for subsequent events
  const lastRefreshRef = useRef<number>(0)
  const pendingRefreshRef = useRef<NodeJS.Timeout | null>(null)
  const THROTTLE_MS = 500 // Minimum time between refreshes

  // Realtime subscriptions for the current week
  useEffect(() => {
    if (isDemo || !supabaseRef.current) return

    const supabase = supabaseRef.current
    const weekStart = getWeekStart(new Date())
    const weekEnd = addDays(weekStart, 6)
    const weekStartStr = formatDateISO(weekStart)
    const weekEndStr = formatDateISO(weekEnd)
    const homeCacheKey = CACHE_KEYS.home(householdId)

    // Throttled refresh - first event is INSTANT, subsequent events are rate-limited
    // This ensures spouse-to-spouse updates are immediate while preventing flood during bulk sync
    // Uses the hook for proper deduplication and cache invalidation
    const scheduleRefresh = () => {
      const now = Date.now()
      const timeSinceLastRefresh = now - lastRefreshRef.current

      if (timeSinceLastRefresh >= THROTTLE_MS) {
        // Enough time has passed - refresh immediately
        lastRefreshRef.current = now
        refreshWeek(weekStartStr) // Hook handles revalidation + router.refresh() with deduplication
      } else if (!pendingRefreshRef.current) {
        // Schedule a refresh for when throttle window expires
        const delay = THROTTLE_MS - timeSinceLastRefresh
        pendingRefreshRef.current = setTimeout(() => {
          lastRefreshRef.current = Date.now()
          pendingRefreshRef.current = null
          refreshWeek(weekStartStr)
        }, delay)
      }
      // If there's already a pending refresh, do nothing (it will pick up all changes)
    }

    // Update IndexedDB cache with realtime change, then schedule throttled refresh
    // This keeps cache fresh for next cold start AND updates current view
    const handleRealtimeChange = (
      table: string,
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'
      const data = eventType === 'DELETE' ? payload.old : payload.new

      // Update IndexedDB cache immediately (async, don't await)
      if (data && typeof data === 'object') {
        updateCacheWithRealtimeChange(homeCacheKey, table, eventType, data as Record<string, unknown>)
      }

      // Schedule throttled refresh (first is instant, subsequent are rate-limited)
      scheduleRefresh()
    }

    // Subscribe to changes for pickups, meals, and tasks in the current week
    const channel = supabase
      .channel(`home-realtime-${householdId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pickups',
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          // Only refresh if the change is for the current week
          const date = (payload.new as { date?: string } | null)?.date ||
                       (payload.old as { date?: string } | null)?.date
          if (date && date >= weekStartStr && date <= weekEndStr) {
            handleRealtimeChange('pickups', payload)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'meals',
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          const date = (payload.new as { date?: string } | null)?.date ||
                       (payload.old as { date?: string } | null)?.date
          if (date && date >= weekStartStr && date <= weekEndStr) {
            handleRealtimeChange('meals', payload)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'child_tasks',
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          const date = (payload.new as { date?: string } | null)?.date ||
                       (payload.old as { date?: string } | null)?.date
          if (date && date >= weekStartStr && date <= weekEndStr) {
            handleRealtimeChange('child_tasks', payload)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'member_events',
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => handleRealtimeChange('member_events', payload)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'household_events',
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => handleRealtimeChange('household_events', payload)
      )
      .subscribe()

    // Cleanup: clear pending timer, reset throttle state, and remove channel
    return () => {
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current)
        pendingRefreshRef.current = null
      }
      // Reset throttle timestamp so first event after re-subscribe is instant
      lastRefreshRef.current = 0
      supabase.removeChannel(channel)
    }
  }, [householdId, isDemo, refreshWeek])

  // This component doesn't render anything visible
  return null
}
