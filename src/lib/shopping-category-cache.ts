/**
 * Local cache for shopping item categories
 * Uses shared common items + localStorage for learned corrections
 */

import type { ShoppingCategory } from './constants'
import { SHOPPING_CATEGORIES } from './constants'
import { COMMON_ITEMS, normalizeItemName } from './shopping-common-items'

// Storage key for localStorage
const CACHE_KEY = 'shopping-category-cache'
const CACHE_VERSION = 1

interface CacheEntry {
  category: ShoppingCategory
  count: number  // How many times this mapping was used
}

interface CacheData {
  version: number
  items: Record<string, CacheEntry>
}

/**
 * Get cached category for an item
 * Checks: 1) Learned cache (user corrections), 2) Common items
 * Returns undefined if not in cache
 */
export function getCachedCategory(itemName: string): ShoppingCategory | undefined {
  const normalized = normalizeItemName(itemName)

  // Check learned cache first (user corrections take priority)
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(CACHE_KEY)
      if (stored) {
        const cache: CacheData = JSON.parse(stored)
        if (cache.version === CACHE_VERSION && cache.items[normalized]) {
          return cache.items[normalized].category
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  // Check hardcoded common items
  if (normalized in COMMON_ITEMS) {
    return COMMON_ITEMS[normalized]
  }

  return undefined
}

/**
 * Save a category mapping to the learned cache
 * Call this after AI categorization or user correction
 */
export function setCachedCategory(itemName: string, category: ShoppingCategory): void {
  if (typeof window === 'undefined') return
  if (!SHOPPING_CATEGORIES.includes(category)) return

  const normalized = normalizeItemName(itemName)

  try {
    const stored = localStorage.getItem(CACHE_KEY)
    const cache: CacheData = stored
      ? JSON.parse(stored)
      : { version: CACHE_VERSION, items: {} }

    // Migrate if version mismatch
    if (cache.version !== CACHE_VERSION) {
      cache.version = CACHE_VERSION
      cache.items = {}
    }

    const existing = cache.items[normalized]
    cache.items[normalized] = {
      category,
      count: (existing?.count || 0) + 1,
    }

    // Limit cache size (keep most frequently used 500 items)
    const entries = Object.entries(cache.items)
    if (entries.length > 500) {
      entries.sort((a, b) => b[1].count - a[1].count)
      cache.items = Object.fromEntries(entries.slice(0, 500))
    }

    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear the category cache (for testing/debugging)
 */
export function clearCategoryCache(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(CACHE_KEY)
}

// Re-export for convenience
export { normalizeItemName, getCommonItemCategory } from './shopping-common-items'
