'use client'

/**
 * LastUpdated Component
 *
 * Displays a relative time indicator (e.g., "2 min ago")
 * Updates automatically every minute.
 */

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n/context'

interface Props {
  timestamp: number | Date | null
  className?: string
  showLabel?: boolean
}

/**
 * Format a timestamp as relative time
 */
function formatRelativeTime(timestamp: number, t: { justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string }): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) {
    return t.justNow
  } else if (minutes < 60) {
    return t.minutesAgo.replace('{count}', String(minutes))
  } else if (hours < 24) {
    return t.hoursAgo.replace('{count}', String(hours))
  } else {
    return t.daysAgo.replace('{count}', String(days))
  }
}

export function LastUpdated({ timestamp, className, showLabel = true }: Props) {
  const { t } = useLanguage()
  const [relativeTime, setRelativeTime] = useState<string>('')

  // Convert Date to timestamp if needed
  const ts = timestamp instanceof Date ? timestamp.getTime() : timestamp

  useEffect(() => {
    if (!ts) return

    const update = () => {
      setRelativeTime(formatRelativeTime(ts, t.common))
    }

    // Update immediately
    update()

    // Update every minute
    const interval = setInterval(update, 60000)
    return () => clearInterval(interval)
  }, [ts, t.common])

  if (!ts || !relativeTime) return null

  return (
    <span
      className={className}
      style={{ color: 'var(--muted)', fontSize: '0.75rem' }}
    >
      {showLabel ? `${t.common.lastUpdated}: ${relativeTime}` : relativeTime}
    </span>
  )
}
