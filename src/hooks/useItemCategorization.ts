/**
 * Hook for categorizing shopping items
 * Uses local cache first, falls back to AI API
 */

import { useCallback } from 'react'
import { getCachedCategory, setCachedCategory } from '@/lib/shopping-category-cache'
import type { ShoppingCategory } from '@/lib/constants'
import type { CategorizeItemResponse } from '@/app/api/openrouter/categorize-item/route'

interface UseItemCategorizationReturn {
  /**
   * Categorize an item name
   * Returns immediately from cache if available, otherwise calls API
   */
  categorizeItem: (itemName: string) => Promise<ShoppingCategory>

  /**
   * Get cached category synchronously (for optimistic updates)
   * Returns undefined if not in cache
   */
  getCachedCategory: (itemName: string) => ShoppingCategory | undefined

  /**
   * Manually set a category for an item (user correction)
   * Also updates the local cache
   */
  setCategoryOverride: (itemName: string, category: ShoppingCategory) => void
}

export function useItemCategorization(): UseItemCategorizationReturn {
  const categorizeItem = useCallback(async (itemName: string): Promise<ShoppingCategory> => {
    // Try local cache first
    const cached = getCachedCategory(itemName)
    if (cached) {
      return cached
    }

    // Call API
    try {
      const response = await fetch('/api/openrouter/categorize-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemName }),
      })

      if (!response.ok) {
        return 'other'
      }

      const data: CategorizeItemResponse = await response.json()

      // Cache the result for future use
      if (data.confidence > 0.7) {
        setCachedCategory(itemName, data.category)
      }

      return data.category
    } catch (error) {
      console.error('Failed to categorize item:', error)
      return 'other'
    }
  }, [])

  const setCategoryOverride = useCallback((itemName: string, category: ShoppingCategory) => {
    // Save to local cache - this acts as a user correction
    setCachedCategory(itemName, category)
  }, [])

  return {
    categorizeItem,
    getCachedCategory,
    setCategoryOverride,
  }
}
