'use client'

/**
 * useRecipes Hook
 *
 * Abstracts recipe data fetching and mutations for both demo and production modes.
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - shouldFetch: household loaded but initial fetch not done
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'
import type { Recipe } from '@/lib/types'

export interface UseRecipesReturn {
  recipes: Recipe[]
  loading: boolean
  error: string | null
  addRecipe: (recipe: Omit<Recipe, 'id' | 'created_at' | 'updated_at' | 'household_id'>) => Promise<void>
  updateRecipe: (recipeId: string, updates: Partial<Recipe>) => Promise<void>
  deleteRecipe: (recipeId: string) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get all recipes in the household
 */
export function useRecipes(): UseRecipesReturn {
  const { isDemo, supabase, demoState, demoMutations } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [initialFetchDone, setInitialFetchDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setIsFetching(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('recipes')
        .select('*')
        .eq('household_id', household.id)
        .order('name', { ascending: true })

      if (fetchError) throw fetchError

      setRecipes(data || [])
    } catch (err) {
      console.error('Error fetching recipes:', err)
      setError(err instanceof Error ? err.message : 'Failed to load recipes')
    } finally {
      setIsFetching(false)
      setInitialFetchDone(true)
    }
  }, [isDemo, supabase, household?.id])

  // Fetch when household becomes available
  useEffect(() => {
    if (!isDemo && household?.id && !initialFetchDone) {
      fetchData()
    }
  }, [isDemo, household?.id, initialFetchDone, fetchData])

  // Subscribe to realtime changes for instant sync between family members
  useRealtimeSubscription<Recipe>({
    table: 'recipes',
    filter: household?.id ? createHouseholdFilter(household.id) : undefined,
    enabled: !isDemo && !!household?.id,
    onAny: fetchData,
  })

  // Add recipe mutation
  const addRecipe = useCallback(async (
    recipe: Omit<Recipe, 'id' | 'created_at' | 'updated_at' | 'household_id'>
  ) => {
    if (isDemo) {
      demoMutations.addRecipe({ ...recipe, household_id: demoState?.household.id || '' })
      return
    }

    if (!supabase || !household?.id) return

    try {
      await supabase
        .from('recipes')
        .insert({
          ...recipe,
          household_id: household.id,
        })

      await fetchData()
    } catch (err) {
      console.error('Error adding recipe:', err)
      throw err
    }
  }, [isDemo, supabase, household?.id, demoMutations, demoState, fetchData])

  // Update recipe mutation
  const updateRecipe = useCallback(async (
    recipeId: string,
    updates: Partial<Recipe>
  ) => {
    if (isDemo) {
      demoMutations.updateRecipe(recipeId, updates)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('recipes')
        .update(updates)
        .eq('id', recipeId)

      await fetchData()
    } catch (err) {
      console.error('Error updating recipe:', err)
      throw err
    }
  }, [isDemo, supabase, demoMutations, fetchData])

  // Delete recipe mutation
  const deleteRecipe = useCallback(async (recipeId: string) => {
    if (isDemo) {
      demoMutations.deleteRecipe(recipeId)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('recipes')
        .delete()
        .eq('id', recipeId)

      await fetchData()
    } catch (err) {
      console.error('Error deleting recipe:', err)
      throw err
    }
  }, [isDemo, supabase, demoMutations, fetchData])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    return {
      recipes: demoState.recipes,
      loading: false,
      error: null,
      addRecipe,
      updateRecipe,
      deleteRecipe,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state
  const shouldFetch = !!household?.id && !initialFetchDone && !isFetching
  const loading = householdLoading || shouldFetch || isFetching

  return {
    recipes,
    loading,
    error,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    refetch: fetchData,
  }
}
