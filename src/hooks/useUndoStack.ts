'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

export interface UndoableAction<T> {
  id: string
  data: T
  description: string
  timestamp: number
  /** Set to true if commit failed and needs retry */
  failed?: boolean
  /** Number of retry attempts */
  retryCount?: number
}

interface UseUndoStackOptions<T> {
  /** Time in ms before undo expires (default: 5000) */
  expireMs?: number
  /** Callback when action is committed (no longer undoable). Return false to indicate failure. */
  onCommit?: (action: UndoableAction<T>) => Promise<boolean> | boolean
  /** Maximum stack size (default: 10) */
  maxSize?: number
  /** Maximum retry attempts for failed commits (default: 3) */
  maxRetries?: number
  /** Delay between retries in ms (default: 2000) */
  retryDelayMs?: number
}

export function useUndoStack<T = unknown>(options: UseUndoStackOptions<T> = {}) {
  const { expireMs = 5000, onCommit, maxSize = 10, maxRetries = 3, retryDelayMs = 2000 } = options
  const [stack, setStack] = useState<UndoableAction<T>[]>([])
  const [failedActions, setFailedActions] = useState<UndoableAction<T>[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Track if component is unmounted to prevent state updates after unmount
  const isMountedRef = useRef(true)

  // Clean up timers on unmount
  useEffect(() => {
    isMountedRef.current = true
    const timers = timersRef.current
    return () => {
      isMountedRef.current = false
      timers.forEach(timer => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  // Push a new undoable action
  const push = useCallback((action: Omit<UndoableAction<T>, 'timestamp'>) => {
    const fullAction: UndoableAction<T> = {
      ...action,
      timestamp: Date.now(),
    }

    setStack(prev => {
      // Remove oldest if at max size
      const newStack = prev.length >= maxSize ? prev.slice(1) : prev
      return [...newStack, fullAction]
    })

    // Set timer to auto-commit (make non-undoable) after expiry
    const timer = setTimeout(async () => {
      // Check if still mounted before updating state
      if (!isMountedRef.current) return

      let actionToCommit: UndoableAction<T> | undefined

      setStack(prev => {
        actionToCommit = prev.find(a => a.id === fullAction.id)
        return prev.filter(a => a.id !== fullAction.id)
      })

      timersRef.current.delete(fullAction.id)

      if (actionToCommit && onCommit) {
        try {
          const success = await onCommit(actionToCommit)
          if (success === false && isMountedRef.current) {
            // Commit failed, add to failed actions for retry
            setFailedActions(prev => [...prev, { ...actionToCommit!, failed: true, retryCount: 1 }])
          }
        } catch {
          // Commit threw an error, add to failed actions
          if (isMountedRef.current) {
            setFailedActions(prev => [...prev, { ...actionToCommit!, failed: true, retryCount: 1 }])
          }
        }
      }
    }, expireMs)

    timersRef.current.set(fullAction.id, timer)
  }, [expireMs, maxSize, onCommit])

  // Undo an action (remove from stack and return it)
  const undo = useCallback((actionId: string): UndoableAction<T> | undefined => {
    let undoneAction: UndoableAction<T> | undefined

    setStack(prev => {
      undoneAction = prev.find(a => a.id === actionId)
      return prev.filter(a => a.id !== actionId)
    })

    // Clear the timer for this action
    const timer = timersRef.current.get(actionId)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(actionId)
    }

    return undoneAction
  }, [])

  // Get the most recent undoable action
  const peek = useCallback((): UndoableAction<T> | undefined => {
    return stack[stack.length - 1]
  }, [stack])

  // Clear all pending actions (commit immediately)
  const clear = useCallback(() => {
    stack.forEach(action => {
      if (onCommit) {
        onCommit(action)
      }
    })
    setStack([])
    timersRef.current.forEach(timer => clearTimeout(timer))
    timersRef.current.clear()
  }, [stack, onCommit])

  // Calculate remaining time for an action
  const getRemainingTime = useCallback((actionId: string): number => {
    const action = stack.find(a => a.id === actionId)
    if (!action) return 0
    const elapsed = Date.now() - action.timestamp
    return Math.max(0, expireMs - elapsed)
  }, [stack, expireMs])

  // Retry a failed action
  const retry = useCallback(async (actionId: string): Promise<boolean> => {
    if (!isMountedRef.current) return false

    const action = failedActions.find(a => a.id === actionId)
    if (!action || !onCommit) return false

    try {
      const success = await onCommit(action)
      if (success !== false) {
        // Success - remove from failed actions
        if (isMountedRef.current) {
          setFailedActions(prev => prev.filter(a => a.id !== actionId))
        }
        return true
      }
    } catch {
      // Still failing
    }

    if (!isMountedRef.current) return false

    // Update retry count
    const newRetryCount = (action.retryCount || 1) + 1
    if (newRetryCount > maxRetries) {
      // Give up after max retries, remove from list
      setFailedActions(prev => prev.filter(a => a.id !== actionId))
      return false
    }

    setFailedActions(prev =>
      prev.map(a => a.id === actionId ? { ...a, retryCount: newRetryCount } : a)
    )

    // Schedule another retry - track in timersRef for proper cleanup
    const retryTimerKey = `retry-scheduled-${actionId}`
    const existingTimer = timersRef.current.get(retryTimerKey)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }
    const timer = setTimeout(() => {
      timersRef.current.delete(retryTimerKey)
      retry(actionId)
    }, retryDelayMs)
    timersRef.current.set(retryTimerKey, timer)

    return false
  }, [failedActions, onCommit, maxRetries, retryDelayMs])

  // Dismiss a failed action (give up on retry)
  const dismissFailed = useCallback((actionId: string) => {
    setFailedActions(prev => prev.filter(a => a.id !== actionId))
  }, [])

  // Auto-retry failed actions
  useEffect(() => {
    // Capture ref at effect setup time
    const timers = timersRef.current
    // Track timers created in this effect for cleanup
    const effectTimers: string[] = []

    failedActions.forEach(action => {
      const timerKey = `retry-${action.id}`
      if (!timers.has(timerKey)) {
        const timer = setTimeout(() => {
          timers.delete(timerKey)
          if (isMountedRef.current) {
            retry(action.id)
          }
        }, retryDelayMs)
        timers.set(timerKey, timer)
        effectTimers.push(timerKey)
      }
    })

    // Cleanup: clear timers created in this effect when dependencies change
    return () => {
      effectTimers.forEach(key => {
        const timer = timers.get(key)
        if (timer) {
          clearTimeout(timer)
          timers.delete(key)
        }
      })
    }
  }, [failedActions, retry, retryDelayMs])

  return {
    stack,
    failedActions,
    push,
    undo,
    peek,
    clear,
    retry,
    dismissFailed,
    getRemainingTime,
    hasUndoable: stack.length > 0,
    hasFailedActions: failedActions.length > 0,
  }
}
