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
 *
 * Offline support:
 * - Mutations queue to IndexedDB when offline via queueChange()
 * - useBackgroundSync processes queue when back online
 * - This hook refetches 2s after online event to sync temp items with server data
 * - Optimistic updates show immediately with temp IDs (temp-{timestamp})
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'
import { formatDateISO } from '@/lib/utils'
import { createChildTaskSchema } from '@/lib/schemas'
import { queueChange, updateQueuedInsert, removeQueuedInsert } from '@/lib/offline-queue'
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

  // Ref to track current tasks for offline conflict detection (avoids re-renders)
  const tasksRef = useRef<ChildTask[]>(tasks)
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])
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
  useRealtimeSubscription<ChildTask>({
    table: 'child_tasks',
    filter: household?.id ? createHouseholdFilter(household.id) : undefined,
    enabled: !isDemo && !!household?.id,
    onAny: debouncedRefetch,
  })

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

  // Refetch when coming back online (syncs temp items with server data)
  useEffect(() => {
    if (isDemo || typeof window === 'undefined') return

    const handleOnline = () => {
      // Small delay to let useBackgroundSync process queue first
      setTimeout(() => {
        if (household?.id) fetchData()
      }, 2000)
    }

    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [isDemo, household?.id, fetchData])

  // Add task mutation
  const addTask = useCallback(async (
    task: Omit<ChildTask, 'id' | 'created_at' | 'updated_at'>
  ) => {
    // Validate task data (excluding household_id which is added separately)
    const validation = createChildTaskSchema.safeParse({
      child_id: task.child_id,
      date: task.date,
      time: task.time,
      task_type: task.task_type,
      title: task.title,
      notes: task.notes,
      source: task.source,
      recurrence_pattern: task.recurrence_pattern,
    })
    if (!validation.success) {
      const errors = validation.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      throw new Error(errors)
    }

    if (isDemo) {
      demoMutations.addTask(task)
      return
    }

    if (!supabase) return

    // If offline, queue the change for later sync
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Generate temp ID first so we can store it in the queue for later matching
      const tempId = `temp-${Date.now()}`
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { ...task, _tempId: tempId } as Record<string, unknown>,
      })
      // Optimistically add to local state with temporary ID
      const tempTask: ChildTask = {
        ...task,
        id: tempId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as ChildTask
      setTasks(prev => [...prev, tempTask])
      return
    }

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
    // Validate update data (only validates fields that are being updated)
    const fieldsToValidate: Record<string, unknown> = {}
    if (updates.date !== undefined) fieldsToValidate.date = updates.date
    if (updates.time !== undefined) fieldsToValidate.time = updates.time
    if (updates.task_type !== undefined) fieldsToValidate.task_type = updates.task_type
    if (updates.title !== undefined) fieldsToValidate.title = updates.title
    if (updates.notes !== undefined) fieldsToValidate.notes = updates.notes

    if (Object.keys(fieldsToValidate).length > 0) {
      // Use partial schema validation
      const validation = createChildTaskSchema.partial().safeParse(fieldsToValidate)
      if (!validation.success) {
        const errors = validation.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
        throw new Error(errors)
      }
    }

    if (isDemo) {
      demoMutations.updateTask(taskId, updates)
      return
    }

    if (!supabase) return

    // If offline, queue the change for later sync
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (taskId.startsWith('temp-')) {
        // For temp items, update the queued insert's data directly
        await updateQueuedInsert('child_tasks', '_tempId', taskId, updates)
      } else {
        // For real items, queue a separate update operation
        // Include original updated_at for conflict detection during sync
        // Use ref to avoid re-renders from tasks dependency
        const existingTask = tasksRef.current.find(t => t.id === taskId)
        await queueChange({
          table: 'child_tasks',
          operation: 'update',
          data: { id: taskId, ...updates } as Record<string, unknown>,
          originalUpdatedAt: existingTask?.updated_at ?? undefined,
        })
      }
      // Optimistically update local state
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))
      return
    }

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

    // If offline, queue the change for later sync
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (taskId.startsWith('temp-')) {
        // For temp items, remove the queued insert entirely
        await removeQueuedInsert('child_tasks', '_tempId', taskId)
      } else {
        // For real items, queue a delete operation
        await queueChange({
          table: 'child_tasks',
          operation: 'delete',
          data: { id: taskId },
        })
      }
      // Optimistically remove from local state
      setTasks(prev => prev.filter(t => t.id !== taskId))
      return
    }

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

  // Demo mode initializing: show loading
  if (isDemo && !demoState) {
    return {
      tasks: [],
      loading: true,
      error: null,
      addTask,
      updateTask,
      deleteTask,
      refetch: () => {},
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
