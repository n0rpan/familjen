/**
 * Server-Side Data Fetching
 *
 * These functions fetch data for server components using the server Supabase client.
 * They're designed for PPR (Partial Prerendering) - static shell with streaming dynamic content.
 *
 * Key differences from client-side fetching:
 * - Uses server Supabase client (cookies-based auth)
 * - Uses React cache() for request deduplication
 * - Returns data directly for streaming (no IndexedDB caching)
 * - Includes timestamp for "last updated" indicator
 */

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { formatDateISO, addDays, getWeekStart, type Holiday } from '@/lib/utils'
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
import { generateDemoState, DEMO_IDS } from '@/lib/demo/generator'

// Data structure for home page
export interface HomePageData {
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
  weekContext: string
  timestamp: number
}

// Demo data for when ?demo=true
export interface DemoData extends HomePageData {
  isDemo: true
}

/**
 * Fetch all data needed for the home page
 * Uses React cache() for request deduplication within a single render
 */
export const fetchHomePageData = cache(async (householdId: string): Promise<HomePageData> => {
  const supabase = await createClient()

  // Calculate week dates (Monday to Sunday)
  const today = new Date()
  const weekStart = getWeekStart(today)
  const weekEnd = addDays(weekStart, 6)
  const weekStartStr = formatDateISO(weekStart)
  const weekEndStr = formatDateISO(weekEnd)

  // Get current user for member matching
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch all data in parallel for maximum performance
  const [
    householdResult,
    childrenResult,
    membersResult,
    pickupsResult,
    mealsResult,
    recipesResult,
    memberEventsResult,
    householdEventsResult,
    tasksResult,
    externalEventsResult,
    holidaysResult,
    weekContextResult,
  ] = await Promise.all([
    supabase.from('households').select('*').eq('id', householdId).single(),
    supabase.from('children').select('*').eq('household_id', householdId).order('sort_order'),
    supabase.from('household_members').select('*').eq('household_id', householdId),
    supabase.from('pickups')
      .select('*, child:children(*), picker:household_members(*)')
      .eq('household_id', householdId)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr),
    supabase.from('meals')
      .select('*, recipe:recipes(*)')
      .eq('household_id', householdId)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr),
    supabase.from('recipes')
      .select('*')
      .eq('household_id', householdId)
      .order('name'),
    supabase.from('member_events')
      .select('*')
      .eq('household_id', householdId)
      .lte('date', weekEndStr)
      .or(`end_date.gte.${weekStartStr},end_date.is.null`),
    supabase.from('household_events')
      .select('*')
      .eq('household_id', householdId)
      .lte('event_date', weekEndStr)
      .or(`end_date.gte.${weekStartStr},end_date.is.null`)
      .order('event_date')
      .order('event_time'),
    supabase.from('child_tasks')
      .select('*, child:children(*)')
      .eq('household_id', householdId)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .order('date')
      .order('time'),
    supabase.from('external_events')
      .select('*, integration:external_integrations!inner(service, display_name)')
      .eq('external_integrations.household_id', householdId)
      .eq('is_hidden', false)
      .gte('event_date', weekStartStr)
      .lte('event_date', weekEndStr)
      .order('event_date')
      .order('event_time'),
    supabase.from('calendar_events')
      .select('date, name')
      .or(`household_id.is.null,household_id.eq.${householdId}`)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .eq('event_type', 'holiday'),
    supabase.from('week_contexts')
      .select('context')
      .eq('household_id', householdId)
      .eq('week_start', weekStartStr)
      .maybeSingle(),
  ])

  // Find current member
  const members = membersResult.data || []
  const currentMember = user
    ? members.find(m => m.user_id === user.id) || null
    : null

  // Generate birthdays from members and children with birth_date
  const currentYear = today.getFullYear()
  const birthdays: Holiday[] = []

  members.forEach(member => {
    if (member.birth_date) {
      const birthDate = new Date(member.birth_date)
      const thisYearBirthday = `${currentYear}-${String(birthDate.getMonth() + 1).padStart(2, '0')}-${String(birthDate.getDate()).padStart(2, '0')}`
      if (thisYearBirthday >= weekStartStr && thisYearBirthday <= weekEndStr) {
        birthdays.push({ date: thisYearBirthday, name: member.name, type: 'birthday' })
      }
    }
  })

  const children = childrenResult.data || []
  children.forEach(child => {
    if (child.birth_date) {
      const birthDate = new Date(child.birth_date)
      const thisYearBirthday = `${currentYear}-${String(birthDate.getMonth() + 1).padStart(2, '0')}-${String(birthDate.getDate()).padStart(2, '0')}`
      if (thisYearBirthday >= weekStartStr && thisYearBirthday <= weekEndStr) {
        birthdays.push({ date: thisYearBirthday, name: child.name, type: 'birthday' })
      }
    }
  })

  return {
    household: householdResult.data,
    currentMember,
    children,
    members,
    pickups: (pickupsResult.data || []) as PickupWithDetails[],
    meals: (mealsResult.data || []) as MealWithRecipe[],
    recipes: recipesResult.data || [],
    tasks: (tasksResult.data || []) as ChildTaskWithChild[],
    memberEvents: memberEventsResult.data || [],
    householdEvents: householdEventsResult.data || [],
    externalEvents: (externalEventsResult.data || []) as ExternalEvent[],
    holidays: [
      ...(holidaysResult.data || []).map(h => ({ ...h, type: 'holiday' as const })),
      ...birthdays,
    ],
    weekStart,
    weekEnd,
    weekContext: weekContextResult.data?.context || '',
    timestamp: Date.now(),
  }
})

/**
 * Get today's summary from home page data
 */
export function getTodaySummary(data: HomePageData): DaySummary {
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

/**
 * Get user's household ID from JWT (fast, no database query)
 */
export async function getHouseholdIdFromSession(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.app_metadata?.household_id || null
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user
}

/**
 * Get current user info
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

/**
 * Generate demo data in the same format as production
 * This ensures demo mode uses identical components and data structures
 */
export function getDemoHomePageData(): HomePageData {
  const demoState = generateDemoState()
  const today = new Date()
  const weekStart = getWeekStart(today)
  const weekEnd = addDays(weekStart, 6)

  // Find current member (Erik is the "logged in" demo user)
  const currentMember = demoState.members.find(m => m.id === DEMO_IDS.members.erik) || null

  // Transform pickups to include child and picker relations
  const pickups: PickupWithDetails[] = demoState.pickups.map(pickup => {
    const child = demoState.children.find(c => c.id === pickup.child_id)
    const picker = demoState.members.find(m => m.id === pickup.picker_id)
    return {
      ...pickup,
      child: child!,
      picker: picker || null,
    }
  })

  // Transform meals to include recipe relations
  const meals: MealWithRecipe[] = demoState.meals.map(meal => {
    const recipe = meal.recipe_id
      ? demoState.recipes.find(r => r.id === meal.recipe_id) || null
      : null
    return { ...meal, recipe }
  })

  // Transform tasks to include child relations
  const tasks: ChildTaskWithChild[] = demoState.childTasks.map(task => {
    const child = demoState.children.find(c => c.id === task.child_id)
    return { ...task, child: child! }
  })

  return {
    household: demoState.household,
    currentMember,
    children: demoState.children,
    members: demoState.members,
    pickups,
    meals,
    recipes: demoState.recipes,
    tasks,
    memberEvents: demoState.memberEvents,
    householdEvents: demoState.householdEvents,
    externalEvents: demoState.externalEvents,
    holidays: demoState.holidays,
    weekStart,
    weekEnd,
    weekContext: '',
    timestamp: Date.now(),
  }
}
