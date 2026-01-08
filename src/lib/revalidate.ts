/**
 * Client-Side Cache Revalidation
 *
 * Call these functions after mutations to invalidate server cache.
 * This ensures fresh data on next navigation instead of stale cache.
 *
 * Key functions (awaitable - use before router.refresh() to avoid race conditions):
 * - revalidateHousehold: Invalidates all cached data for a household
 * - revalidateWeek: Invalidates cached data for a specific week
 *
 * Other functions are fire-and-forget for convenience (page-specific caches).
 */

// Timeout for revalidation requests to prevent indefinite blocking
const REVALIDATE_TIMEOUT_MS = 5000

/**
 * Revalidate all cached data for a household
 * Use after mutations that affect multiple weeks (e.g., copying data)
 * @returns Promise that resolves when cache is invalidated
 */
export async function revalidateHousehold(householdId: string): Promise<void> {
  if (!householdId || householdId === 'demo') return

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS)

  try {
    const response = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn(`[revalidate] Household cache revalidation failed with status ${response.status}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[revalidate] Household cache revalidation timed out')
    } else {
      console.warn('[revalidate] Failed to revalidate household cache:', err)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Revalidate cached data for a specific week
 * Use after mutations that affect a single week
 * @returns Promise that resolves when cache is invalidated
 */
export async function revalidateWeek(householdId: string, weekStart: Date | string): Promise<void> {
  if (!householdId || householdId === 'demo') return

  const weekStartStr = typeof weekStart === 'string'
    ? weekStart
    : weekStart.toISOString().split('T')[0]

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS)

  try {
    const response = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId, weekStart: weekStartStr }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn(`[revalidate] Week cache revalidation failed with status ${response.status}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[revalidate] Week cache revalidation timed out')
    } else {
      console.warn('[revalidate] Failed to revalidate week cache:', err)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Revalidate cached recipes data
 * Use after recipe mutations (add, update, delete)
 */
export function revalidateRecipes(householdId: string) {
  if (!householdId || householdId === 'demo') return

  fetch('/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ householdId, type: 'recipes' }),
  }).catch(err => {
    console.warn('[revalidate] Failed to revalidate recipes cache:', err)
  })
}

/**
 * Revalidate cached shopping data
 * Use after shopping list mutations
 */
export function revalidateShopping(householdId: string) {
  if (!householdId || householdId === 'demo') return

  fetch('/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ householdId, type: 'shopping' }),
  }).catch(err => {
    console.warn('[revalidate] Failed to revalidate shopping cache:', err)
  })
}

/**
 * Revalidate cached settings data
 * Use after settings mutations
 */
export function revalidateSettings(householdId: string) {
  if (!householdId || householdId === 'demo') return

  fetch('/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ householdId, type: 'settings' }),
  }).catch(err => {
    console.warn('[revalidate] Failed to revalidate settings cache:', err)
  })
}

/**
 * Revalidate cached feed data
 * Use after feed-related mutations
 */
export function revalidateFeed(householdId: string) {
  if (!householdId || householdId === 'demo') return

  fetch('/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ householdId, type: 'feed' }),
  }).catch(err => {
    console.warn('[revalidate] Failed to revalidate feed cache:', err)
  })
}

/**
 * Revalidate cached home control (styring) data
 * Use after device state changes
 */
export function revalidateStyring(householdId: string) {
  if (!householdId || householdId === 'demo') return

  fetch('/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ householdId, type: 'styring' }),
  }).catch(err => {
    console.warn('[revalidate] Failed to revalidate styring cache:', err)
  })
}

/**
 * Revalidate admin cache
 * Use after admin mutations (admin only)
 */
export function revalidateAdmin() {
  fetch('/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'admin' }),
  }).catch(err => {
    console.warn('[revalidate] Failed to revalidate admin cache:', err)
  })
}
