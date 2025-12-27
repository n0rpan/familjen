'use client'

/**
 * Demo Mode Context
 *
 * Provides demo state and mutations to the entire app.
 * Detects ?demo=true from URL and initializes/loads demo data.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { DemoState, DemoDataContextValue } from './types'
import type { ChildTask, Recipe, ShoppingListItem } from '@/lib/types'
import { loadDemoState, saveDemoState, clearDemoState } from './storage'
import { generateDemoState } from './generator'
import { validateDemoData, getValidationSummary } from './validation'

// Default context value (non-demo mode)
const defaultContextValue: DemoDataContextValue = {
  isDemo: false,
  demoState: null,
  updatePickup: () => {},
  updateMeal: () => {},
  addTask: () => {},
  updateTask: () => {},
  deleteTask: () => {},
  addRecipe: () => {},
  updateRecipe: () => {},
  deleteRecipe: () => {},
  addShoppingItem: () => {},
  updateShoppingItem: () => {},
  deleteShoppingItem: () => {},
  exitDemo: () => {},
}

const DemoDataContext = createContext<DemoDataContextValue>(defaultContextValue)

/**
 * Hook to access demo mode state and mutations
 */
export function useDemo(): DemoDataContextValue {
  return useContext(DemoDataContext)
}

/**
 * Hook to check if we're in demo mode
 */
export function useIsDemo(): boolean {
  const { isDemo } = useContext(DemoDataContext)
  return isDemo
}

interface DemoDataProviderProps {
  children: ReactNode
}

/**
 * Demo Data Provider
 *
 * Wraps the app and provides demo state when ?demo=true is in URL.
 * Handles state initialization, persistence, and mutations.
 */
export function DemoDataProvider({ children }: DemoDataProviderProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const isDemo = searchParams.get('demo') === 'true'

  const [demoState, setDemoState] = useState<DemoState | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)

  // Initialize demo state
  useEffect(() => {
    if (!isDemo) {
      setDemoState(null)
      setIsInitialized(true)
      return
    }

    // Try to load existing state, or generate new
    const existing = loadDemoState()
    let state: DemoState
    if (existing) {
      state = existing
    } else {
      state = generateDemoState()
      saveDemoState(state)
    }

    // Validate demo data in development
    if (process.env.NODE_ENV === 'development') {
      const validation = validateDemoData(state)
      if (!validation.valid) {
        console.error('❌ Demo data validation failed:')
        validation.errors.forEach(e => console.error(`  - ${e.field}: ${e.message}`))
        console.error('\nFix by updating src/lib/demo/generator.ts')
      } else if (validation.warnings.length > 0) {
        console.warn('⚠️ Demo data warnings:')
        validation.warnings.forEach(w => console.warn(`  - ${w.field}: ${w.message}`))
      }
    }

    setDemoState(state)
    setIsInitialized(true)
  }, [isDemo])

  // Mutation: Update pickup
  const updatePickup = useCallback((
    childId: string,
    date: string,
    pickerId: string | null,
    _time?: string | null
  ) => {
    setDemoState(prev => {
      if (!prev) return prev

      const existingIdx = prev.pickups.findIndex(
        p => p.child_id === childId && p.date === date
      )

      let newPickups = [...prev.pickups]

      if (existingIdx >= 0) {
        if (pickerId) {
          // Update existing
          newPickups[existingIdx] = {
            ...newPickups[existingIdx],
            picker_id: pickerId,
          }
        } else {
          // Delete
          newPickups = newPickups.filter((_, i) => i !== existingIdx)
        }
      } else if (pickerId) {
        // Insert new
        newPickups.push({
          id: `demo-pickup-${date}-${childId}-${Date.now()}`,
          household_id: prev.household.id,
          child_id: childId,
          date,
          picker_id: pickerId,
          notes: null,
          synced_to_calendar: false,
          calendar_event_id: null,
          sync_to_work_calendar: false,
          work_calendar_event_id: null,
          created_at: new Date().toISOString(),
        })
      }

      const newState = { ...prev, pickups: newPickups }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Mutation: Update meal
  const updateMeal = useCallback((
    date: string,
    recipeId: string | null,
    customMeal: string | null
  ) => {
    setDemoState(prev => {
      if (!prev) return prev

      const existingIdx = prev.meals.findIndex(m => m.date === date)

      let newMeals = [...prev.meals]

      if (existingIdx >= 0) {
        if (recipeId || customMeal) {
          newMeals[existingIdx] = {
            ...newMeals[existingIdx],
            recipe_id: recipeId,
            custom_meal: customMeal,
          }
        } else {
          newMeals = newMeals.filter((_, i) => i !== existingIdx)
        }
      } else if (recipeId || customMeal) {
        newMeals.push({
          id: `demo-meal-${date}-${Date.now()}`,
          household_id: prev.household.id,
          date,
          recipe_id: recipeId,
          custom_meal: customMeal,
          notes: null,
          created_at: new Date().toISOString(),
        })
      }

      const newState = { ...prev, meals: newMeals }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Mutation: Add task
  const addTask = useCallback((task: Omit<ChildTask, 'id' | 'created_at' | 'updated_at'>) => {
    setDemoState(prev => {
      if (!prev) return prev

      const newTask: ChildTask = {
        ...task,
        id: `demo-task-${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: null,
      }

      const newState = { ...prev, childTasks: [...prev.childTasks, newTask] }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Mutation: Update task
  const updateTask = useCallback((taskId: string, updates: Partial<ChildTask>) => {
    setDemoState(prev => {
      if (!prev) return prev

      const newTasks = prev.childTasks.map(t =>
        t.id === taskId ? { ...t, ...updates } : t
      )

      const newState = { ...prev, childTasks: newTasks }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Mutation: Delete task
  const deleteTask = useCallback((taskId: string) => {
    setDemoState(prev => {
      if (!prev) return prev

      const newTasks = prev.childTasks.filter(t => t.id !== taskId)
      const newState = { ...prev, childTasks: newTasks }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Mutation: Add recipe
  const addRecipe = useCallback((recipe: Omit<Recipe, 'id' | 'created_at' | 'updated_at'>) => {
    setDemoState(prev => {
      if (!prev) return prev

      const newRecipe: Recipe = {
        ...recipe,
        id: `demo-recipe-${Date.now()}`,
        created_at: new Date().toISOString(),
      }

      const newState = { ...prev, recipes: [...prev.recipes, newRecipe] }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Mutation: Update recipe
  const updateRecipe = useCallback((recipeId: string, updates: Partial<Recipe>) => {
    setDemoState(prev => {
      if (!prev) return prev

      const newRecipes = prev.recipes.map(r =>
        r.id === recipeId ? { ...r, ...updates } : r
      )

      const newState = { ...prev, recipes: newRecipes }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Mutation: Delete recipe
  const deleteRecipe = useCallback((recipeId: string) => {
    setDemoState(prev => {
      if (!prev) return prev

      const newRecipes = prev.recipes.filter(r => r.id !== recipeId)
      const newState = { ...prev, recipes: newRecipes }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Mutation: Add shopping item
  const addShoppingItem = useCallback((listId: string, item: Omit<ShoppingListItem, 'id' | 'created_at' | 'updated_at'>) => {
    setDemoState(prev => {
      if (!prev) return prev

      const newItem: ShoppingListItem = {
        ...item,
        id: `demo-shopping-item-${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const newLists = prev.shoppingLists.map(list =>
        list.id === listId
          ? { ...list, items: [...list.items, newItem] }
          : list
      )

      const newState = { ...prev, shoppingLists: newLists }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Mutation: Update shopping item
  const updateShoppingItem = useCallback((itemId: string, updates: Partial<ShoppingListItem>) => {
    setDemoState(prev => {
      if (!prev) return prev

      const newLists = prev.shoppingLists.map(list => ({
        ...list,
        items: list.items.map(item =>
          item.id === itemId ? { ...item, ...updates } : item
        ),
      }))

      const newState = { ...prev, shoppingLists: newLists }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Mutation: Delete shopping item
  const deleteShoppingItem = useCallback((itemId: string) => {
    setDemoState(prev => {
      if (!prev) return prev

      const newLists = prev.shoppingLists.map(list => ({
        ...list,
        items: list.items.filter(item => item.id !== itemId),
      }))

      const newState = { ...prev, shoppingLists: newLists }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Exit demo mode
  const exitDemo = useCallback(() => {
    clearDemoState()
    router.push('/login')
  }, [router])

  // Memoize context value
  const contextValue = useMemo<DemoDataContextValue>(() => ({
    isDemo,
    demoState,
    updatePickup,
    updateMeal,
    addTask,
    updateTask,
    deleteTask,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    addShoppingItem,
    updateShoppingItem,
    deleteShoppingItem,
    exitDemo,
  }), [
    isDemo,
    demoState,
    updatePickup,
    updateMeal,
    addTask,
    updateTask,
    deleteTask,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    addShoppingItem,
    updateShoppingItem,
    deleteShoppingItem,
    exitDemo,
  ])

  // Don't render children until initialized to avoid hydration mismatch
  if (!isInitialized) {
    return null
  }

  return (
    <DemoDataContext.Provider value={contextValue}>
      {children}
    </DemoDataContext.Provider>
  )
}
