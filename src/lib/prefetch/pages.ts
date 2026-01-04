/**
 * Data Prefetching for Pages
 *
 * Prefetch functions to be called on link hover for instant navigation.
 * These functions fetch data and store it in IndexedDB cache.
 * When the user navigates, the data hook will find the cached data instantly.
 */

import { createClient } from '@/lib/supabase/client'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'

// Cache keys used by data hooks - must match
export const CACHE_KEYS = {
  feed: (householdId: string) => `feed-${householdId}`,
  shopping: (householdId: string) => `shopping-${householdId}`,
  recipes: (householdId: string) => `recipes-${householdId}`,
}

// Max age before we consider prefetched data stale
const PREFETCH_MAX_AGE = 3 * 60 * 1000 // 3 minutes

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
 * Map of routes to their prefetch functions
 * Used by TransitionLink to prefetch data on hover
 */
export const PREFETCH_MAP: Record<string, (householdId: string) => Promise<void>> = {
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
