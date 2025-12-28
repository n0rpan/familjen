import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Hook for contextual micro-feedback on recently changed items.
 * Tracks item IDs that were just saved/changed and auto-clears after duration.
 *
 * Usage:
 * const { markChanged, isRecentlyChanged, clearAll } = useMicroFeedback()
 *
 * // When item is saved:
 * markChanged(itemId)
 *
 * // In render:
 * <div className={isRecentlyChanged(itemId) ? 'just-saved' : ''}>
 */
export function useMicroFeedback(duration = 1000) {
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set())
  const timeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- we intentionally want to clear current timeouts at cleanup
      timeoutsRef.current.forEach(timeout => clearTimeout(timeout))
    }
  }, [])

  const markChanged = useCallback((id: string) => {
    // Clear existing timeout for this ID if any
    const existingTimeout = timeoutsRef.current.get(id)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Add to changed set
    setChangedIds(prev => new Set(prev).add(id))

    // Set timeout to remove
    const timeout = setTimeout(() => {
      setChangedIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      timeoutsRef.current.delete(id)
    }, duration)

    timeoutsRef.current.set(id, timeout)
  }, [duration])

  const isRecentlyChanged = useCallback((id: string) => {
    return changedIds.has(id)
  }, [changedIds])

  const clearAll = useCallback(() => {
    timeoutsRef.current.forEach(timeout => clearTimeout(timeout))
    timeoutsRef.current.clear()
    setChangedIds(new Set())
  }, [])

  return { markChanged, isRecentlyChanged, clearAll }
}

/**
 * Simpler version that just returns a className helper
 */
export function useFeedbackClass(duration = 1000) {
  const { markChanged, isRecentlyChanged, clearAll } = useMicroFeedback(duration)

  const getFeedbackClass = useCallback((id: string, baseClass = 'just-saved') => {
    return isRecentlyChanged(id) ? baseClass : ''
  }, [isRecentlyChanged])

  return { markChanged, getFeedbackClass, clearAll }
}
