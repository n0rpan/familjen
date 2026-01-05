'use client'

import { WeekPageSkeleton } from '@/components/Skeleton'
import { SmartLoading } from '@/components/SmartLoading'
import { WeekPageContent } from './components/WeekPageContent'
import type { CachedWeekData } from './components/WeekDataCache'
import { getWeekNumber } from '@/lib/utils'

/**
 * Week page loading state
 *
 * Uses SmartLoading to show cached data instead of skeleton during navigation.
 * Falls back to skeleton only when no cache is available.
 */
export default function WeekLoading() {
  return (
    <SmartLoading page="week" skeleton={<WeekPageSkeleton />}>
      {(rawData) => {
        const data = rawData as CachedWeekData

        // Convert string dates to Date objects
        const weekStart = new Date(data.weekStart + 'T00:00:00')
        const weekEnd = new Date(data.weekEnd + 'T00:00:00')
        const currentWeekNumber = getWeekNumber(new Date())
        const displayWeekNumber = getWeekNumber(weekStart)

        return (
          <WeekPageContent
            householdId={data.household?.id || ''}
            currentUserId={data.currentUserId}
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
            weekStart={weekStart}
            weekEnd={weekEnd}
            weekContext={data.weekContext}
            weekNumber={displayWeekNumber}
            isCurrentWeek={displayWeekNumber === currentWeekNumber}
            isDemo={false}
          />
        )
      }}
    </SmartLoading>
  )
}
