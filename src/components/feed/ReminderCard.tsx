'use client'

export interface FeedReminder {
  id: string
  title: string
  notes: string | null
  due_date: string | null
  completed: boolean
  child_id: string | null
  child_name?: string | null
  created_at: string
}

interface Props {
  reminder: FeedReminder
  onToggle?: (id: string, completed: boolean) => void
}

export function ReminderCard({ reminder, onToggle }: Props) {
  // Format date - compare dates only (ignore time) to avoid timezone issues
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null

    // Parse as local date (YYYY-MM-DD format)
    const dateParts = dateStr.split('T')[0].split('-')
    const dueDate = new Date(
      parseInt(dateParts[0]),
      parseInt(dateParts[1]) - 1,
      parseInt(dateParts[2])
    )

    // Get today at midnight local time
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // Calculate difference in days
    const diffMs = dueDate.getTime() - today.getTime()
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays < 0) {
      return { text: 'Forfalt', isOverdue: true }
    } else if (diffDays === 0) {
      return { text: 'I dag', isOverdue: false }
    } else if (diffDays === 1) {
      return { text: 'I morgen', isOverdue: false }
    } else if (diffDays < 7) {
      return { text: dueDate.toLocaleDateString('nb-NO', { weekday: 'long' }), isOverdue: false }
    }
    return { text: dueDate.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' }), isOverdue: false }
  }

  const dueInfo = formatDate(reminder.due_date)

  return (
    <div
      className="p-4 rounded-xl transition-all"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        opacity: reminder.completed ? 0.6 : 1,
      }}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onToggle?.(reminder.id, !reminder.completed)}
          className="flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors"
          style={{
            borderColor: reminder.completed ? 'var(--color-sage)' : 'var(--border)',
            background: reminder.completed ? 'var(--color-sage)' : 'transparent',
          }}
        >
          {reminder.completed && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
              <polyline points="20,6 9,17 4,12" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3
              className="font-medium"
              style={{
                color: 'var(--foreground)',
                textDecoration: reminder.completed ? 'line-through' : 'none',
              }}
            >
              {reminder.title}
            </h3>
            {dueInfo && (
              <span
                className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                style={{
                  background: dueInfo.isOverdue
                    ? 'rgba(232, 120, 109, 0.2)'
                    : 'rgba(229, 185, 94, 0.2)',
                  color: dueInfo.isOverdue ? 'var(--color-coral)' : 'var(--color-honey)',
                }}
              >
                {dueInfo.text}
              </span>
            )}
          </div>

          {reminder.notes && (
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {reminder.notes}
            </p>
          )}

          {reminder.child_name && (
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              {reminder.child_name}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
