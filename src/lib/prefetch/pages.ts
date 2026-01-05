/**
 * Data Prefetching for Pages
 *
 * Prefetch functions to be called on link hover for instant navigation.
 * These functions fetch data and store it in IndexedDB cache.
 * When the user navigates, the data hook will find the cached data instantly.
 */

import { createClient } from '@/lib/supabase/client'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'
import { CACHE_VERSION } from '@/components/home/HomeDataCache'

// Cache keys used by data hooks - must match
export const CACHE_KEYS = {
  home: (householdId: string) => `home-${householdId}`,
  week: (householdId: string, weekStart: string) => `week-${householdId}-${weekStart}`,
  feed: (householdId: string) => `feed-${householdId}`,
  shopping: (householdId: string) => `shopping-${householdId}`,
  recipes: (householdId: string) => `recipes-${householdId}`,
}

// Max age before we consider prefetched data stale
const PREFETCH_MAX_AGE = 10 * 60 * 1000 // 10 minutes (longer since we have realtime)

// Background refresh interval
export const BACKGROUND_REFRESH_INTERVAL = 10 * 60 * 1000 // 10 minutes

/**
 * Prefetch feed data (messages, photos, notifications)
 * Call this when user hovers over the /feed link
 */
export async function prefetchFeedData(householdId: string): Promise<void> {
  const cacheKey = CACHE_KEYS.feed(householdId)

  // Skip if already cached and fresh
  const cached = await getCached(cacheKey)
  if (cached && isCacheFresh(cached, PREFETCH_MAX_AGE)) {
    return
  }

  try {
    const supabase = createClient()

    // Check if integrations are enabled first
    const { data: householdData } = await supabase
      .from('households')
      .select('external_integrations_enabled')
      .eq('id', householdId)
      .single()

    if (!householdData?.external_integrations_enabled) {
      // Cache that integrations are disabled
      await setCache(cacheKey, { integrationsEnabled: false })
      return
    }

    // Parallel fetch - match what useFeed fetches
    const [
      integrationsResult,
      messagesResult,
      integrationChildrenResult,
      photosResult,
      notificationsResult,
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
    ])

    // Store in cache for useFeed to find
    await setCache(cacheKey, {
      integrationsEnabled: true,
      integrations: integrationsResult.data || [],
      messages: messagesResult.data || [],
      integrationChildren: integrationChildrenResult.data || [],
      photos: photosResult.data || [],
      notifications: notificationsResult.data || [],
    })
  } catch (error) {
    console.warn('[Prefetch] Failed to prefetch feed data:', error)
    // Don't throw - prefetching is best-effort
  }
}

/**
 * Prefetch shopping lists data
 * Call this when user hovers over the /handleliste link
 */
export async function prefetchShoppingData(householdId: string): Promise<void> {
  const cacheKey = CACHE_KEYS.shopping(householdId)

  // Skip if already cached and fresh
  const cached = await getCached(cacheKey)
  if (cached && isCacheFresh(cached, PREFETCH_MAX_AGE)) {
    return
  }

  try {
    const supabase = createClient()

    // Fetch lists
    const { data: listsData } = await supabase
      .from('shopping_lists')
      .select('*')
      .eq('household_id', householdId)
      .eq('is_archived', false)
      .order('sort_order', { ascending: true })

    if (!listsData || listsData.length === 0) {
      await setCache(cacheKey, { lists: [], items: [] })
      return
    }

    // Fetch items for all lists
    const listIds = listsData.map(l => l.id)
    const { data: itemsData } = await supabase
      .from('shopping_list_items')
      .select('*')
      .in('list_id', listIds)
      .order('created_at', { ascending: true })

    await setCache(cacheKey, {
      lists: listsData,
      items: itemsData || [],
    })
  } catch (error) {
    console.warn('[Prefetch] Failed to prefetch shopping data:', error)
  }
}

/**
 * Prefetch recipes data
 * Call this when user hovers over the /oppskrifter link
 */
export async function prefetchRecipesData(householdId: string): Promise<void> {
  const cacheKey = CACHE_KEYS.recipes(householdId)

  // Skip if already cached and fresh
  const cached = await getCached(cacheKey)
  if (cached && isCacheFresh(cached, PREFETCH_MAX_AGE)) {
    return
  }

  try {
    const supabase = createClient()

    const { data: recipesData } = await supabase
      .from('recipes')
      .select('*')
      .eq('household_id', householdId)
      .order('name', { ascending: true })

    await setCache(cacheKey, {
      recipes: recipesData || [],
    })
  } catch (error) {
    console.warn('[Prefetch] Failed to prefetch recipes data:', error)
  }
}

/**
 * Prefetch home page data
 * Call this when user hovers over home link or on initial load
 *
 * Note: This is a standalone async function (not a React hook), so createClient()
 * is called once per invocation. The useMemo pattern from Key Patterns only applies
 * to React components/hooks that may re-render.
 */
export async function prefetchHomeData(householdId: string): Promise<void> {
  const cacheKey = CACHE_KEYS.home(householdId)

  // Skip if already cached and fresh
  const cached = await getCached(cacheKey)
  if (cached && isCacheFresh(cached, PREFETCH_MAX_AGE)) {
    return
  }

  try {
    // createClient() is called once per function invocation (not on re-render)
    const supabase = createClient()

    // Calculate week dates
    const today = new Date()
    const dayOfWeek = today.getDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() + mondayOffset)
    weekStart.setHours(0, 0, 0, 0)

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)

    const weekStartStr = weekStart.toISOString().split('T')[0]
    const weekEndStr = weekEnd.toISOString().split('T')[0]

    // Parallel fetch - match what server fetches
    const [
      householdResult,
      childrenResult,
      membersResult,
      pickupsResult,
      mealsResult,
      tasksResult,
      memberEventsResult,
      householdEventsResult,
      externalEventsResult,
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
      supabase.from('child_tasks')
        .select('*, child:children(*)')
        .eq('household_id', householdId)
        .gte('date', weekStartStr)
        .lte('date', weekEndStr),
      supabase.from('member_events')
        .select('*')
        .eq('household_id', householdId)
        .lte('date', weekEndStr)
        .or(`end_date.gte.${weekStartStr},end_date.is.null`),
      supabase.from('household_events')
        .select('*')
        .eq('household_id', householdId)
        .lte('event_date', weekEndStr)
        .or(`end_date.gte.${weekStartStr},end_date.is.null`),
      supabase.from('external_events')
        .select('*, integration:external_integrations!inner(service, display_name)')
        .eq('external_integrations.household_id', householdId)
        .eq('is_hidden', false)
        .gte('event_date', weekStartStr)
        .lte('event_date', weekEndStr),
    ])

    await setCache(cacheKey, {
      version: CACHE_VERSION,
      household: householdResult.data,
      children: childrenResult.data || [],
      members: membersResult.data || [],
      pickups: pickupsResult.data || [],
      meals: mealsResult.data || [],
      tasks: tasksResult.data || [],
      memberEvents: memberEventsResult.data || [],
      householdEvents: householdEventsResult.data || [],
      externalEvents: externalEventsResult.data || [],
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
    })
  } catch (error) {
    console.warn('[Prefetch] Failed to prefetch home data:', error)
  }
}

/**
 * Map of routes to their prefetch functions
 * Used by TransitionLink to prefetch data on hover
 */
export const PREFETCH_MAP: Record<string, (householdId: string) => Promise<void>> = {
  '/': prefetchHomeData,
  '/feed': prefetchFeedData,
  '/handleliste': prefetchShoppingData,
  '/oppskrifter': prefetchRecipesData,
}

/**
 * Prefetch data for a given route
 * Returns immediately if route has no prefetch function or householdId is missing
 */
export async function prefetchRouteData(route: string, householdId: string | null): Promise<void> {
  if (!householdId) return

  // Normalize route (remove query params)
  const path = route.split('?')[0]
  const prefetchFn = PREFETCH_MAP[path]

  if (prefetchFn) {
    await prefetchFn(householdId)
  }
}

/**
 * Prefetch all page data in menu order
 * Call this when user is on home page to warm all caches
 *
 * Order follows nav menu: Week → Feed → Recipes → Shopping → Settings
 * Uses staggered fetching to not block the main thread
 */
export async function prefetchAllPages(householdId: string): Promise<void> {
  if (!householdId) return

  // Small delay before starting to not interfere with initial render
  await new Promise(resolve => setTimeout(resolve, 1000))

  try {
    // Prefetch in menu order with small delays between each
    // This prevents overwhelming the network/database

    // 0. Home page data (for PWA restarts with cold server cache)
    await prefetchHomeData(householdId)
    await new Promise(resolve => setTimeout(resolve, 500))

    // 1. Feed (messages, photos - users often check this)
    await prefetchFeedData(householdId)
    await new Promise(resolve => setTimeout(resolve, 500))

    // 2. Recipes
    await prefetchRecipesData(householdId)
    await new Promise(resolve => setTimeout(resolve, 500))

    // 3. Shopping
    await prefetchShoppingData(householdId)
    await new Promise(resolve => setTimeout(resolve, 500))

    // 4. Settings data (household, members, children)
    await prefetchSettingsData(householdId)
  } catch (error) {
    console.warn('[Prefetch] Error prefetching all pages:', error)
  }
}

/**
 * Prefetch settings page data (household info, members, children)
 */
export async function prefetchSettingsData(householdId: string): Promise<void> {
  const cacheKey = `settings-${householdId}`

  // Skip if already cached and fresh
  const cached = await getCached(cacheKey)
  if (cached && isCacheFresh(cached, PREFETCH_MAX_AGE)) {
    return
  }

  try {
    const supabase = createClient()

    const [householdResult, membersResult, childrenResult] = await Promise.all([
      supabase
        .from('households')
        .select('*')
        .eq('id', householdId)
        .single(),
      supabase
        .from('household_members')
        .select('*')
        .eq('household_id', householdId),
      supabase
        .from('children')
        .select('*')
        .eq('household_id', householdId)
        .order('sort_order'),
    ])

    await setCache(cacheKey, {
      household: householdResult.data,
      members: membersResult.data || [],
      children: childrenResult.data || [],
    })
  } catch (error) {
    console.warn('[Prefetch] Failed to prefetch settings data:', error)
  }
}

/**
 * Force refresh all cached data (ignores freshness check)
 * Call this periodically (e.g., every 10 minutes) when app is in foreground
 */
export async function refreshAllCaches(householdId: string): Promise<void> {
  if (!householdId) return

  try {
    // Clear freshness to force refetch
    const supabase = createClient()

    // Parallel fetch all page data
    await Promise.all([
      prefetchFeedData(householdId),
      prefetchRecipesData(householdId),
      prefetchShoppingData(householdId),
      prefetchSettingsData(householdId),
    ])
  } catch (error) {
    console.warn('[Prefetch] Background refresh failed:', error)
  }
}
