'use client'

/**
 * useMeals Hook
 *
 * Abstracts meal data fetching and mutations for both demo and production modes.
 * Supports week-based filtering for week planner views.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
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
  const { household } = useHousehold()

  const [meals, setMeals] = useState<Meal[]>([])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const startDateStr = startDate ? formatDateISO(startDate) : null
  const endDateStr = endDate ? formatDateISO(endDate) : null

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setLoading(true)
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

      if (fetchError) throw fetchError

      setMeals(data || [])
    } catch (err) {
      console.error('Error fetching meals:', err)
      setError(err instanceof Error ? err.message : 'Failed to load meals')
    } finally {
      setLoading(false)
    }
  }, [isDemo, supabase, household?.id, startDateStr, endDateStr])

  // Initial fetch for production mode
  useEffect(() => {
    if (!isDemo && household?.id) {
      fetchData()
    }
  }, [isDemo, household?.id, fetchData])

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

  return {
    meals: mealsWithRecipes,
    loading,
    error,
    updateMeal,
    refetch: fetchData,
  }
}
