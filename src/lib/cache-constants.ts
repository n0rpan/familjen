/**
 * Cache Constants
 *
 * Shared constants for IndexedDB caching system.
 * This file is kept minimal to avoid circular dependencies - it should NOT
 * import from components or other modules that use these constants.
 */

/**
 * Cache version - increment this when the CachedHomeData structure changes
 * to prevent crashes from stale data with incompatible schema
 */
export const CACHE_VERSION = 1

/**
 * Cache keys used by data hooks and prefetch functions
 * Keys are scoped by householdId to prevent data leakage between households
 */
export const CACHE_KEYS = {
  home: (householdId: string) => `home-${householdId}`,
  week: (householdId: string, weekStart: string) => `week-${householdId}-${weekStart}`,
  feed: (householdId: string) => `feed-${householdId}`,
  shopping: (householdId: string) => `shopping-${householdId}`,
  recipes: (householdId: string) => `recipes-${householdId}`,
}
