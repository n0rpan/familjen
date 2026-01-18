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
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePrefetchAdjacentWeeks } from '@/hooks/usePrefetchAdjacentWeeks'
import { usePrefetchRoutes, KEY_ROUTES, SECONDARY_ROUTES } from '@/hooks/usePrefetchRoutes'
import { usePrefetchAllPages } from '@/hooks/usePrefetchAllPages'
import { formatDateISO, getWeekStart, addDays } from '@/lib/utils'
import { revalidateWeek } from '@/lib/revalidate'
import { updateCacheWithRealtimeChange } from '@/lib/cache'
import { CACHE_KEYS } from '@/lib/cache-constants'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

interface HomeClientInteractionsProps {
  householdId: string
  isDemo: boolean
}

export function HomeClientInteractions({ householdId, isDemo }: HomeClientInteractionsProps) {
  const router = useRouter()
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

  // Debounce timer for realtime events - prevents flooding when many events arrive at once
  // (e.g., syncing multiple pickups or meals simultaneously)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const DEBOUNCE_MS = 500 // Wait 500ms after last event before refreshing

  // Realtime subscriptions for the current week
  useEffect(() => {
    if (isDemo || !supabaseRef.current) return

    const supabase = supabaseRef.current
    const weekStart = getWeekStart(new Date())
    const weekEnd = addDays(weekStart, 6)
    const weekStartStr = formatDateISO(weekStart)
    const weekEndStr = formatDateISO(weekEnd)
    const homeCacheKey = CACHE_KEYS.home(householdId)

    // Debounced refresh - coalesces rapid events into one refresh
    const scheduleRefresh = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(async () => {
        await revalidateWeek(householdId, weekStartStr)
        router.refresh()
        debounceTimerRef.current = null
      }, DEBOUNCE_MS)
    }

    // Update IndexedDB cache with realtime change, then schedule debounced refresh
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

      // Schedule debounced refresh (coalesces multiple rapid events)
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

    // Cleanup: clear pending timer and remove channel
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      supabase.removeChannel(channel)
    }
  }, [householdId, isDemo, router])

  // This component doesn't render anything visible
  return null
}
