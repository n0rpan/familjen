/**
 * Prefetch Registry
 * Maps routes to their data prefetch functions
 */

import { prefetchWeekData, prefetchShoppingData, prefetchRecipesData } from './fetchers'

export type DataPrefetcher = (householdId: string) => Promise<void>

/**
 * Registry of routes to their data prefetch functions
 * Key: route path (without query params)
 * Value: async function that prefetches and caches data
 */
export const prefetchRegistry: Record<string, DataPrefetcher> = {
  '/uke': prefetchWeekData,
  '/handleliste': prefetchShoppingData,
  '/oppskrifter': prefetchRecipesData,
}

/**
 * Get prefetcher for a route
 */
export function getPrefetcher(path: string): DataPrefetcher | undefined {
  // Normalize path (remove query params and trailing slash)
  const normalizedPath = path.split('?')[0].replace(/\/$/, '') || '/'
  return prefetchRegistry[normalizedPath]
}
