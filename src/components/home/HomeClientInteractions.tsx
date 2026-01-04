'use client'

/**
 * HomeClientInteractions - Client Component
 *
 * Handles all client-side interactivity for the home page:
 * - Realtime subscriptions for the current week
 * - Page refresh on data changes
 * - Prefetching adjacent weeks
 *
 * This component renders nothing visible - it just sets up the subscriptions.
 */

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePrefetchAdjacentWeeks } from '@/hooks/usePrefetchAdjacentWeeks'
import { usePrefetchRoutes, KEY_ROUTES, SECONDARY_ROUTES } from '@/hooks/usePrefetchRoutes'
import { formatDateISO, getWeekStart, addDays } from '@/lib/utils'

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

  // Realtime subscriptions for the current week
  useEffect(() => {
    if (isDemo || !supabaseRef.current) return

    const supabase = supabaseRef.current
    const weekStart = getWeekStart(new Date())
    const weekEnd = addDays(weekStart, 6)
    const weekStartStr = formatDateISO(weekStart)
    const weekEndStr = formatDateISO(weekEnd)

    // Refresh the page when data changes
    const handleChange = () => {
      router.refresh()
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
            handleChange()
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
            handleChange()
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
            handleChange()
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
        handleChange
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'household_events',
          filter: `household_id=eq.${householdId}`,
        },
        handleChange
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [householdId, isDemo, router])

  // This component doesn't render anything visible
  return null
}
