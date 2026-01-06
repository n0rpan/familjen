'use client'

/**
 * FreshnessIndicator Component
 *
 * A consistent freshness indicator used across pages to show data recency.
 * Features a pulsing dot and relative time that updates every minute.
 */

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n/context'

type IndicatorColor = 'sage' | 'sky' | 'muted'

interface Props {
  /** Timestamp of when data was last updated (ms or Date) */
  timestamp?: number | Date | null
  /** Color theme for the indicator */
  color?: IndicatorColor
  /** Whether to show the pulsing dot */
  showDot?: boolean
  /** Additional CSS class */
  className?: string
}

const COLOR_MAP: Record<IndicatorColor, { dot: string; text: string }> = {
  sage: {
    dot: 'var(--color-sage)',
    text: 'var(--color-sage)',
  },
  sky: {
    dot: 'var(--color-sky)',
    text: 'var(--color-sky)',
  },
  muted: {
    dot: 'var(--muted)',
    text: 'var(--muted)',
  },
}

/**
 * Format a timestamp as relative time
 */
function formatRelativeTime(
  timestamp: number,
  t: { justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string }
): string {
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

export function FreshnessIndicator({
  timestamp,
  color = 'muted',
  showDot = true,
  className = '',
}: Props) {
  const { t } = useLanguage()
  const [relativeTime, setRelativeTime] = useState<string>('')

  // Convert Date to timestamp if needed
  const ts = timestamp instanceof Date ? timestamp.getTime() : timestamp

  useEffect(() => {
    if (!ts) {
      // No timestamp - show "just now" as default
      setRelativeTime(t.common.justNow)
      return
    }

    const update = () => {
      setRelativeTime(formatRelativeTime(ts, t.common))
    }

    // Update immediately
    update()

    // Update every minute
    const interval = setInterval(update, 60000)
    return () => clearInterval(interval)
  }, [ts, t.common])

  const colors = COLOR_MAP[color]

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {showDot && (
        <div
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{
            background: colors.dot,
            boxShadow: `0 0 6px ${colors.dot}`,
          }}
        />
      )}
      <span
        className="text-xs"
        style={{ color: colors.text }}
      >
        {relativeTime}
      </span>
    </div>
  )
}
