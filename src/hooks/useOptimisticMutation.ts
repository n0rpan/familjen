'use client'

/**
 * useOptimisticMutation Hook
 *
 * Provides instant UI feedback for mutations by:
 * 1. Immediately updating local state (optimistic update)
 * 2. Syncing to server in background
 * 3. Rolling back on failure
 *
 * This makes the app feel "magic" - instant response while staying in sync.
 */

import { useState, useCallback, useRef } from 'react'

export interface OptimisticMutationOptions<TData, TVariables> {
  /** The actual mutation function that syncs to server */
  mutationFn: (variables: TVariables) => Promise<void>
  /** Update local state optimistically (called immediately) */
  onOptimisticUpdate: (variables: TVariables) => void
  /** Rollback local state on error */
  onRollback: (variables: TVariables, previousData?: TData) => void
  /** Called on successful server sync */
  onSuccess?: (variables: TVariables) => void
  /** Called on error (after rollback) */
  onError?: (error: Error, variables: TVariables) => void
  /** Get current data for rollback (optional) */
  getCurrentData?: () => TData
}

export interface OptimisticMutationResult<TVariables> {
  /** Execute the mutation with optimistic update */
  mutate: (variables: TVariables) => Promise<void>
  /** Whether a mutation is currently in progress */
  isPending: boolean
  /** Last error that occurred */
  error: Error | null
  /** Clear the error state */
  clearError: () => void
}

/**
 * Hook for optimistic mutations with automatic rollback
 *
 * @example
 * ```typescript
 * const { mutate, isPending } = useOptimisticMutation({
 *   mutationFn: async (pickup) => {
 *     await supabase.from('pickups').upsert(pickup)
 *   },
 *   onOptimisticUpdate: (pickup) => {
 *     setPickups(prev => [...prev, pickup])
 *   },
 *   onRollback: (pickup) => {
 *     setPickups(prev => prev.filter(p => p.id !== pickup.id))
 *   },
 *   onError: (error) => {
 *     showToast('Kunne ikke lagre', 'error')
 *   }
 * })
 * ```
 */
export function useOptimisticMutation<TData = unknown, TVariables = unknown>({
  mutationFn,
  onOptimisticUpdate,
  onRollback,
  onSuccess,
  onError,
  getCurrentData,
}: OptimisticMutationOptions<TData, TVariables>): OptimisticMutationResult<TVariables> {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const previousDataRef = useRef<TData | undefined>(undefined)

  const mutate = useCallback(async (variables: TVariables) => {
    // Store previous data for potential rollback
    if (getCurrentData) {
      previousDataRef.current = getCurrentData()
    }

    // Clear any previous error
    setError(null)

    // 1. Optimistic update - instant UI feedback
    onOptimisticUpdate(variables)

    // 2. Sync to server in background
    setIsPending(true)
    try {
      await mutationFn(variables)
      onSuccess?.(variables)
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Mutation failed')
      setError(error)

      // 3. Rollback on failure
      onRollback(variables, previousDataRef.current)
      onError?.(error, variables)
    } finally {
      setIsPending(false)
    }
  }, [mutationFn, onOptimisticUpdate, onRollback, onSuccess, onError, getCurrentData])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    mutate,
    isPending,
    error,
    clearError,
  }
}

/**
 * Generate a temporary ID for optimistic inserts
 * Format: temp-{timestamp}-{random}
 */
export function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Check if an ID is a temporary optimistic ID
 */
export function isTempId(id: string): boolean {
  return id.startsWith('temp-')
}
