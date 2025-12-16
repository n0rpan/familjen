'use client'

import { formatDateNorwegian } from '@/lib/utils'
import type { DaySummary, ChildColor, ChildTaskType } from '@/lib/types'

// Map child color names to CSS values
const CHILD_COLOR_MAP: Record<ChildColor, { bg: string; text: string }> = {
  sky: { bg: 'rgba(126, 182, 196, 0.3)', text: 'var(--color-sky)' },
  coral: { bg: 'rgba(232, 120, 109, 0.3)', text: 'var(--color-coral)' },
  sage: { bg: 'rgba(131, 166, 151, 0.3)', text: 'var(--color-sage)' },
  honey: { bg: 'rgba(229, 185, 94, 0.3)', text: 'var(--color-honey)' },
  lavender: { bg: 'rgba(167, 139, 250, 0.3)', text: '#a78bfa' },
  mint: { bg: 'rgba(52, 211, 153, 0.3)', text: '#34d399' },
}

// Task type icons
const TASK_TYPE_CONFIG: Record<ChildTaskType, { icon: string; label: string }> = {
  bring: { icon: '🎒', label: 'Ta med' },
  appointment: { icon: '🩺', label: 'Avtale' },
  reminder: { icon: '📝', label: 'Påminnelse' },
  other: { icon: '📌', label: 'Annet' },
}

const getChildColor = (color: ChildColor) => CHILD_COLOR_MAP[color] || CHILD_COLOR_MAP.sky
const getTaskConfig = (taskType: ChildTaskType) => TASK_TYPE_CONFIG[taskType] || TASK_TYPE_CONFIG.other

interface TodayOverviewProps {
  summary: DaySummary | null
  loading?: boolean
}

export function TodayOverview({ summary, loading }: TodayOverviewProps) {
  const today = new Date()

  if (loading) {
    return (
      <div
        className="rounded-2xl p-6 md:p-8 animate-pulse"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="h-7 rounded-lg w-56 mb-6" style={{ background: 'var(--sand)' }} />
        <div className="space-y-4">
          <div className="h-5 rounded-lg w-full" style={{ background: 'var(--sand)' }} />
          <div className="h-5 rounded-lg w-full" style={{ background: 'var(--sand)' }} />
          <div className="h-5 rounded-lg w-3/4" style={{ background: 'var(--sand)' }} />
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl p-6 md:p-8"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(229, 185, 94, 0.2)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            I dag
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {formatDateNorwegian(today)}
          </p>
        </div>
      </div>

      {!summary || (summary.pickups.length === 0 && !summary.meal && summary.tasks.length === 0) ? (
        <div
          className="text-center py-8 rounded-xl"
          style={{ background: 'var(--background)' }}
        >
          <p style={{ color: 'var(--muted)' }}>Ingen planer for i dag ennå.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Pickups */}
          {summary.pickups.map((pickup) => (
            <div
              key={pickup.id}
              className="flex items-center gap-4 p-4 rounded-xl transition-colors"
              style={{ background: 'var(--background)' }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
                style={{
                  background: getChildColor(pickup.child.color).bg,
                  color: getChildColor(pickup.child.color).text
                }}
              >
                {pickup.child.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-medium block" style={{ color: 'var(--foreground)' }}>
                  {pickup.child.name}
                </span>
                {pickup.child.location_name && (
                  <span className="text-sm" style={{ color: 'var(--muted)' }}>
                    {pickup.child.location_name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"/>
                  <path d="M12 5l7 7-7 7"/>
                </svg>
                <span
                  className={`font-medium ${pickup.picker ? '' : 'opacity-50'}`}
                  style={{ color: pickup.picker ? 'var(--accent)' : 'var(--muted)' }}
                >
                  {pickup.picker ? `${pickup.picker.name} henter` : 'Ikke tildelt'}
                </span>
              </div>
            </div>
          ))}

          {/* Meal */}
          {summary.meal && (
            <div
              className="flex items-center gap-4 p-4 rounded-xl mt-4"
              style={{ background: 'rgba(229, 185, 94, 0.1)' }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-honey)', color: 'white' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
                  <path d="M7 2v20"/>
                  <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
                </svg>
              </div>
              <div className="flex-1">
                <span className="text-sm" style={{ color: 'var(--muted)' }}>Middag</span>
                <span className="font-medium block" style={{ color: 'var(--foreground)' }}>
                  {summary.meal.recipe?.name || summary.meal.custom_meal || 'Ikke planlagt'}
                </span>
              </div>
            </div>
          )}

          {/* Tasks - "Husk i dag" section */}
          {summary.tasks.length > 0 && (
            <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  Husk i dag
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(229, 185, 94, 0.2)', color: 'var(--color-honey)' }}
                >
                  {summary.tasks.filter(t => t.status === 'open').length} oppgaver
                </span>
              </div>
              <div className="space-y-2">
                {summary.tasks.map((task) => {
                  const config = getTaskConfig(task.task_type as ChildTaskType)
                  const isDone = task.status === 'done'
                  const childName = task.child?.name || 'Ukjent'
                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 p-3 rounded-xl transition-colors"
                      style={{
                        background: isDone ? 'transparent' : 'rgba(229, 185, 94, 0.08)',
                        opacity: isDone ? 0.6 : 1,
                      }}
                    >
                      <span className="text-lg flex-shrink-0">{config.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span
                          className="font-medium block"
                          style={{
                            color: isDone ? 'var(--muted)' : 'var(--foreground)',
                            textDecoration: isDone ? 'line-through' : 'none',
                          }}
                        >
                          {task.title}
                        </span>
                        <span className="text-sm" style={{ color: 'var(--muted)' }}>
                          {childName}
                          {task.time && ` • ${task.time.substring(0, 5)}`}
                        </span>
                      </div>
                      {isDone && (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
