'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

interface UseVisiblePollingOptions {
  /** Polling interval in milliseconds (default: 30000 = 30 seconds) */
  intervalMs?: number
  /** Whether polling is enabled (default: true) */
  enabled?: boolean
  /** Callback when poll is triggered */
  onPoll: () => Promise<void> | void
}

interface UseVisiblePollingResult {
  /** Whether the page is currently visible */
  isVisible: boolean
  /** Timestamp of last successful poll */
  lastUpdated: Date | null
  /** Whether a poll is currently in progress */
  isPolling: boolean
  /** Manually trigger a poll */
  triggerPoll: () => Promise<void>
}

/**
 * Hook for polling data only when the page is visible.
 * Automatically pauses when the user switches tabs or minimizes the window.
 * Resumes polling and immediately refreshes when the page becomes visible again.
 */
export function useVisiblePolling({
  intervalMs = 30000,
  enabled = true,
  onPoll,
}: UseVisiblePollingOptions): UseVisiblePollingResult {
  const [isVisible, setIsVisible] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isPolling, setIsPolling] = useState(false)

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const onPollRef = useRef(onPoll)
  const isPollingRef = useRef(false)

  // Keep onPoll ref up to date
  useEffect(() => {
    onPollRef.current = onPoll
  }, [onPoll])

  // Use a stable callback that checks ref instead of state
  const doPoll = useCallback(async () => {
    if (isPollingRef.current) return
    isPollingRef.current = true
    setIsPolling(true)
    try {
      await onPollRef.current()
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Polling error:', error)
    } finally {
      isPollingRef.current = false
      setIsPolling(false)
    }
  }, [])

  // Track visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible'
      setIsVisible(visible)

      // Immediately refresh when page becomes visible
      if (visible && enabled) {
        doPoll()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [enabled, doPoll])

  // Set up polling interval
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Only poll when enabled and visible
    if (!enabled || !isVisible) {
      return
    }

    // Start polling
    intervalRef.current = setInterval(() => {
      doPoll()
    }, intervalMs)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, isVisible, intervalMs, doPoll])

  const triggerPoll = useCallback(async () => {
    await doPoll()
  }, [doPoll])

  return {
    isVisible,
    lastUpdated,
    isPolling,
    triggerPoll,
  }
}

/**
 * Format a "last updated" timestamp for display
 */
export function formatLastUpdated(date: Date | null, t: { justNow: string; minutesAgo: string; hoursAgo: string }): string {
  if (!date) return ''

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)

  if (diffMinutes < 1) {
    return t.justNow
  } else if (diffMinutes < 60) {
    return t.minutesAgo.replace('{count}', String(diffMinutes))
  } else {
    return t.hoursAgo.replace('{count}', String(diffHours))
  }
}
