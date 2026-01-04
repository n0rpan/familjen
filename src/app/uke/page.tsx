/**
 * Week Page - Server Component with PPR
 *
 * Uses Partial Prerendering for instant navigation:
 * - Static shell renders immediately
 * - Dynamic content streams via Suspense
 * - Server-side caching with unstable_cache (1 year TTL)
 * - Realtime subscriptions handle live updates
 *
 * URL format:
 * - /uke - Current week
 * - /uke?uke=2 - Week 2 of current/inferred year
 * - /uke?uke=2025-02 - Week 2 of 2025
 * - /uke?demo=true - Demo mode
 */

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getHouseholdIdFromSession } from '@/lib/data/server'
import { WeekDataLoader } from './components/WeekDataLoader'
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

  // Production mode: get household from session
  const householdId = await getHouseholdIdFromSession()

  if (!householdId) {
    redirect('/login')
  }

  const { week, year } = parseWeekParam(params.uke)

  return (
    <Suspense fallback={<WeekPageSkeleton />}>
      <WeekDataLoader
        householdId={householdId}
        week={week}
        year={year}
        isDemo={false}
      />
    </Suspense>
  )
}
