'use client'

/**
 * useWeekData Hook
 *
 * Combined hook that fetches all data needed for week-based views.
 * Used by both the home page and week planner.
 */

import { useMemo } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { useChildren } from './useChildren'
import { useMembers } from './useMembers'
import { usePickups } from './usePickups'
import { useMeals } from './useMeals'
import { useRecipes } from './useRecipes'
import { useTasks } from './useTasks'
import { useMemberEvents } from './useMemberEvents'
import { useHouseholdEvents } from './useHouseholdEvents'
import { useExternalEvents } from './useExternalEvents'
import { useHolidays } from './useHolidays'
import { getWeekStart, addDays, formatDateISO } from '@/lib/utils'
import type {
  Household,
  HouseholdMember,
  Child,
  PickupWithDetails,
  MealWithRecipe,
  Recipe,
  ChildTaskWithChild,
  MemberEvent,
  HouseholdEvent,
  ExternalEvent,
  DaySummary,
} from '@/lib/types'
import type { Holiday } from '@/lib/utils'

export interface UseWeekDataOptions {
  /** Week offset from current week (0 = current, 1 = next, -1 = previous) */
  weekOffset?: number
}

export interface UseWeekDataReturn {
  household: Household | null
  currentMember: HouseholdMember | null
  children: Child[]
  members: HouseholdMember[]
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
  recipes: Recipe[]
  tasks: ChildTaskWithChild[]
  memberEvents: MemberEvent[]
  householdEvents: HouseholdEvent[]
  externalEvents: ExternalEvent[]
  holidays: Holiday[]
  weekStart: Date
  weekEnd: Date
  loading: boolean
  error: string | null
  /** Update a pickup */
  updatePickup: (childId: string, date: string, pickerId: string | null, time?: string | null) => Promise<void>
  /** Update a meal */
  updateMeal: (date: string, recipeId: string | null, customMeal: string | null) => Promise<void>
  /** Refetch all data */
  refetch: () => void
}

/**
 * Hook to get all data for a week
 */
export function useWeekData(options: UseWeekDataOptions = {}): UseWeekDataReturn {
  const { weekOffset = 0 } = options
  const { isDemo } = useDataSource()

  // Calculate week dates
  const { weekStart, weekEnd } = useMemo(() => {
    const today = new Date()
    const start = getWeekStart(today)
    start.setDate(start.getDate() + weekOffset * 7)
    const end = addDays(start, 6)
    return { weekStart: start, weekEnd: end }
  }, [weekOffset])

  // Fetch core data
  const { household, currentMember, loading: householdLoading, error: householdError } = useHousehold()
  const { children, loading: childrenLoading, error: childrenError } = useChildren()
  const { members, loading: membersLoading, error: membersError } = useMembers()
  const { recipes, loading: recipesLoading, error: recipesError, refetch: refetchRecipes } = useRecipes()

  // Fetch week-specific data
  const {
    pickups,
    loading: pickupsLoading,
    error: pickupsError,
    updatePickup,
    refetch: refetchPickups,
  } = usePickups({ startDate: weekStart, endDate: weekEnd, children, members })

  const {
    meals,
    loading: mealsLoading,
    error: mealsError,
    updateMeal,
    refetch: refetchMeals,
  } = useMeals({ startDate: weekStart, endDate: weekEnd, recipes })

  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    refetch: refetchTasks,
  } = useTasks({ startDate: weekStart, endDate: weekEnd, children })

  const {
    events: memberEvents,
    loading: memberEventsLoading,
    error: memberEventsError,
    refetch: refetchMemberEvents,
  } = useMemberEvents({ startDate: weekStart, endDate: weekEnd })

  const {
    events: householdEvents,
    loading: householdEventsLoading,
    error: householdEventsError,
    refetch: refetchHouseholdEvents,
  } = useHouseholdEvents({ startDate: weekStart, endDate: weekEnd })

  const {
    events: externalEvents,
    loading: externalEventsLoading,
    error: externalEventsError,
    refetch: refetchExternalEvents,
  } = useExternalEvents({ startDate: weekStart, endDate: weekEnd })

  const {
    holidays,
    loading: holidaysLoading,
    error: holidaysError,
    refetch: refetchHolidays,
  } = useHolidays({ startDate: weekStart, endDate: weekEnd })

  // Combined loading state
  const loading = householdLoading || childrenLoading || membersLoading ||
    pickupsLoading || mealsLoading || recipesLoading || tasksLoading ||
    memberEventsLoading || householdEventsLoading || externalEventsLoading || holidaysLoading

  // Combined error (first error found)
  const error = householdError || childrenError || membersError ||
    pickupsError || mealsError || recipesError || tasksError ||
    memberEventsError || householdEventsError || externalEventsError || holidaysError

  // Combined refetch
  const refetch = () => {
    refetchPickups()
    refetchMeals()
    refetchRecipes()
    refetchTasks()
    refetchMemberEvents()
    refetchHouseholdEvents()
    refetchExternalEvents()
    refetchHolidays()
  }

  return {
    household,
    currentMember,
    children,
    members,
    pickups,
    meals,
    recipes,
    tasks,
    memberEvents,
    householdEvents,
    externalEvents,
    holidays,
    weekStart,
    weekEnd,
    loading,
    error,
    updatePickup,
    updateMeal,
    refetch,
  }
}

/**
 * Get today's summary from week data
 */
export function getTodaySummaryFromWeekData(data: UseWeekDataReturn): DaySummary {
  const todayStr = formatDateISO(new Date())

  return {
    date: todayStr,
    pickups: data.pickups.filter(p => p.date === todayStr),
    meal: data.meals.find(m => m.date === todayStr) || null,
    tasks: data.tasks.filter(t => t.date === todayStr),
    householdEvents: data.householdEvents.filter(e => e.event_date === todayStr),
    memberEvents: data.memberEvents.filter(e => e.date === todayStr),
    externalEvents: data.externalEvents.filter(e => e.event_date === todayStr),
  }
}
