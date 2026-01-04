/**
 * Server-Side Data Fetching
 *
 * These functions fetch data for server components using the server Supabase client.
 * They're designed for PPR (Partial Prerendering) - static shell with streaming dynamic content.
 *
 * Key features:
 * - Uses unstable_cache for cross-request caching (instant navigation)
 * - Cache per household+week, shared between household members
 * - Realtime subscriptions on client handle live updates
 * - User-specific data (currentMember) derived after cache lookup
 */

import { cache } from 'react'
import { unstable_cache, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient, syncUserMetadata } from '@/lib/supabase/admin'
import { formatDateISO, addDays, getWeekStart, getWeekNumber, getWeekStartFromWeekNumber, type Holiday } from '@/lib/utils'
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
  AllowedEmail,
  ShoppingList,
  ShoppingListItem,
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

// Cached data structure (serializable - no Date objects)
interface CachedHomeData {
  household: Household | null
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
  weekContext: string
}

// Demo data for when ?demo=true
export interface DemoData extends HomePageData {
  isDemo: true
}

// Cache TTL: 1 year (realtime subscriptions handle live updates)
const CACHE_TTL = 365 * 24 * 60 * 60 // 1 year in seconds

/**
 * Core data fetcher - uses admin client to bypass RLS
 * Safe because we explicitly filter by householdId
 * This function is wrapped with unstable_cache for cross-request caching
 */
async function fetchHomeDataCore(
  householdId: string,
  weekStartStr: string,
  weekEndStr: string,
  currentYear: number
): Promise<CachedHomeData> {
  const supabase = createAdminClient()

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

  const members = membersResult.data || []
  const children = childrenResult.data || []

  // Generate birthdays from members and children with birth_date
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
    weekContext: weekContextResult.data?.context || '',
  }
}

/**
 * Create cached version of home data fetcher with household-specific tag
 * Cache key: household ID + week start date
 * Shared between all household members for efficiency
 *
 * Tags allow targeted revalidation after mutations:
 * - revalidateTag(`household-${householdId}`) invalidates all data for that household
 */
function getCachedHomeData(
  householdId: string,
  weekStartStr: string,
  weekEndStr: string,
  currentYear: number
) {
  return unstable_cache(
    () => fetchHomeDataCore(householdId, weekStartStr, weekEndStr, currentYear),
    ['home-page-data', householdId, weekStartStr],
    {
      revalidate: CACHE_TTL,
      tags: [`household-${householdId}`, `week-${householdId}-${weekStartStr}`]
    }
  )()
}

/**
 * Fetch all data needed for the home page
 * Uses cached data for instant navigation, realtime handles updates
 */
export const fetchHomePageData = cache(async (householdId: string): Promise<HomePageData> => {
  // Calculate week dates (Monday to Sunday)
  const today = new Date()
  const weekStart = getWeekStart(today)
  const weekEnd = addDays(weekStart, 6)
  const weekStartStr = formatDateISO(weekStart)
  const weekEndStr = formatDateISO(weekEnd)
  const currentYear = today.getFullYear()

  // Get cached data (shared between household members)
  const cachedData = await getCachedHomeData(householdId, weekStartStr, weekEndStr, currentYear)

  // Get current user for member matching (not cached - per-request)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const currentMember = user
    ? cachedData.members.find(m => m.user_id === user.id) || null
    : null

  return {
    ...cachedData,
    currentMember,
    weekStart,
    weekEnd,
    timestamp: Date.now(),
  }
})

// Week page uses the same data structure as home page
export type WeekPageData = HomePageData

/**
 * Create cached version for week page with household-specific tag
 * Uses same tags as home page so revalidation works for both
 */
function getCachedWeekData(
  householdId: string,
  weekStartStr: string,
  weekEndStr: string,
  currentYear: number
) {
  return unstable_cache(
    () => fetchHomeDataCore(householdId, weekStartStr, weekEndStr, currentYear),
    ['week-page-data', householdId, weekStartStr],
    {
      revalidate: CACHE_TTL,
      tags: [`household-${householdId}`, `week-${householdId}-${weekStartStr}`]
    }
  )()
}

/**
 * Fetch all data needed for the week page
 * @param householdId - The household ID
 * @param week - Optional week number (1-53). Defaults to current week.
 * @param year - Optional year. Defaults to current year or inferred from week.
 */
export const fetchWeekPageData = cache(async (
  householdId: string,
  week?: number,
  year?: number
): Promise<WeekPageData> => {
  // Calculate week dates
  const today = new Date()
  const weekStart = week
    ? getWeekStartFromWeekNumber(week, year)
    : getWeekStart(today)
  const weekEnd = addDays(weekStart, 6)
  const weekStartStr = formatDateISO(weekStart)
  const weekEndStr = formatDateISO(weekEnd)
  const currentYear = weekStart.getFullYear()

  // Get cached data (shared between household members)
  const cachedData = await getCachedWeekData(householdId, weekStartStr, weekEndStr, currentYear)

  // Get current user for member matching (not cached - per-request)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const currentMember = user
    ? cachedData.members.find(m => m.user_id === user.id) || null
    : null

  return {
    ...cachedData,
    currentMember,
    weekStart,
    weekEnd,
    timestamp: Date.now(),
  }
})

/**
 * Generate demo data for week page (supports different weeks)
 * @param week - Optional week number (1-53). Defaults to current week.
 * @param year - Optional year. Defaults to current year or inferred from week.
 */
export function getDemoWeekPageData(week?: number, year?: number): WeekPageData {
  const demoState = generateDemoState()
  const today = new Date()
  const weekStart = week
    ? getWeekStartFromWeekNumber(week, year)
    : getWeekStart(today)
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
 * Get user's household ID from JWT with DB fallback
 *
 * PERFORMANCE: Tries JWT first (instant), falls back to DB if JWT doesn't have household_id.
 * This handles the case where a user just created/joined a household and JWT hasn't been refreshed.
 *
 * NOTE: JWT sync happens on login and home page load - we don't sync here to avoid
 * potential issues with concurrent requests.
 *
 * SECURITY: Server is always the source of truth. JWT is only used as a performance optimization.
 */
export async function getHouseholdIdFromSession(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError) {
      console.error('[getHouseholdIdFromSession] Auth error:', authError.message)
      return null
    }

    if (!user) return null

    // Try JWT first (fast path)
    const jwtHouseholdId = user.app_metadata?.household_id as string | undefined
    if (jwtHouseholdId) return jwtHouseholdId

    // Fallback: Check database if JWT doesn't have household_id
    // This handles cases where JWT wasn't refreshed after joining/creating a household
    const { data: memberData, error: dbError } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (dbError && dbError.code !== 'PGRST116') {
      // PGRST116 = no rows found (user has no household) - this is OK
      console.error('[getHouseholdIdFromSession] DB error:', dbError.message)
    }

    if (memberData?.household_id) {
      // Sync JWT so next page load is fast (fire-and-forget, don't block render)
      // Same pattern as home page - direct import, catch errors silently
      syncUserMetadata(user.id, user.email!, memberData.household_id).catch((err) => {
        console.error('[getHouseholdIdFromSession] Failed to sync user metadata:', err)
      })

      return memberData.household_id
    }

    return null
  } catch (err) {
    console.error('[getHouseholdIdFromSession] Unexpected error:', err)
    return null
  }
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

// ============================================================================
// Feed Page Data
// ============================================================================

export interface FeedPageData {
  integrationsEnabled: boolean
  integrations: Array<{
    id: string
    service: string
    display_name: string
    last_sync_status: string | null
    last_sync_error: string | null
    last_sync_at: string | null
  }>
  messages: Array<Record<string, unknown>>
  photos: Array<Record<string, unknown>>
  integrationChildren: Array<Record<string, unknown>>
  notifications: Array<Record<string, unknown>>
  duplicateSuggestions: Array<Record<string, unknown>>
  mergedDuplicates: Array<Record<string, unknown>>
}

/**
 * Core feed data fetcher - uses admin client to bypass RLS
 */
async function fetchFeedDataCore(householdId: string): Promise<FeedPageData> {
  const supabase = createAdminClient()

  // Check if integrations are enabled
  const { data: householdData } = await supabase
    .from('households')
    .select('external_integrations_enabled')
    .eq('id', householdId)
    .single()

  if (!householdData?.external_integrations_enabled) {
    return {
      integrationsEnabled: false,
      integrations: [],
      messages: [],
      photos: [],
      integrationChildren: [],
      notifications: [],
      duplicateSuggestions: [],
      mergedDuplicates: [],
    }
  }

  // Parallel fetch all feed data
  const [
    integrationsResult,
    messagesResult,
    integrationChildrenResult,
    photosResult,
    notificationsResult,
    duplicateSuggestionsResult,
    mergedDuplicatesResult,
  ] = await Promise.all([
    supabase
      .from('external_integrations')
      .select('id, service, display_name, last_sync_status, last_sync_error, last_sync_at')
      .eq('household_id', householdId),

    supabase
      .from('external_messages')
      .select(`
        *,
        external_integrations!inner(service, display_name, household_id),
        children(name)
      `)
      .eq('external_integrations.household_id', householdId)
      .order('message_date', { ascending: false })
      .limit(100),

    supabase
      .from('external_integration_children')
      .select(`
        integration_id,
        child_id,
        external_group_name,
        children(name),
        external_integrations!inner(household_id)
      `)
      .eq('external_integrations.household_id', householdId),

    supabase
      .from('external_photos')
      .select(`
        *,
        external_integrations!inner(service, display_name, household_id),
        children(name)
      `)
      .eq('external_integrations.household_id', householdId)
      .gt('expires_at', new Date().toISOString())
      .order('taken_at', { ascending: false })
      .limit(50),

    supabase
      .from('event_change_notifications')
      .select('*')
      .eq('household_id', householdId)
      .in('status', ['unread', 'read'])
      .order('created_at', { ascending: false })
      .limit(20),

    supabase
      .from('event_duplicate_suggestions')
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),

    supabase
      .from('event_duplicate_suggestions')
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'merged')
      .order('resolved_at', { ascending: false })
      .limit(20),
  ])

  return {
    integrationsEnabled: true,
    integrations: integrationsResult.data || [],
    messages: messagesResult.data || [],
    photos: photosResult.data || [],
    integrationChildren: integrationChildrenResult.data || [],
    notifications: notificationsResult.data || [],
    duplicateSuggestions: duplicateSuggestionsResult.data || [],
    mergedDuplicates: mergedDuplicatesResult.data || [],
  }
}

/**
 * Cached version of feed data fetcher
 */
function getCachedFeedData(householdId: string) {
  return unstable_cache(
    () => fetchFeedDataCore(householdId),
    ['feed-page-data', householdId],
    {
      revalidate: CACHE_TTL,
      tags: [`household-${householdId}`, `feed-${householdId}`]
    }
  )()
}

/**
 * Fetch all data needed for the feed page
 */
export const fetchFeedPageData = cache(async (householdId: string): Promise<FeedPageData> => {
  return getCachedFeedData(householdId)
})

/**
 * Generate demo data for feed page
 */
export function getDemoFeedPageData(): FeedPageData {
  const demoState = generateDemoState()

  return {
    integrationsEnabled: true,
    integrations: [], // Demo doesn't have mock integrations
    messages: demoState.feedMessages as unknown as Array<Record<string, unknown>> || [],
    photos: demoState.feedPhotos as unknown as Array<Record<string, unknown>> || [],
    integrationChildren: [],
    notifications: [], // Demo doesn't have mock notifications
    duplicateSuggestions: [],
    mergedDuplicates: [],
  }
}

/**
 * Revalidate feed cache
 */
export function revalidateFeedCache(householdId: string) {
  revalidateTag(`feed-${householdId}`, 'default')
}

// ============================================================================
// Cache Revalidation Helpers
// ============================================================================

/**
 * Revalidate all cached data for a household
 * Call this after mutations to ensure fresh data on next navigation
 */
export function revalidateHouseholdCache(householdId: string) {
  revalidateTag(`household-${householdId}`, 'default')
}

/**
 * Revalidate cached data for a specific week
 * More targeted than revalidating all household data
 */
export function revalidateWeekCache(householdId: string, weekStartStr: string) {
  revalidateTag(`week-${householdId}-${weekStartStr}`, 'default')
}

// ============================================================================
// Settings Page Data
// ============================================================================

export interface SettingsPageData {
  household: Household | null
  members: HouseholdMember[]
  children: Child[]
  connectedCalendarEmail: string | null
}

/**
 * Core settings data fetcher - uses admin client to bypass RLS
 */
async function fetchSettingsDataCore(householdId: string): Promise<SettingsPageData> {
  const supabase = createAdminClient()

  // Parallel fetch all settings data
  const [
    householdResult,
    membersResult,
    childrenResult,
    calendarTokenResult,
  ] = await Promise.all([
    supabase
      .from('households')
      .select('id, name, ai_meal_context, share_names_with_ai, external_integrations_enabled, created_at, ics_calendar_url, ics_last_sync_at, ics_sync_error')
      .eq('id', householdId)
      .single(),

    supabase
      .from('household_members')
      .select('*')
      .eq('household_id', householdId)
      .order('is_parent', { ascending: false })
      .order('name'),

    supabase
      .from('children')
      .select('*')
      .eq('household_id', householdId)
      .order('sort_order'),

    supabase
      .from('google_calendar_tokens')
      .select('email')
      .eq('household_id', householdId)
      .limit(1),
  ])

  return {
    household: householdResult.data,
    members: membersResult.data || [],
    children: childrenResult.data || [],
    connectedCalendarEmail: calendarTokenResult.data?.[0]?.email || null,
  }
}

/**
 * Cached version of settings data fetcher
 */
function getCachedSettingsData(householdId: string) {
  return unstable_cache(
    () => fetchSettingsDataCore(householdId),
    ['settings-page-data', householdId],
    {
      revalidate: CACHE_TTL,
      tags: [`household-${householdId}`, `settings-${householdId}`]
    }
  )()
}

/**
 * Fetch all data needed for the settings page
 */
export const fetchSettingsPageData = cache(async (householdId: string): Promise<SettingsPageData> => {
  return getCachedSettingsData(householdId)
})

/**
 * Generate demo data for settings page
 */
export function getDemoSettingsPageData(): SettingsPageData {
  const demoState = generateDemoState()

  return {
    household: demoState.household,
    members: demoState.members,
    children: demoState.children,
    connectedCalendarEmail: null,
  }
}

/**
 * Revalidate settings cache
 */
export function revalidateSettingsCache(householdId: string) {
  revalidateTag(`settings-${householdId}`, 'default')
}

// ============================================================================
// Recipes Page Data
// ============================================================================

export interface RecipesPageData {
  household: Household | null
  recipes: Recipe[]
}

/**
 * Core recipes data fetcher - uses admin client to bypass RLS
 */
async function fetchRecipesDataCore(householdId: string): Promise<RecipesPageData> {
  const supabase = createAdminClient()

  const [householdResult, recipesResult] = await Promise.all([
    supabase
      .from('households')
      .select('*')
      .eq('id', householdId)
      .single(),

    supabase
      .from('recipes')
      .select('*')
      .eq('household_id', householdId)
      .order('name'),
  ])

  return {
    household: householdResult.data,
    recipes: recipesResult.data || [],
  }
}

/**
 * Cached version of recipes data fetcher
 */
function getCachedRecipesData(householdId: string) {
  return unstable_cache(
    () => fetchRecipesDataCore(householdId),
    ['recipes-page-data', householdId],
    {
      revalidate: CACHE_TTL,
      tags: [`household-${householdId}`, `recipes-${householdId}`]
    }
  )()
}

/**
 * Fetch all data needed for the recipes page
 */
export const fetchRecipesPageData = cache(async (householdId: string): Promise<RecipesPageData> => {
  return getCachedRecipesData(householdId)
})

/**
 * Generate demo data for recipes page
 */
export function getDemoRecipesPageData(): RecipesPageData {
  const demoState = generateDemoState()

  return {
    household: demoState.household,
    recipes: demoState.recipes,
  }
}

/**
 * Revalidate recipes cache
 */
export function revalidateRecipesCache(householdId: string) {
  revalidateTag(`recipes-${householdId}`, 'default')
}

// ============================================================================
// Shopping Page Data
// ============================================================================

export interface ShoppingListWithItems extends ShoppingList {
  items: ShoppingListItem[]
}

export interface ShoppingPageData {
  household: Household | null
  lists: ShoppingListWithItems[]
}

/**
 * Core shopping data fetcher - uses admin client to bypass RLS
 */
async function fetchShoppingDataCore(householdId: string): Promise<ShoppingPageData> {
  const supabase = createAdminClient()

  const [householdResult, listsResult] = await Promise.all([
    supabase
      .from('households')
      .select('*')
      .eq('id', householdId)
      .single(),

    supabase
      .from('shopping_lists')
      .select(`
        *,
        items:shopping_list_items(*)
      `)
      .eq('household_id', householdId)
      .order('created_at', { ascending: false }),
  ])

  return {
    household: householdResult.data,
    lists: listsResult.data || [],
  }
}

/**
 * Cached version of shopping data fetcher
 */
function getCachedShoppingData(householdId: string) {
  return unstable_cache(
    () => fetchShoppingDataCore(householdId),
    ['shopping-page-data', householdId],
    {
      revalidate: CACHE_TTL,
      tags: [`household-${householdId}`, `shopping-${householdId}`]
    }
  )()
}

/**
 * Fetch all data needed for the shopping page
 */
export const fetchShoppingPageData = cache(async (householdId: string): Promise<ShoppingPageData> => {
  return getCachedShoppingData(householdId)
})

/**
 * Generate demo data for shopping page
 */
export function getDemoShoppingPageData(): ShoppingPageData {
  const demoState = generateDemoState()

  return {
    household: demoState.household,
    lists: demoState.shoppingLists,
  }
}

/**
 * Revalidate shopping cache
 */
export function revalidateShoppingCache(householdId: string) {
  revalidateTag(`shopping-${householdId}`, 'default')
}

// ============================================================================
// Home Control (Styring) Page Data
// ============================================================================

export interface HomeControlAccount {
  id: string
  household_id: string
  service: 'somfy' | 'toshiba' | 'melcloud'
  label: string | null
  last_sync_at: string | null
  sync_error: string | null
}

export interface SomfyDevice {
  id: string
  account_id: string
  device_url: string
  label: string
  ui_class: string
  controllable_name: string | null
  available: boolean
  position: number | null
  commands: string[] | null
  custom_name: string | null
  favorite: boolean
  is_hidden: boolean
}

export interface ToshibaDevice {
  id: string
  account_id: string
  ac_id: string
  name: string
  custom_name: string | null
  power_state: string | null
  operation_mode: string | null
  target_temperature: number | null
  current_temperature: number | null
  outdoor_temperature: number | null
}

export interface MelCloudDevice {
  id: string
  account_id: string
  device_id: number
  building_id: number
  name: string
  custom_name: string | null
  power_state: string | null
  operation_mode: string | null
  target_temperature: number | null
  current_temperature: number | null
  outdoor_temperature: number | null
}

export interface HomeControlGroup {
  id: string
  household_id: string
  name: string
  icon: string | null
  sort_order: number
  device_ids: string[]
  toshiba_device_ids: string[]
  melcloud_device_ids: string[]
}

export interface StyringPageData {
  accounts: HomeControlAccount[]
  somfyDevices: SomfyDevice[]
  toshibaDevices: ToshibaDevice[]
  melcloudDevices: MelCloudDevice[]
  groups: HomeControlGroup[]
}

/**
 * Core styring data fetcher - uses admin client to bypass RLS
 */
async function fetchStyringDataCore(householdId: string): Promise<StyringPageData> {
  const supabase = createAdminClient()

  const [
    accountsResult,
    somfyDevicesResult,
    toshibaDevicesResult,
    melcloudDevicesResult,
    groupsResult,
  ] = await Promise.all([
    supabase
      .from('home_control_accounts')
      .select('id, household_id, service, label, last_sync_at, sync_error')
      .eq('household_id', householdId),

    supabase
      .from('somfy_devices')
      .select('*')
      .eq('account_id', supabase.from('home_control_accounts').select('id').eq('household_id', householdId)),

    supabase
      .from('toshiba_devices')
      .select('*')
      .eq('account_id', supabase.from('home_control_accounts').select('id').eq('household_id', householdId)),

    supabase
      .from('melcloud_devices')
      .select('*')
      .eq('account_id', supabase.from('home_control_accounts').select('id').eq('household_id', householdId)),

    supabase
      .from('home_control_groups')
      .select('*')
      .eq('household_id', householdId)
      .order('sort_order'),
  ])

  // Get account IDs for proper filtering
  const accountIds = (accountsResult.data || []).map(a => a.id)

  // Re-fetch devices with proper account filtering
  const [somfyResult, toshibaResult, melcloudResult] = accountIds.length > 0
    ? await Promise.all([
        supabase
          .from('somfy_devices')
          .select('*')
          .in('account_id', accountIds),
        supabase
          .from('toshiba_devices')
          .select('*')
          .in('account_id', accountIds),
        supabase
          .from('melcloud_devices')
          .select('*')
          .in('account_id', accountIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]

  return {
    accounts: accountsResult.data || [],
    somfyDevices: somfyResult.data || [],
    toshibaDevices: toshibaResult.data || [],
    melcloudDevices: melcloudResult.data || [],
    groups: groupsResult.data || [],
  }
}

/**
 * Cached version of styring data fetcher
 */
function getCachedStyringData(householdId: string) {
  return unstable_cache(
    () => fetchStyringDataCore(householdId),
    ['styring-page-data', householdId],
    {
      revalidate: 60, // Shorter cache for device state (60 seconds)
      tags: [`household-${householdId}`, `styring-${householdId}`]
    }
  )()
}

/**
 * Fetch all data needed for the styring page
 */
export const fetchStyringPageData = cache(async (householdId: string): Promise<StyringPageData> => {
  return getCachedStyringData(householdId)
})

/**
 * Generate demo data for styring page (empty - no demo devices)
 */
export function getDemoStyringPageData(): StyringPageData {
  return {
    accounts: [],
    somfyDevices: [],
    toshibaDevices: [],
    melcloudDevices: [],
    groups: [],
  }
}

/**
 * Revalidate styring cache
 */
export function revalidateStyringCache(householdId: string) {
  revalidateTag(`styring-${householdId}`, 'default')
}

// ============================================================================
// Admin Page Data
// ============================================================================

export interface AdminHouseholdData {
  id: string
  name: string
  created_at: string
  members: Array<{
    id: string
    name: string
    email: string | null
    is_parent: boolean
    is_household_admin: boolean
  }>
  children: Array<{
    id: string
    name: string
  }>
}

export interface AdminPageData {
  isAdmin: boolean
  households: AdminHouseholdData[]
  allowedEmails: AllowedEmail[]
  unmatchedInvites: Array<{
    id: string
    sender_email: string
    calendar_event_id: string
    calendar_summary: string
    status: string
    created_at: string
  }>
  auditLogs: Array<{
    id: string
    created_at: string
    actor_email: string
    action: string
    target_type: string
    target_id: string | null
    target_email: string | null
    details: Record<string, unknown> | null
  }>
}

/**
 * Core admin data fetcher - uses admin client
 */
async function fetchAdminDataCore(): Promise<AdminPageData> {
  const supabase = createAdminClient()

  const [
    householdsResult,
    allowedEmailsResult,
    unmatchedInvitesResult,
    auditLogsResult,
  ] = await Promise.all([
    supabase
      .from('households')
      .select(`
        id, name, created_at,
        members:household_members(id, name, email, is_parent, is_household_admin),
        children:children(id, name)
      `)
      .order('created_at', { ascending: false }),

    supabase
      .from('allowed_emails')
      .select('*')
      .order('created_at', { ascending: false }),

    supabase
      .from('unmatched_calendar_invites')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50),

    supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  return {
    isAdmin: true,
    households: householdsResult.data || [],
    allowedEmails: allowedEmailsResult.data || [],
    unmatchedInvites: unmatchedInvitesResult.data || [],
    auditLogs: auditLogsResult.data || [],
  }
}

/**
 * Cached version of admin data fetcher (short cache for admin data)
 */
function getCachedAdminData() {
  return unstable_cache(
    () => fetchAdminDataCore(),
    ['admin-page-data'],
    {
      revalidate: 30, // Short cache for admin data (30 seconds)
      tags: ['admin-data']
    }
  )()
}

/**
 * Fetch all data needed for the admin page
 */
export const fetchAdminPageData = cache(async (): Promise<AdminPageData> => {
  return getCachedAdminData()
})

/**
 * Generate demo data for admin page
 */
export function getDemoAdminPageData(): AdminPageData {
  const demoState = generateDemoState()

  return {
    isAdmin: true,
    households: demoState.adminHouseholds.map(h => ({
      ...h,
      members: h.members.map((m, i) => ({
        id: `demo-member-${i}`,
        name: m.name,
        email: null,
        is_parent: true,
        is_household_admin: i === 0,
      })),
      children: h.children.map((c, i) => ({
        id: `demo-child-${i}`,
        name: c.name,
      })),
    })),
    allowedEmails: demoState.adminAllowedEmails,
    unmatchedInvites: [],
    auditLogs: [],
  }
}

/**
 * Revalidate admin cache
 */
export function revalidateAdminCache() {
  revalidateTag('admin-data', 'default')
}
