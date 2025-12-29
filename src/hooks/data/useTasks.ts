'use client'

/**
 * useTasks Hook
 *
 * Abstracts child tasks data fetching and mutations for both demo and production modes.
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
import type { ChildTask, ChildTaskWithChild, Child } from '@/lib/types'

export interface UseTasksOptions {
  /** Start date for filtering (inclusive) */
  startDate?: Date
  /** End date for filtering (inclusive) */
  endDate?: Date
  /** Children data for hydrating tasks (required for ChildTaskWithChild) */
  children?: Child[]
}

export interface UseTasksReturn {
  tasks: ChildTaskWithChild[]
  loading: boolean
  error: string | null
  addTask: (task: Omit<ChildTask, 'id' | 'created_at' | 'updated_at'>) => Promise<void>
  updateTask: (taskId: string, updates: Partial<ChildTask>) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get child tasks with optional filtering by date range
 */
export function useTasks(options: UseTasksOptions = {}): UseTasksReturn {
  const { startDate, endDate, children = [] } = options
  const { isDemo, supabase, demoState, demoMutations } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [tasks, setTasks] = useState<ChildTask[]>([])
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
        .from('child_tasks')
        .select('*')
        .eq('household_id', household.id)

      if (startDateStr) {
        query = query.gte('date', startDateStr)
      }
      if (endDateStr) {
        query = query.lte('date', endDateStr)
      }

      query = query.order('date', { ascending: true }).order('time', { ascending: true })

      const { data, error: fetchError } = await query

      // Check if request was aborted
      if (signal.aborted) return

      if (fetchError) throw fetchError

      setTasks(data || [])
      setLastFetchKey(currentFetchKey)
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return

      console.error('Error fetching tasks:', err)
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
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

  // Add task mutation
  const addTask = useCallback(async (
    task: Omit<ChildTask, 'id' | 'created_at' | 'updated_at'>
  ) => {
    if (isDemo) {
      demoMutations.addTask(task)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('child_tasks')
        .insert(task)

      await fetchData()
    } catch (err) {
      console.error('Error adding task:', err)
      throw err
    }
  }, [isDemo, supabase, demoMutations, fetchData])

  // Update task mutation
  const updateTask = useCallback(async (
    taskId: string,
    updates: Partial<ChildTask>
  ) => {
    if (isDemo) {
      demoMutations.updateTask(taskId, updates)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('child_tasks')
        .update(updates)
        .eq('id', taskId)

      await fetchData()
    } catch (err) {
      console.error('Error updating task:', err)
      throw err
    }
  }, [isDemo, supabase, demoMutations, fetchData])

  // Delete task mutation
  const deleteTask = useCallback(async (taskId: string) => {
    if (isDemo) {
      demoMutations.deleteTask(taskId)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('child_tasks')
        .delete()
        .eq('id', taskId)

      await fetchData()
    } catch (err) {
      console.error('Error deleting task:', err)
      throw err
    }
  }, [isDemo, supabase, demoMutations, fetchData])

  // Hydrate tasks with child details
  const tasksWithChildren = useMemo((): ChildTaskWithChild[] => {
    const sourceTasks = isDemo && demoState
      ? demoState.childTasks.filter(t => {
          if (startDateStr && t.date < startDateStr) return false
          if (endDateStr && t.date > endDateStr) return false
          return true
        })
      : tasks

    const sourceChildren = isDemo && demoState ? demoState.children : children

    return sourceTasks.map(t => ({
      ...t,
      child: sourceChildren.find(c => c.id === t.child_id)!,
    })).filter(t => t.child) // Filter out tasks with missing child
  }, [isDemo, demoState, tasks, children, startDateStr, endDateStr])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    return {
      tasks: tasksWithChildren,
      loading: false,
      error: null,
      addTask,
      updateTask,
      deleteTask,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state
  const needsFetch = !!household?.id && lastFetchKey !== currentFetchKey && !isFetching
  const loading = householdLoading || needsFetch || isFetching

  return {
    tasks: tasksWithChildren,
    loading,
    error,
    addTask,
    updateTask,
    deleteTask,
    refetch: fetchData,
  }
}
