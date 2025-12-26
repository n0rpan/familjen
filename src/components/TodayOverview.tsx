'use client'

import { memo } from 'react'
import { formatDateLocalized, isWeekend, getHoliday, getHolidayEmoji, type Holiday } from '@/lib/utils'
import type { DaySummary, ChildTaskType, HouseholdEvent, MemberEvent, ExternalEvent, ChildTask } from '@/lib/types'
import { getChildColor, getTaskConfig } from '@/lib/colors'
import { useLanguage } from '@/lib/i18n/context'

interface TodayOverviewProps {
  summary: DaySummary | null
  loading?: boolean
  holidays?: Holiday[]
  onHouseholdEventClick?: (event: HouseholdEvent) => void
  onMemberEventClick?: (event: MemberEvent) => void
  onExternalEventClick?: (event: ExternalEvent) => void
  onTaskClick?: (task: ChildTask) => void
}

// Helper to get service badge color and label
function getServiceInfo(service: string) {
  switch (service?.toLowerCase()) {
    case 'spond':
      return { badge: 'S', color: '#ff6b35', bg: 'rgba(255, 107, 53, 0.15)', label: 'Spond' }
    case 'kidplan':
      return { badge: 'K', color: '#4caf50', bg: 'rgba(76, 175, 80, 0.15)', label: 'Kidplan' }
    case 'iskole':
      return { badge: 'I', color: '#2196f3', bg: 'rgba(33, 150, 243, 0.15)', label: 'iSkole' }
    case 'mykid':
      return { badge: 'M', color: '#9c27b0', bg: 'rgba(156, 39, 176, 0.15)', label: 'MyKid' }
    default:
      return { badge: 'E', color: 'var(--accent)', bg: 'var(--background)', label: 'Ekstern' }
  }
}

// Helper to get member event icon
function getMemberEventIcon(eventType: string) {
  switch (eventType) {
    case 'work':
      return '💼'
    case 'travel':
      return '✈️'
    case 'family':
      return '👨‍👩‍👧'
    default:
      return '📅'
  }
}

export const TodayOverview = memo(function TodayOverview({
  summary,
  loading,
  holidays = [],
  onHouseholdEventClick,
  onMemberEventClick,
  onExternalEventClick,
  onTaskClick,
}: TodayOverviewProps) {
  const today = new Date()
  const { language, t } = useLanguage()

  // Get holiday/birthday for today
  const holiday = getHoliday(today, holidays)
  const isBirthday = holiday?.type === 'birthday'
  const isWeekendDay = isWeekend(today)
  const isNonWorkingDay = isWeekendDay || !!holiday

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

  // Format birthday name with translation
  const getHolidayDisplayName = () => {
    if (!holiday) return ''
    if (isBirthday) {
      return t.date.birthday.replace('{name}', holiday.name)
    }
    return holiday.name
  }

  // Check if there's any content to show
  const hasContent = summary && (
    summary.pickups.length > 0 ||
    summary.meal ||
    summary.tasks.length > 0 ||
    (summary.householdEvents && summary.householdEvents.length > 0) ||
    (summary.memberEvents && summary.memberEvents.length > 0) ||
    (summary.externalEvents && summary.externalEvents.length > 0)
  )

  return (
    <div
      className="rounded-2xl p-6 md:p-8"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Holiday/Birthday Banner */}
      {holiday && (
        <div
          className="flex items-center gap-3 p-4 rounded-xl mb-6 -mt-2"
          style={{
            background: isBirthday
              ? 'linear-gradient(135deg, rgba(167, 139, 250, 0.15), rgba(229, 185, 94, 0.15))'
              : 'linear-gradient(135deg, rgba(232, 120, 109, 0.15), rgba(229, 185, 94, 0.15))',
            border: `1px solid ${isBirthday ? 'rgba(167, 139, 250, 0.3)' : 'rgba(232, 120, 109, 0.3)'}`,
          }}
        >
          <span className="text-2xl">{getHolidayEmoji(holiday)}</span>
          <div className="flex-1">
            <span
              className="font-semibold"
              style={{ color: isBirthday ? '#a78bfa' : 'var(--color-coral)' }}
            >
              {getHolidayDisplayName()}
            </span>
            {isBirthday && (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                {t.home.birthdayWishes}
              </p>
            )}
          </div>
          <span className="text-2xl">{isBirthday ? '🎉' : '✨'}</span>
        </div>
      )}

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
            {t.common.today}
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {formatDateLocalized(today, language)}
          </p>
        </div>
      </div>

      {!hasContent ? (
        <div
          className="text-center py-8 rounded-xl"
          style={{ background: 'var(--background)' }}
        >
          <p style={{ color: 'var(--muted)' }}>{t.home.noPickupsToday}</p>
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
                aria-hidden="true"
                title={pickup.child.name}
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
                  {pickup.picker
                    ? t.home.picksUp.replace('{name}', pickup.picker.name)
                    : (isNonWorkingDay ? '—' : t.week.noPickup)}
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
                <span className="text-sm" style={{ color: 'var(--muted)' }}>{t.home.meal}</span>
                <span className="font-medium block" style={{ color: 'var(--foreground)' }}>
                  {summary.meal.recipe?.name || summary.meal.custom_meal || t.home.noMealPlanned}
                </span>
              </div>
            </div>
          )}

          {/* Member events */}
          {summary.memberEvents && summary.memberEvents.length > 0 && (
            <div className="mt-4">
              {summary.memberEvents.map((event) => (
                <button
                  key={event.id}
                  onClick={() => onMemberEventClick?.(event)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl mb-2 text-left transition-colors hover:opacity-80"
                  style={{ background: 'rgba(139, 168, 136, 0.1)' }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-lg"
                    style={{ background: 'rgba(139, 168, 136, 0.3)', color: 'var(--color-sage)' }}
                  >
                    {getMemberEventIcon(event.event_type)}
                  </div>
                  <div className="flex-1">
                    <span className="text-sm" style={{ color: 'var(--color-sage)' }}>
                      {event.event_type === 'work' ? 'Jobb' : event.event_type === 'travel' ? 'Reise' : 'Hendelse'}
                    </span>
                    <span className="font-medium block" style={{ color: 'var(--foreground)' }}>
                      {event.title}
                    </span>
                    {event.source !== 'manual' && (
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        {event.source === 'google_calendar' ? 'Google Kalender' : event.source === 'ics_calendar' ? 'ICS Kalender' : ''}
                      </span>
                    )}
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              ))}
            </div>
          )}

          {/* Household/Family events */}
          {summary.householdEvents && summary.householdEvents.length > 0 && (
            <div className="mt-4">
              {summary.householdEvents.map((event) => (
                <button
                  key={event.id}
                  onClick={() => onHouseholdEventClick?.(event)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl mb-2 text-left transition-colors hover:opacity-80"
                  style={{
                    background: 'rgba(167, 139, 250, 0.1)',
                    opacity: event.is_redistributed ? 0.6 : 1,
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-lg"
                    style={{ background: 'rgba(167, 139, 250, 0.3)', color: '#a78bfa' }}
                  >
                    🏠
                  </div>
                  <div className="flex-1">
                    <span className="text-sm" style={{ color: '#a78bfa' }}>{t.week.family}</span>
                    <span className="font-medium block" style={{ color: 'var(--foreground)' }}>
                      {event.event_time && (
                        <span className="text-sm" style={{ color: 'var(--muted)' }}>
                          {event.event_time.substring(0, 5)}{' '}
                        </span>
                      )}
                      {event.title}
                    </span>
                    {event.location && (
                      <span className="text-sm block" style={{ color: 'var(--muted)' }}>
                        📍 {event.location}
                      </span>
                    )}
                  </div>
                  {event.is_redistributed ? (
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(167, 139, 250, 0.2)', color: '#a78bfa' }}>
                      ↗
                    </span>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* External events */}
          {summary.externalEvents && summary.externalEvents.length > 0 && (
            <div className="mt-4">
              {summary.externalEvents.map((event) => {
                const serviceInfo = getServiceInfo(event.integration?.service || '')
                const isSchoolClosure = event.event_type === 'school_closure'
                return (
                  <button
                    key={event.id}
                    onClick={() => onExternalEventClick?.(event)}
                    className="w-full flex items-center gap-4 p-4 rounded-xl mb-2 text-left transition-colors hover:opacity-80"
                    style={{ background: isSchoolClosure ? 'rgba(178, 154, 198, 0.15)' : serviceInfo.bg }}
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                      style={{
                        background: isSchoolClosure ? '#b29ac6' : serviceInfo.color,
                        color: 'white'
                      }}
                    >
                      {isSchoolClosure ? '🏫' : serviceInfo.badge}
                    </div>
                    <div className="flex-1">
                      <span className="text-sm" style={{ color: isSchoolClosure ? '#b29ac6' : serviceInfo.color }}>
                        {isSchoolClosure ? 'Skolefri' : serviceInfo.label}
                        {event.integration?.display_name && ` • ${event.integration.display_name}`}
                      </span>
                      <span className="font-medium block" style={{ color: 'var(--foreground)' }}>
                        {event.event_time && (
                          <span className="text-sm" style={{ color: 'var(--muted)' }}>
                            {event.event_time.substring(0, 5)}{' '}
                          </span>
                        )}
                        {event.local_overrides?.title || event.title}
                      </span>
                      {event.location && (
                        <span className="text-sm block" style={{ color: 'var(--muted)' }}>
                          📍 {event.local_overrides?.location || event.location}
                        </span>
                      )}
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </button>
                )
              })}
            </div>
          )}

          {/* Tasks section */}
          {summary.tasks.length > 0 && (
            <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  {t.home.tasks}
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(229, 185, 94, 0.2)', color: 'var(--color-honey)' }}
                >
                  {summary.tasks.filter(task => task.status === 'open').length} {t.home.tasks}
                </span>
              </div>
              <div className="space-y-2">
                {summary.tasks.map((task) => {
                  const config = getTaskConfig(task.task_type as ChildTaskType)
                  const isDone = task.status === 'done'
                  const childName = task.child?.name || 'Ukjent'
                  return (
                    <button
                      key={task.id}
                      onClick={() => onTaskClick?.(task as ChildTask)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left hover:opacity-80"
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
                      {isDone ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
})
