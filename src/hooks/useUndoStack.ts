'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

export interface UndoableAction<T> {
  id: string
  data: T
  description: string
  timestamp: number
}

interface UseUndoStackOptions {
  /** Time in ms before undo expires (default: 5000) */
  expireMs?: number
  /** Callback when action is committed (no longer undoable) */
  onCommit?: (action: UndoableAction<unknown>) => void
  /** Maximum stack size (default: 10) */
  maxSize?: number
}

export function useUndoStack<T = unknown>(options: UseUndoStackOptions = {}) {
  const { expireMs = 5000, onCommit, maxSize = 10 } = options
  const [stack, setStack] = useState<UndoableAction<T>[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer))
      timersRef.current.clear()
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
    const timer = setTimeout(() => {
      setStack(prev => {
        const action = prev.find(a => a.id === fullAction.id)
        if (action && onCommit) {
          onCommit(action as UndoableAction<unknown>)
        }
        return prev.filter(a => a.id !== fullAction.id)
      })
      timersRef.current.delete(fullAction.id)
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
        onCommit(action as UndoableAction<unknown>)
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

  return {
    stack,
    push,
    undo,
    peek,
    clear,
    getRemainingTime,
    hasUndoable: stack.length > 0,
  }
}
