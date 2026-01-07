/**
 * Client-Side Cache Revalidation
 *
 * Call these functions after mutations to invalidate server cache.
 * This ensures fresh data on next navigation instead of stale cache.
 *
 * The revalidation is fire-and-forget - we don't wait for it to complete
 * since realtime will update the current view anyway.
 */

/**
 * Revalidate all cached data for a household
 * Use after mutations that affect multiple weeks (e.g., copying data)
 */
export function revalidateHousehold(householdId: string) {
  if (!householdId || householdId === 'demo') return

  // Fire and forget - don't block on this
  fetch('/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ householdId }),
  }).catch(err => {
    console.warn('[revalidate] Failed to revalidate household cache:', err)
  })
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

  try {
    await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId, weekStart: weekStartStr }),
    })
  } catch (err) {
    console.warn('[revalidate] Failed to revalidate week cache:', err)
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
