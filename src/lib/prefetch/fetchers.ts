/**
 * Data Prefetchers
 * Fetch and cache page data for instant navigation
 */

import { createClient } from '@/lib/supabase/client'
import { getCached, setCache, isCacheFresh, DEFAULT_MAX_AGE } from '@/lib/cache'
import { formatDateISO, addDays, getWeekStart, type Holiday } from '@/lib/utils'
import type { WeekCacheData, ShoppingCacheData } from '@/lib/types'

/**
 * Generate cache key for week data
 */
export function getWeekCacheKey(householdId: string, weekOffset: number = 0): string {
  return `week:${householdId}:${weekOffset}`
}

/**
 * Get cached week data if it exists and is fresh
 */
export async function getCachedWeekData(householdId: string, weekOffset: number = 0): Promise<WeekCacheData | null> {
  const cacheKey = getWeekCacheKey(householdId, weekOffset)
  const cached = await getCached<WeekCacheData>(cacheKey)
  if (cached && isCacheFresh(cached, DEFAULT_MAX_AGE)) {
    return cached.data
  }
  return null
}

/**
 * Fetch all week data and cache it
 * Returns the fetched data for immediate use
 */
export async function fetchAndCacheWeekData(householdId: string, weekOffset: number = 0): Promise<WeekCacheData> {
  const supabase = createClient()
  const cacheKey = getWeekCacheKey(householdId, weekOffset)

  // Calculate week dates
  const today = new Date()
  const weekStart = addDays(getWeekStart(today), weekOffset * 7)
  const weekEnd = addDays(weekStart, 6)
  const weekStartStr = formatDateISO(weekStart)
  const weekEndStr = formatDateISO(weekEnd)

  // Fetch all data in parallel
  const [
    householdResult,
    childrenResult,
    membersResult,
    pickupsResult,
    mealsResult,
    recipesResult,
    eventsResult,
    householdEventsResult,
    tasksResult,
    externalEventsResult,
    holidaysResult,
    weekContextResult,
  ] = await Promise.all([
    // Household
    supabase.from('households').select('*').eq('id', householdId).single(),
    // Children
    supabase.from('children').select('*').eq('household_id', householdId).order('sort_order'),
    // Members
    supabase.from('household_members').select('*').eq('household_id', householdId),
    // Pickups with relations
    supabase.from('pickups').select('*, child:children(*), picker:household_members(*)').eq('household_id', householdId).gte('date', weekStartStr).lte('date', weekEndStr),
    // Meals with recipe
    supabase.from('meals').select('*, recipe:recipes(*)').eq('household_id', householdId).gte('date', weekStartStr).lte('date', weekEndStr),
    // Recipes
    supabase.from('recipes').select('*').eq('household_id', householdId).order('name'),
    // Member events
    supabase.from('member_events').select('*').eq('household_id', householdId).lte('date', weekEndStr).or(`end_date.gte.${weekStartStr},end_date.is.null`),
    // Household events
    supabase.from('household_events').select('*').eq('household_id', householdId).lte('event_date', weekEndStr).or(`end_date.gte.${weekStartStr},end_date.is.null`).order('event_date').order('event_time'),
    // Child tasks
    supabase.from('child_tasks').select('*').eq('household_id', householdId).gte('date', weekStartStr).lte('date', weekEndStr).order('date').order('time'),
    // External events with integration info
    supabase.from('external_events').select('*, integration:external_integrations!inner(service, display_name)').eq('external_integrations.household_id', householdId).eq('is_hidden', false).gte('event_date', weekStartStr).lte('event_date', weekEndStr).order('event_date').order('event_time'),
    // Holidays - already minimal
    supabase.from('calendar_events').select('date, name').or(`household_id.is.null,household_id.eq.${householdId}`).gte('date', weekStartStr).lte('date', weekEndStr).eq('event_type', 'holiday'),
    // Week context
    supabase.from('week_contexts').select('context').eq('household_id', householdId).eq('week_start', weekStartStr).maybeSingle(),
  ])

  // Generate birthdays from members and children with birth_date
  const currentYear = new Date().getFullYear()
  const birthdays: Holiday[] = []

  membersResult.data?.forEach(member => {
    if (member.birth_date) {
      const birthDate = new Date(member.birth_date)
      const thisYearBirthday = `${currentYear}-${String(birthDate.getMonth() + 1).padStart(2, '0')}-${String(birthDate.getDate()).padStart(2, '0')}`
      if (thisYearBirthday >= weekStartStr && thisYearBirthday <= weekEndStr) {
        birthdays.push({ date: thisYearBirthday, name: member.name, type: 'birthday' })
      }
    }
  })

  childrenResult.data?.forEach(child => {
    if (child.birth_date) {
      const birthDate = new Date(child.birth_date)
      const thisYearBirthday = `${currentYear}-${String(birthDate.getMonth() + 1).padStart(2, '0')}-${String(birthDate.getDate()).padStart(2, '0')}`
      if (thisYearBirthday >= weekStartStr && thisYearBirthday <= weekEndStr) {
        birthdays.push({ date: thisYearBirthday, name: child.name, type: 'birthday' })
      }
    }
  })

  const weekData: WeekCacheData = {
    household: householdResult.data || null,
    children: childrenResult.data || [],
    members: membersResult.data || [],
    pickups: pickupsResult.data || [],
    meals: mealsResult.data || [],
    recipes: recipesResult.data || [],
    memberEvents: eventsResult.data || [],
    householdEvents: householdEventsResult.data || [],
    childTasks: tasksResult.data || [],
    externalEvents: externalEventsResult.data || [],
    holidays: [
      ...(holidaysResult.data || []).map(h => ({ ...h, type: 'holiday' as const })),
      ...birthdays,
    ],
    weekContext: weekContextResult.data?.context || '',
    weekStartStr,
    weekEndStr,
    timestamp: Date.now(),
  }

  // Cache the data
  await setCache(cacheKey, weekData)

  return weekData
}

/**
 * Generate cache key for shopping data
 */
export function getShoppingCacheKey(householdId: string): string {
  return `shopping:${householdId}`
}

/**
 * Generate cache key for recipes data
 */
export function getRecipesCacheKey(householdId: string): string {
  return `recipes:${householdId}`
}

/**
 * Prefetch week planner data
 * Fetches all week data and caches for instant navigation
 */
export async function prefetchWeekData(householdId: string, weekOffset: number = 0): Promise<void> {
  // Check if cache is fresh first
  const cached = await getCachedWeekData(householdId, weekOffset)
  if (cached) {
    return // Already fresh, skip
  }

  try {
    await fetchAndCacheWeekData(householdId, weekOffset)
  } catch (error) {
    console.warn('[Prefetch] Failed to prefetch week data:', error)
  }
}

/**
 * Get cached shopping data if it exists and is fresh
 */
export async function getCachedShoppingData(householdId: string): Promise<ShoppingCacheData | null> {
  const cacheKey = getShoppingCacheKey(householdId)
  const cached = await getCached<ShoppingCacheData>(cacheKey)
  if (cached && isCacheFresh(cached, DEFAULT_MAX_AGE)) {
    return cached.data
  }
  return null
}

/**
 * Fetch shopping data and cache it
 */
export async function fetchAndCacheShoppingData(householdId: string): Promise<ShoppingCacheData> {
  const supabase = createClient()
  const cacheKey = getShoppingCacheKey(householdId)

  // Fetch shopping lists (only non-archived)
  const { data: lists } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('household_id', householdId)
    .eq('is_archived', false)
    .order('sort_order')

  if (!lists?.length) {
    const emptyData: ShoppingCacheData = { lists: [], items: [], timestamp: Date.now() }
    await setCache(cacheKey, emptyData)
    return emptyData
  }

  const listIds = lists.map(l => l.id)
  const { data: items } = await supabase
    .from('shopping_list_items')
    .select('*')
    .in('list_id', listIds)
    .order('created_at', { ascending: false })

  const shoppingData: ShoppingCacheData = {
    lists,
    items: items || [],
    timestamp: Date.now(),
  }

  await setCache(cacheKey, shoppingData)
  return shoppingData
}

/**
 * Prefetch shopping list data
 */
export async function prefetchShoppingData(householdId: string): Promise<void> {
  // Check if cache is fresh first
  const cached = await getCachedShoppingData(householdId)
  if (cached) {
    return // Already fresh, skip
  }

  try {
    await fetchAndCacheShoppingData(householdId)
  } catch (error) {
    console.warn('[Prefetch] Failed to prefetch shopping data:', error)
  }
}

/**
 * Prefetch recipes data
 */
export async function prefetchRecipesData(householdId: string): Promise<void> {
  const cacheKey = getRecipesCacheKey(householdId)

  // Check if cache is fresh
  const cached = await getCached(cacheKey)
  if (isCacheFresh(cached, DEFAULT_MAX_AGE)) {
    return // Already fresh, skip
  }

  const supabase = createClient()

  try {
    const { data: recipes } = await supabase
      .from('recipes')
      .select('*')
      .eq('household_id', householdId)
      .order('name')

    await setCache(cacheKey, { recipes: recipes || [] })
  } catch (error) {
    console.warn('[Prefetch] Failed to prefetch recipes data:', error)
  }
}
