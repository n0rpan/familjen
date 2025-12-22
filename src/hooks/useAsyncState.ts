'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  message: string | null
}

interface UseAsyncStateOptions {
  /** Auto-clear message after this many ms (default: 3000, 0 to disable) */
  messageDuration?: number
  /** Auto-clear error after this many ms (default: 5000, 0 to disable) */
  errorDuration?: number
}

interface UseAsyncStateReturn<T> extends AsyncState<T> {
  /** Execute an async operation with automatic state management */
  execute: <R = T>(
    fn: () => Promise<R>,
    options?: {
      /** Success message to show */
      successMessage?: string
      /** Transform result before setting data */
      transform?: (result: R) => T
    }
  ) => Promise<R | null>
  /** Set data directly */
  setData: (data: T | null) => void
  /** Set loading state */
  setLoading: (loading: boolean) => void
  /** Set error message */
  setError: (error: string | null) => void
  /** Set success message */
  setMessage: (message: string | null) => void
  /** Clear all state */
  reset: () => void
  /** Check if any operation is pending */
  isPending: boolean
}

/**
 * Hook for managing async operation state with loading, error, and success messages.
 *
 * Usage:
 * ```tsx
 * const { data, loading, error, message, execute } = useAsyncState<User[]>()
 *
 * const loadUsers = async () => {
 *   await execute(
 *     () => fetchUsers(),
 *     { successMessage: 'Users loaded!' }
 *   )
 * }
 * ```
 */
export function useAsyncState<T = unknown>(
  options: UseAsyncStateOptions = {}
): UseAsyncStateReturn<T> {
  const { messageDuration = 3000, errorDuration = 5000 } = options

  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: false,
    error: null,
    message: null,
  })

  // Track pending operations for cleanup
  const pendingRef = useRef(0)
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current)
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [])

  const setData = useCallback((data: T | null) => {
    if (mountedRef.current) {
      setState(prev => ({ ...prev, data }))
    }
  }, [])

  const setLoading = useCallback((loading: boolean) => {
    if (mountedRef.current) {
      setState(prev => ({ ...prev, loading }))
    }
  }, [])

  const setError = useCallback((error: string | null) => {
    if (!mountedRef.current) return

    // Clear any existing error timer
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current)
      errorTimerRef.current = null
    }

    setState(prev => ({ ...prev, error, message: null }))

    // Auto-clear error after duration
    if (error && errorDuration > 0) {
      errorTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setState(prev => ({ ...prev, error: null }))
        }
      }, errorDuration)
    }
  }, [errorDuration])

  const setMessage = useCallback((message: string | null) => {
    if (!mountedRef.current) return

    // Clear any existing message timer
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current)
      messageTimerRef.current = null
    }

    setState(prev => ({ ...prev, message, error: null }))

    // Auto-clear message after duration
    if (message && messageDuration > 0) {
      messageTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setState(prev => ({ ...prev, message: null }))
        }
      }, messageDuration)
    }
  }, [messageDuration])

  const reset = useCallback(() => {
    if (mountedRef.current) {
      setState({ data: null, loading: false, error: null, message: null })
    }
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
  }, [])

  const execute = useCallback(async <R = T>(
    fn: () => Promise<R>,
    executeOptions?: {
      successMessage?: string
      transform?: (result: R) => T
    }
  ): Promise<R | null> => {
    if (!mountedRef.current) return null

    pendingRef.current++
    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const result = await fn()

      if (!mountedRef.current) return null

      // Transform and set data
      const data = executeOptions?.transform
        ? executeOptions.transform(result)
        : (result as unknown as T)

      setState(prev => ({
        ...prev,
        data,
        loading: false,
        error: null,
      }))

      // Set success message if provided
      if (executeOptions?.successMessage) {
        setMessage(executeOptions.successMessage)
      }

      return result
    } catch (err) {
      if (!mountedRef.current) return null

      const errorMessage = err instanceof Error ? err.message : 'An error occurred'
      setError(errorMessage)
      setState(prev => ({ ...prev, loading: false }))

      return null
    } finally {
      pendingRef.current--
    }
  }, [setError, setMessage])

  return {
    ...state,
    execute,
    setData,
    setLoading,
    setError,
    setMessage,
    reset,
    isPending: pendingRef.current > 0,
  }
}
