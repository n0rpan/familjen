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
 * @returns Promise that resolves when cache is invalidated
 */
export async function revalidateRecipes(householdId: string): Promise<void> {
  if (!householdId || householdId === 'demo') return

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS)

  try {
    const response = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId, type: 'recipes' }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn(`[revalidate] Recipes cache revalidation failed with status ${response.status}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[revalidate] Recipes cache revalidation timed out')
    } else {
      console.warn('[revalidate] Failed to revalidate recipes cache:', err)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Revalidate cached shopping data
 * Use after shopping list mutations
 * @returns Promise that resolves when cache is invalidated
 */
export async function revalidateShopping(householdId: string): Promise<void> {
  if (!householdId || householdId === 'demo') return

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS)

  try {
    const response = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId, type: 'shopping' }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn(`[revalidate] Shopping cache revalidation failed with status ${response.status}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[revalidate] Shopping cache revalidation timed out')
    } else {
      console.warn('[revalidate] Failed to revalidate shopping cache:', err)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Revalidate cached settings data
 * Use after settings mutations
 * @returns Promise that resolves when cache is invalidated
 */
export async function revalidateSettings(householdId: string): Promise<void> {
  if (!householdId || householdId === 'demo') return

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS)

  try {
    const response = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId, type: 'settings' }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn(`[revalidate] Settings cache revalidation failed with status ${response.status}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[revalidate] Settings cache revalidation timed out')
    } else {
      console.warn('[revalidate] Failed to revalidate settings cache:', err)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Revalidate cached feed data
 * Use after feed-related mutations
 * @returns Promise that resolves when cache is invalidated
 */
export async function revalidateFeed(householdId: string): Promise<void> {
  if (!householdId || householdId === 'demo') return

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS)

  try {
    const response = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId, type: 'feed' }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn(`[revalidate] Feed cache revalidation failed with status ${response.status}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[revalidate] Feed cache revalidation timed out')
    } else {
      console.warn('[revalidate] Failed to revalidate feed cache:', err)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Revalidate cached home control (styring) data
 * Use after device state changes
 * @returns Promise that resolves when cache is invalidated
 */
export async function revalidateStyring(householdId: string): Promise<void> {
  if (!householdId || householdId === 'demo') return

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS)

  try {
    const response = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId, type: 'styring' }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn(`[revalidate] Styring cache revalidation failed with status ${response.status}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[revalidate] Styring cache revalidation timed out')
    } else {
      console.warn('[revalidate] Failed to revalidate styring cache:', err)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Revalidate admin cache
 * Use after admin mutations (admin only)
 * @returns Promise that resolves when cache is invalidated
 */
export async function revalidateAdmin(): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS)

  try {
    const response = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'admin' }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn(`[revalidate] Admin cache revalidation failed with status ${response.status}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[revalidate] Admin cache revalidation timed out')
    } else {
      console.warn('[revalidate] Failed to revalidate admin cache:', err)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
