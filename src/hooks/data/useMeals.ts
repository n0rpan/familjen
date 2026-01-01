'use client'

/**
 * useMeals Hook
 *
 * Abstracts meal data fetching and mutations for both demo and production modes.
 * Supports week-based filtering for week planner views.
 *
 * PERFORMANCE: Uses optimistic updates for instant UI feedback.
 * When a parent sets a meal, the UI updates immediately while
 * the server sync happens in the background. Rollback on failure.
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - needsFetch: household loaded but fetch for current params not done
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold, useHouseholdId } from './useHousehold'
import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'
import { generateTempId, isTempId } from '@/hooks/useOptimisticMutation'
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
  /** Whether an optimistic update is syncing to server */
  isSyncing: boolean
  /** Update a meal (create, update, or delete) - instant with optimistic update */
  updateMeal: (date: string, recipeId: string | null, customMeal: string | null) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get meals with optional filtering by date range
 */
export function useMeals(options: UseMealsOptions = {}): UseMealsReturn {
  const { startDate, endDate, recipes = [] } = options
  const { isDemo, supabase, demoState, demoMutations } = useDataSource()
  // Use JWT-based household ID for faster access
  const householdId = useHouseholdId()
  const { loading: householdLoading } = useHousehold()

  const [meals, setMeals] = useState<Meal[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastFetchKey, setLastFetchKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Track abort controller for cleanup
  const abortControllerRef = useRef<AbortController | null>(null)
  // Track pending optimistic updates for rollback
  const pendingUpdatesRef = useRef<Map<string, Meal | null>>(new Map())

  const startDateStr = startDate ? formatDateISO(startDate) : null
  const endDateStr = endDate ? formatDateISO(endDate) : null

  // Memoize fetch key to prevent unnecessary re-renders
  const currentFetchKey = useMemo(
    () => `${householdId}-${startDateStr}-${endDateStr}`,
    [householdId, startDateStr, endDateStr]
  )

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !householdId) return

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
        .eq('household_id', householdId)

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
  }, [isDemo, supabase, householdId, startDateStr, endDateStr, currentFetchKey])

  // Debounced refetch for realtime - prevents thundering herd when multiple changes come in
  const realtimeRefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedRefetch = useCallback(() => {
    if (realtimeRefetchTimer.current) {
      clearTimeout(realtimeRefetchTimer.current)
    }
    realtimeRefetchTimer.current = setTimeout(() => {
      fetchData()
    }, 300) // 300ms debounce for realtime changes
  }, [fetchData])

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (realtimeRefetchTimer.current) {
        clearTimeout(realtimeRefetchTimer.current)
      }
    }
  }, [])

  // Subscribe to realtime changes for instant sync between parents
  useRealtimeSubscription<Meal>({
    table: 'meals',
    filter: householdId ? createHouseholdFilter(householdId) : undefined,
    enabled: !isDemo && !!householdId,
    onAny: debouncedRefetch,
  })

  // Fetch when household or date range changes
  useEffect(() => {
    if (!isDemo && householdId && lastFetchKey !== currentFetchKey) {
      fetchData()
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [isDemo, householdId, lastFetchKey, currentFetchKey, fetchData])

  // Update meal mutation with OPTIMISTIC UPDATE
  // UI updates instantly, server sync happens in background
  const updateMeal = useCallback(async (
    date: string,
    recipeId: string | null,
    customMeal: string | null
  ) => {
    if (isDemo) {
      demoMutations.updateMeal(date, recipeId, customMeal)
      return
    }

    if (!supabase || !householdId) return

    const existingMeal = meals.find(m => m.date === date)

    // 1. OPTIMISTIC UPDATE - instant UI feedback
    if (recipeId || customMeal) {
      if (existingMeal) {
        // Update existing meal optimistically
        pendingUpdatesRef.current.set(date, existingMeal)
        setMeals(prev => prev.map(m =>
          m.date === date
            ? { ...m, recipe_id: recipeId, custom_meal: customMeal }
            : m
        ))
      } else {
        // Insert new meal optimistically with temp ID
        pendingUpdatesRef.current.set(date, null) // null = was insert
        const tempMeal: Meal = {
          id: generateTempId(),
          household_id: householdId,
          date,
          recipe_id: recipeId,
          custom_meal: customMeal,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        setMeals(prev => [...prev, tempMeal])
      }
    } else {
      // Delete optimistically
      if (existingMeal) {
        pendingUpdatesRef.current.set(date, existingMeal)
        setMeals(prev => prev.filter(m => m.date !== date))
      }
    }

    // 2. SYNC TO SERVER in background
    setIsSyncing(true)
    try {
      if (existingMeal && !isTempId(existingMeal.id)) {
        if (recipeId || customMeal) {
          // Update
          const { error } = await supabase
            .from('meals')
            .update({
              recipe_id: recipeId,
              custom_meal: customMeal,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingMeal.id)
          if (error) throw error
        } else {
          // Delete
          const { error } = await supabase
            .from('meals')
            .delete()
            .eq('id', existingMeal.id)
          if (error) throw error
        }
      } else if (recipeId || customMeal) {
        // Insert
        const { data, error } = await supabase
          .from('meals')
          .insert({
            household_id: householdId,
            date,
            recipe_id: recipeId,
            custom_meal: customMeal,
          })
          .select()
          .single()
        if (error) throw error

        // Replace temp ID with real ID
        if (data) {
          setMeals(prev => prev.map(m =>
            m.date === date && isTempId(m.id)
              ? { ...m, id: data.id }
              : m
          ))
        }
      }

      // Success - clear pending update
      pendingUpdatesRef.current.delete(date)
    } catch (err) {
      console.error('Error updating meal:', err)

      // 3. ROLLBACK on failure
      const originalMeal = pendingUpdatesRef.current.get(date)
      if (originalMeal === null) {
        // Was an insert - remove the optimistic entry
        setMeals(prev => prev.filter(m => !(m.date === date && isTempId(m.id))))
      } else if (originalMeal) {
        // Was an update or delete - restore original
        setMeals(prev => {
          const withoutCurrent = prev.filter(m => m.date !== date)
          return [...withoutCurrent, originalMeal]
        })
      }
      pendingUpdatesRef.current.delete(date)

      setError(err instanceof Error ? err.message : 'Kunne ikke lagre')
      throw err
    } finally {
      setIsSyncing(false)
    }
  }, [isDemo, supabase, householdId, demoMutations, meals])

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
      isSyncing: false,
      updateMeal,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state
  const needsFetch = !!householdId && lastFetchKey !== currentFetchKey && !isFetching
  const loading = householdLoading || needsFetch || isFetching

  return {
    meals: mealsWithRecipes,
    loading,
    error,
    isSyncing,
    updateMeal,
    refetch: fetchData,
  }
}
