/**
 * WeekDataLoader - Server Component
 *
 * Fetches all week page data on the server and passes to WeekPageContent.
 * Works for both production (Supabase) and demo mode (generated data).
 *
 * This is the key component for PPR - it runs on the server and streams
 * the rendered content to the client.
 */

import { fetchWeekPageData, getDemoWeekPageData } from '@/lib/data/server'
import { getWeekNumber } from '@/lib/utils'
import { WeekPageContent } from './WeekPageContent'

interface WeekDataLoaderProps {
  householdId: string
  userId?: string  // For currentMember lookup without extra auth call
  week?: number  // ISO week number (1-53), defaults to current week
  year?: number  // Year, defaults to current or inferred
  isDemo: boolean
}

export async function WeekDataLoader({ householdId, userId, week, year, isDemo }: WeekDataLoaderProps) {
  // Fetch data - same structure for demo and production
  const data = isDemo
    ? getDemoWeekPageData(week, year)
    : await fetchWeekPageData(householdId, week, year, userId)

  // Calculate current week number for comparison
  const currentWeekNumber = getWeekNumber(new Date())
  const displayWeekNumber = getWeekNumber(data.weekStart)

  return (
    <WeekPageContent
      householdId={data.household?.id || 'demo'}
      currentUserId={data.currentMember?.user_id ?? undefined}
      household={data.household}
      children={data.children}
      members={data.members}
      pickups={data.pickups}
      meals={data.meals}
      recipes={data.recipes}
      memberEvents={data.memberEvents}
      householdEvents={data.householdEvents}
      externalEvents={data.externalEvents}
      childTasks={data.tasks}
      holidays={data.holidays}
      weekStart={data.weekStart}
      weekEnd={data.weekEnd}
      weekContext={data.weekContext}
      weekNumber={displayWeekNumber}
      isCurrentWeek={displayWeekNumber === currentWeekNumber && data.weekStart.getFullYear() === new Date().getFullYear()}
      isDemo={isDemo}
    />
  )
}
