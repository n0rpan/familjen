'use client'

import { useLanguage } from '@/lib/i18n/context'
import { getTaskConfig, getChildColor } from '@/lib/colors'
import type { ChildTaskWithChild, HouseholdReminderWithAssignee, ChildTaskType, ReminderCategory } from '@/lib/types'

interface ReminderCardProps {
  reminder: ChildTaskWithChild | HouseholdReminderWithAssignee
  type: 'child' | 'household'
  onToggle: (id: string, done: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

export function ReminderCard({ reminder, type, onToggle, onEdit, onDelete }: ReminderCardProps) {
  const { t } = useLanguage()

  const isChildTask = type === 'child'
  const childTask = isChildTask ? reminder as ChildTaskWithChild : null
  const householdReminder = !isChildTask ? reminder as HouseholdReminderWithAssignee : null

  const isDone = isChildTask
    ? childTask?.status === 'done'
    : householdReminder?.status === 'done'

  const isSnoozed = !isChildTask && householdReminder?.status === 'snoozed'

  const taskType = isChildTask
    ? childTask?.task_type as ChildTaskType
    : 'reminder'

  const category = householdReminder?.category as ReminderCategory | undefined

  const config = getTaskConfig(taskType)

  const getCategoryIcon = (cat: ReminderCategory): string => {
    const icons: Record<ReminderCategory, string> = {
      bill: '\ud83d\udcb3',
      insurance: '\ud83d\udee1\ufe0f',
      car: '\ud83d\ude97',
      home: '\ud83c\udfe0',
      health: '\u2764\ufe0f',
      subscription: '\ud83d\udd04',
      other: '\ud83d\udccc',
    }
    return icons[cat] || icons.other
  }

  const displayIcon = isChildTask ? config.icon : (category ? getCategoryIcon(category) : '\ud83d\udd14')

  const title = isChildTask ? childTask?.title : householdReminder?.title
  const date = isChildTask ? childTask?.date : householdReminder?.date
  const time = isChildTask ? childTask?.time : householdReminder?.time
  const notes = isChildTask ? childTask?.notes : householdReminder?.notes

  // Get child or assignee info
  const childInfo = childTask?.child
  const assignee = householdReminder?.assignee

  // Priority styling for household reminders
  const priority = householdReminder?.priority
  const priorityStyle = priority === 'high'
    ? { borderLeft: '3px solid var(--color-coral)' }
    : priority === 'low'
      ? { borderLeft: '3px solid var(--color-sage)' }
      : {}

  const formatTime = (timeStr: string | null | undefined) => {
    if (!timeStr) return null
    return timeStr.substring(0, 5) // HH:MM format
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const isToday = date.toDateString() === today.toDateString()
    const isTomorrow = date.toDateString() === tomorrow.toDateString()

    if (isToday) return t.common.today
    if (isTomorrow) return t.common.tomorrow

    return date.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-xl transition-all"
      style={{
        background: isDone ? 'transparent' : isSnoozed ? 'rgba(167, 139, 250, 0.08)' : 'var(--background)',
        opacity: isDone ? 0.6 : 1,
        ...priorityStyle,
      }}
    >
      {/* Toggle checkbox */}
      <button
        onClick={() => onToggle(reminder.id, !isDone)}
        className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors"
        style={{
          borderColor: isDone ? 'var(--color-sage)' : 'var(--border)',
          background: isDone ? 'var(--color-sage)' : 'transparent',
        }}
      >
        {isDone && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      {/* Icon */}
      <span className="text-xl flex-shrink-0">{displayIcon}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className="font-medium"
          style={{
            color: isDone ? 'var(--muted)' : 'var(--foreground)',
            textDecoration: isDone ? 'line-through' : 'none',
          }}
        >
          {title}
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          {/* Child or assignee badge */}
          {childInfo && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              style={{
                background: getChildColor(childInfo.color).bg,
                color: getChildColor(childInfo.color).text,
              }}
            >
              {childInfo.name}
            </span>
          )}
          {assignee && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
            >
              {assignee.name}
            </span>
          )}

          {/* Date */}
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {formatDate(date!)}
          </span>

          {/* Time */}
          {time && (
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatTime(time)}
            </span>
          )}

          {/* Type badge */}
          <span
            className="px-2 py-0.5 rounded-full text-xs"
            style={{ background: 'var(--sand)', color: 'var(--muted)' }}
          >
            {isChildTask ? t.remember.taskTypes[taskType] : (category ? t.remember.categories[category] : t.remember.taskTypes.reminder)}
          </span>

          {/* Snoozed indicator */}
          {isSnoozed && householdReminder?.snoozed_until && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              style={{ background: 'rgba(167, 139, 250, 0.2)', color: '#a78bfa' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16v16H4z" />
                <path d="M9 9h6M9 15h6" />
              </svg>
              {t.remember.snoozed}: {formatDate(householdReminder.snoozed_until)}
            </span>
          )}
        </div>

        {/* Notes */}
        {notes && (
          <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
            {notes}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={onEdit}
          className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
          title={t.common.edit}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="p-2 rounded-lg transition-colors hover:bg-[rgba(232,120,109,0.1)]"
          title={t.common.delete}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
