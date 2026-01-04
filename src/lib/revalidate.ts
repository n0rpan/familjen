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
 */
export function revalidateWeek(householdId: string, weekStart: Date | string) {
  if (!householdId || householdId === 'demo') return

  const weekStartStr = typeof weekStart === 'string'
    ? weekStart
    : weekStart.toISOString().split('T')[0]

  // Fire and forget - don't block on this
  fetch('/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ householdId, weekStart: weekStartStr }),
  }).catch(err => {
    console.warn('[revalidate] Failed to revalidate week cache:', err)
  })
}
