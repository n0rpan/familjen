'use client'

import { memo } from 'react'
import { TransitionLink } from './TransitionLink'
import type { AIHeadsUp, HeadsUpType, HeadsUpSourceType } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'
import type { TranslationStrings } from '@/lib/i18n/types'

// Icons for each heads-up type
const TYPE_ICONS: Record<HeadsUpType, string> = {
  suggestion: '💡',
  closure: '🚫',
  task: '🎒',
  member_event: '👤',
}

// Special icon for appointments
const APPOINTMENT_ICON = '📅'

// Warning icon for conflicts
const CONFLICT_ICON = '⚠️'

interface HeadsUpItemProps {
  item: AIHeadsUp
}

/**
 * Get source label from translations
 */
function getSourceLabel(
  sourceType: HeadsUpSourceType,
  displayName: string | undefined,
  t: TranslationStrings
): string {
  // If we have a display name (e.g., kindergarten name), use it for suggestions
  if (displayName && sourceType === 'suggestion') {
    return displayName
  }

  // Map sourceType to translation keys
  const sourceLabels: Record<HeadsUpSourceType, string> = {
    suggestion: t.home.headsUpSourceSuggestion,
    closure: t.home.headsUpSourceClosure,
    task: t.home.headsUpSourceTask,
    memberEvent: t.home.headsUpSourceMemberEvent,
  }

  return sourceLabels[sourceType] || t.home.headsUpSourceTask
}

/**
 * Format a date relative to today
 * Uses UTC parsing to avoid timezone issues with date-only strings
 */
function formatRelativeDate(dateStr: string, language: string): string {
  // Parse as UTC to avoid timezone shifts
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  const now = new Date()
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))

  const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return language === 'en' ? 'Today' : language === 'sv' ? 'Idag' : 'I dag'
  }
  if (diffDays === 1) {
    return language === 'en' ? 'Tomorrow' : language === 'sv' ? 'Imorgon' : 'I morgen'
  }

  // Return weekday name
  const weekdays = {
    nb: ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'],
    sv: ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'],
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  }

  const dayIndex = date.getUTCDay()
  return weekdays[language as keyof typeof weekdays]?.[dayIndex] || weekdays.nb[dayIndex]
}

export const HeadsUpItem = memo(function HeadsUpItem({ item }: HeadsUpItemProps) {
  const { language, t } = useLanguage()

  // Determine icon
  let icon = TYPE_ICONS[item.type]
  if (item.type === 'task' && item.time) {
    icon = APPOINTMENT_ICON // Appointments have time
  }
  if (item.hasConflict) {
    icon = CONFLICT_ICON
  }

  const dateLabel = formatRelativeDate(item.date, language)
  const sourceLabel = getSourceLabel(item.source.sourceType, item.source.displayName, t)

  // Get time prefix based on language
  const timePrefix = language === 'en' ? 'at' : language === 'sv' ? 'kl' : 'kl'

  // Get description - use conflict translation if applicable
  const description = item.hasConflict ? t.home.headsUpConflict : item.description

  return (
    <TransitionLink
      href={item.href}
      className="flex items-start gap-3 p-3 rounded-xl transition-colors hover:opacity-80"
      style={{
        background: item.hasConflict
          ? 'rgba(232, 120, 109, 0.1)'
          : 'var(--background)',
        borderLeft: item.hasConflict
          ? '3px solid var(--color-coral)'
          : item.priority === 'high'
            ? '3px solid var(--color-honey)'
            : 'none',
      }}
    >
      <span className="text-lg flex-shrink-0" aria-hidden="true">
        {icon}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-medium"
            style={{ color: item.hasConflict ? 'var(--color-coral)' : 'var(--foreground)' }}
          >
            {item.title}
          </span>

          {/* Child or member badge */}
          {(item.childName || item.memberName) && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                background: item.hasConflict
                  ? 'rgba(232, 120, 109, 0.2)'
                  : 'rgba(126, 182, 196, 0.15)',
                color: item.hasConflict
                  ? 'var(--color-coral)'
                  : 'var(--color-sky)',
              }}
            >
              {item.childName || item.memberName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {dateLabel}
            {item.time && ` ${timePrefix} ${item.time}`}
            {item.endDate && item.endDate !== item.date && (
              <> → {formatRelativeDate(item.endDate, language)}</>
            )}
          </span>

          {description && (
            <>
              <span style={{ color: 'var(--muted)' }}>·</span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {description}
              </span>
            </>
          )}
        </div>

        <span
          className="text-xs mt-1 block"
          style={{ color: 'var(--muted)', opacity: 0.7 }}
        >
          {sourceLabel}
        </span>
      </div>

      {/* Arrow indicator */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="flex-shrink-0 mt-1"
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </TransitionLink>
  )
})
