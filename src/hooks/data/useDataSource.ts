'use client'

/**
 * useDataSource Hook
 *
 * Foundation hook for data abstraction layer.
 * Returns whether we're in demo mode and provides access to the appropriate data source.
 *
 * Usage:
 * ```typescript
 * const { isDemo, supabase, demoState } = useDataSource()
 * if (isDemo) {
 *   // Use demoState
 * } else {
 *   // Use supabase
 * }
 * ```
 */

import { useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useDemo } from '@/lib/demo/context'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DemoState } from '@/lib/demo/types'

export interface DataSourceValue {
  /** Whether we're in demo mode */
  isDemo: boolean
  /** Supabase client (null in demo mode) */
  supabase: SupabaseClient | null
  /** Demo state (null in production) */
  demoState: DemoState | null
  /** Demo mutations (available in demo mode) */
  demoMutations: {
    updatePickup: (childId: string, date: string, pickerId: string | null, time?: string | null) => void
    updateMeal: (date: string, recipeId: string | null, customMeal: string | null) => void
    addTask: (task: Parameters<ReturnType<typeof useDemo>['addTask']>[0]) => void
    updateTask: (taskId: string, updates: Parameters<ReturnType<typeof useDemo>['updateTask']>[1]) => void
    deleteTask: (taskId: string) => void
    addRecipe: (recipe: Parameters<ReturnType<typeof useDemo>['addRecipe']>[0]) => void
    updateRecipe: (recipeId: string, updates: Parameters<ReturnType<typeof useDemo>['updateRecipe']>[1]) => void
    deleteRecipe: (recipeId: string) => void
    addShoppingItem: (listId: string, item: Parameters<ReturnType<typeof useDemo>['addShoppingItem']>[1]) => void
    updateShoppingItem: (itemId: string, updates: Parameters<ReturnType<typeof useDemo>['updateShoppingItem']>[1]) => void
    deleteShoppingItem: (itemId: string) => void
  }
}

/**
 * Hook to get the current data source (demo or production)
 */
export function useDataSource(): DataSourceValue {
  const demo = useDemo()

  // Only create Supabase client if not in demo mode
  const supabase = useMemo(() => {
    if (demo.isDemo) return null
    return createClient()
  }, [demo.isDemo])

  return useMemo(() => ({
    isDemo: demo.isDemo,
    supabase,
    demoState: demo.demoState,
    demoMutations: {
      updatePickup: demo.updatePickup,
      updateMeal: demo.updateMeal,
      addTask: demo.addTask,
      updateTask: demo.updateTask,
      deleteTask: demo.deleteTask,
      addRecipe: demo.addRecipe,
      updateRecipe: demo.updateRecipe,
      deleteRecipe: demo.deleteRecipe,
      addShoppingItem: demo.addShoppingItem,
      updateShoppingItem: demo.updateShoppingItem,
      deleteShoppingItem: demo.deleteShoppingItem,
    },
  }), [demo, supabase])
}
