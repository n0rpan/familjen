'use client'

/**
 * useMeals Hook
 *
 * Abstracts meal data fetching and mutations for both demo and production modes.
 * Supports week-based filtering for week planner views.
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - needsFetch: household loaded but fetch for current params not done
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { formatDateISO } from '@/lib/utils'
import type { Meal, MealWithRecipe, Recipe } from '@/lib/types'

export interface UseMealsOptions {
  /** Start date for filtering (inclusive) */
  startDate?: Date
  /** End date for filtering (inclusive) */
  endDate?: Date
  /** Recipes data for hydrating meals (required for MealWithRecipe) */
  recipes?: Recipe[]
}

export interface UseMealsReturn {
  meals: MealWithRecipe[]
  loading: boolean
  error: string | null
  /** Update a meal (create, update, or delete) */
  updateMeal: (date: string, recipeId: string | null, customMeal: string | null) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get meals with optional filtering by date range
 */
export function useMeals(options: UseMealsOptions = {}): UseMealsReturn {
  const { startDate, endDate, recipes = [] } = options
  const { isDemo, supabase, demoState, demoMutations } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [meals, setMeals] = useState<Meal[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [lastFetchKey, setLastFetchKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Track abort controller for cleanup
  const abortControllerRef = useRef<AbortController | null>(null)

  const startDateStr = startDate ? formatDateISO(startDate) : null
  const endDateStr = endDate ? formatDateISO(endDate) : null

  // Memoize fetch key to prevent unnecessary re-renders
  const currentFetchKey = useMemo(
    () => `${household?.id}-${startDateStr}-${endDateStr}`,
    [household?.id, startDateStr, endDateStr]
  )

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    // Abort any pending request
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const { signal } = abortControllerRef.current

    setIsFetching(true)
    setError(null)

    try {
      let query = supabase
        .from('meals')
        .select('*, recipe:recipes(*)')
        .eq('household_id', household.id)

      if (startDateStr) {
        query = query.gte('date', startDateStr)
      }
      if (endDateStr) {
        query = query.lte('date', endDateStr)
      }

      query = query.order('date', { ascending: true })

      const { data, error: fetchError } = await query

      // Check if request was aborted
      if (signal.aborted) return

      if (fetchError) throw fetchError

      setMeals(data || [])
      setLastFetchKey(currentFetchKey)
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return

      console.error('Error fetching meals:', err)
      setError(err instanceof Error ? err.message : 'Failed to load meals')
      setLastFetchKey(currentFetchKey) // Mark as fetched even on error
    } finally {
      // Only update if not aborted
      if (!abortControllerRef.current?.signal.aborted) {
        setIsFetching(false)
      }
    }
  }, [isDemo, supabase, household?.id, startDateStr, endDateStr, currentFetchKey])

  // Fetch when household or date range changes
  useEffect(() => {
    if (!isDemo && household?.id && lastFetchKey !== currentFetchKey) {
      fetchData()
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [isDemo, household?.id, lastFetchKey, currentFetchKey, fetchData])

  // Update meal mutation
  const updateMeal = useCallback(async (
    date: string,
    recipeId: string | null,
    customMeal: string | null
  ) => {
    if (isDemo) {
      demoMutations.updateMeal(date, recipeId, customMeal)
      return
    }

    if (!supabase || !household?.id) return

    try {
      // Check if meal exists for this date
      const { data: existing } = await supabase
        .from('meals')
        .select('id')
        .eq('household_id', household.id)
        .eq('date', date)
        .single()

      if (existing) {
        if (recipeId || customMeal) {
          // Update
          await supabase
            .from('meals')
            .update({
              recipe_id: recipeId,
              custom_meal: customMeal,
            })
            .eq('id', existing.id)
        } else {
          // Delete
          await supabase
            .from('meals')
            .delete()
            .eq('id', existing.id)
        }
      } else if (recipeId || customMeal) {
        // Insert
        await supabase
          .from('meals')
          .insert({
            household_id: household.id,
            date,
            recipe_id: recipeId,
            custom_meal: customMeal,
          })
      }

      // Refetch
      await fetchData()
    } catch (err) {
      console.error('Error updating meal:', err)
      throw err
    }
  }, [isDemo, supabase, household?.id, demoMutations, fetchData])

  // Hydrate meals with recipe details
  const mealsWithRecipes = useMemo((): MealWithRecipe[] => {
    const sourceMeals = isDemo && demoState
      ? demoState.meals.filter(m => {
          if (startDateStr && m.date < startDateStr) return false
          if (endDateStr && m.date > endDateStr) return false
          return true
        })
      : meals

    const sourceRecipes = isDemo && demoState ? demoState.recipes : recipes

    // If meals already have recipe data (from Supabase join), use that
    // Otherwise, hydrate from recipes array
    return sourceMeals.map(m => {
      if ('recipe' in m) {
        return m as MealWithRecipe
      }
      return {
        ...m,
        recipe: m.recipe_id ? sourceRecipes.find(r => r.id === m.recipe_id) || null : null,
      }
    })
  }, [isDemo, demoState, meals, recipes, startDateStr, endDateStr])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    return {
      meals: mealsWithRecipes,
      loading: false,
      error: null,
      updateMeal,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state
  const needsFetch = !!household?.id && lastFetchKey !== currentFetchKey && !isFetching
  const loading = householdLoading || needsFetch || isFetching

  return {
    meals: mealsWithRecipes,
    loading,
    error,
    updateMeal,
    refetch: fetchData,
  }
}
