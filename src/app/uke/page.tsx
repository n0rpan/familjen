/**
 * Week Page - Server Component with PPR
 *
 * Uses Partial Prerendering for instant navigation:
 * - Static shell renders immediately
 * - Dynamic content streams via Suspense
 * - Server-side caching with unstable_cache (5 minute TTL)
 * - Realtime subscriptions handle live updates
 *
 * Cache fallback (WeekCacheFallback) shows IndexedDB cached data while
 * Suspense waits for server data, eliminating skeleton flash.
 *
 * URL format:
 * - /uke - Current week
 * - /uke?uke=2 - Week 2 of current/inferred year
 * - /uke?uke=2025-02 - Week 2 of 2025
 * - /uke?demo=true - Demo mode
 */

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSessionLocal } from '@/lib/supabase/server'
import { getHouseholdIdFromSession } from '@/lib/data/server'
import { getWeekStart, getWeekStartFromWeekNumber } from '@/lib/utils'
import { WeekDataLoader } from './components/WeekDataLoader'
import { WeekCacheFallback } from './components/WeekDataCache'
import { WeekPageSkeleton } from '@/components/Skeleton'

interface PageProps {
  searchParams: Promise<{ uke?: string; demo?: string }>
}

/**
 * Parse the week parameter from URL
 * Supports: "2" (week number), "2025-02" (year-week)
 */
function parseWeekParam(param?: string): { week?: number; year?: number } {
  if (!param) return {}

  // Format: 2025-02 (year-week)
  if (param.includes('-')) {
    const [yearStr, weekStr] = param.split('-')
    const year = parseInt(yearStr, 10)
    const week = parseInt(weekStr, 10)
    if (!isNaN(year) && !isNaN(week) && week >= 1 && week <= 53) {
      return { week, year }
    }
    return {}
  }

  // Format: 2 (week number only)
  const week = parseInt(param, 10)
  if (!isNaN(week) && week >= 1 && week <= 53) {
    return { week }
  }
  return {}
}

export default async function WeekPage({ searchParams }: PageProps) {
  const params = await searchParams
  const isDemo = params.demo === 'true'

  // Demo mode: use placeholder household ID
  if (isDemo) {
    const { week, year } = parseWeekParam(params.uke)
    return (
      <Suspense fallback={<WeekPageSkeleton />}>
        <WeekDataLoader
          householdId="demo"
          week={week}
          year={year}
          isDemo={true}
        />
      </Suspense>
    )
  }

  // Production mode: get user from local session (no network call)
  const user = await getSessionLocal()

  if (!user) {
    redirect('/login')
  }

  // Get household ID with fallback to DB if JWT is stale
  const householdId = await getHouseholdIdFromSession()
  if (!householdId) {
    // No household - redirect to home where user can see onboarding options
    redirect('/')
  }

  const { week, year } = parseWeekParam(params.uke)

  // Calculate week start for cache key
  const weekStart = week
    ? getWeekStartFromWeekNumber(week, year || new Date().getFullYear())
    : getWeekStart(new Date())

  return (
    <Suspense fallback={<WeekCacheFallback householdId={householdId} weekStart={weekStart} />}>
      <WeekDataLoader
        householdId={householdId}
        userId={user.id}
        week={week}
        year={year}
        isDemo={false}
      />
    </Suspense>
  )
}
