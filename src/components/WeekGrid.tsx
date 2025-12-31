'use client'

import { useMemo, memo, useState, useCallback } from 'react'
import {
  getWeekDates,
  getWeekStart,
  getWeekdayIndex,
  formatDateISO,
  isToday,
  isWeekend,
  cn,
  getHoliday,
  type Holiday,
} from '@/lib/utils'
import type { Child, HouseholdMember, PickupWithDetails, MealWithRecipe, Recipe, MemberEvent, HouseholdEvent, ChildTask, MemberEventType, ChildTaskType, ExternalEvent } from '@/lib/types'
import { getChildColor, getEventConfig, getTaskConfig } from '@/lib/colors'
import { MealSelector } from './MealSelector'
import { useLanguage } from '@/lib/i18n/context'

interface WeekGridProps {
  children: Child[]
  members: HouseholdMember[]
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
  memberEvents?: MemberEvent[]  // Parent events (work trips, dinners, etc.)
  householdEvents?: HouseholdEvent[]  // Family/household calendar events
  childTasks?: ChildTask[]  // Kid tasks (bring items, appointments, reminders)
  externalEvents?: ExternalEvent[]  // External events from Spond, Kidplan, etc.
  holidays?: Holiday[]  // System and household holidays
  recipes?: Recipe[]  // For meal selector dropdown
  weekStart?: Date | string  // May be serialized as string from server
  editable?: boolean
  onPickupChange?: (childId: string, date: string, pickerId: string | null) => void
  onMealChange?: (date: string, mealName: string | null, recipeId?: string) => void
  onRequestAISuggestion?: (date: string) => void  // Per-day AI suggestion
  onEventClick?: (event: MemberEvent) => void  // Click to edit event
  onHouseholdEventClick?: (event: HouseholdEvent) => void  // Click household event
  onWorkCalendarSync?: (pickupId: string, sync: boolean) => void  // Toggle work calendar invite
  syncingPickupId?: string | null  // ID of pickup currently being synced to work calendar
  onTaskToggle?: (taskId: string, done: boolean) => void  // Mark task done/undone
  onTaskClick?: (task: ChildTask) => void  // Click to edit task
  onAddTask?: (childId: string, date: string) => void  // Quick add task
  onExternalEventClick?: (event: ExternalEvent) => void  // Click external event for details
}

export const WeekGrid = memo(function WeekGrid({
  children,
  members,
  pickups,
  meals,
  memberEvents = [],
  householdEvents = [],
  childTasks = [],
  externalEvents = [],
  holidays = [],
  recipes = [],
  weekStart: providedWeekStart,
  editable = false,
  onPickupChange,
  onMealChange,
  onRequestAISuggestion,
  onEventClick,
  onHouseholdEventClick,
  onWorkCalendarSync,
  syncingPickupId,
  onTaskToggle,
  onTaskClick,
  onAddTask,
  onExternalEventClick,
}: WeekGridProps) {
  const { language, t } = useLanguage()

  // State for expanded cells (tasks and events)
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set())

  const toggleCellExpansion = useCallback((cellKey: string) => {
    setExpandedCells(prev => {
      const next = new Set(prev)
      if (next.has(cellKey)) {
        next.delete(cellKey)
      } else {
        next.add(cellKey)
      }
      return next
    })
  }, [])

  // Ensure weekStart is a Date object (may be serialized as string from server)
  const weekStart = useMemo(() => {
    if (!providedWeekStart) return getWeekStart(new Date())
    return providedWeekStart instanceof Date ? providedWeekStart : new Date(providedWeekStart)
  }, [providedWeekStart])

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart])

  // Create lookup maps for quick access
  const pickupMap = useMemo(() => {
    const map = new Map<string, PickupWithDetails>()
    pickups.forEach((p) => {
      map.set(`${p.child_id}-${p.date}`, p)
    })
    return map
  }, [pickups])

  const mealMap = useMemo(() => {
    const map = new Map<string, MealWithRecipe>()
    meals.forEach((m) => {
      map.set(m.date, m)
    })
    return map
  }, [meals])

  // Group events by member and date (for multi-day events, add to each day)
  const eventsByMemberDate = useMemo(() => {
    const map = new Map<string, MemberEvent[]>()
    memberEvents.forEach((event) => {
      const startDate = new Date(event.date)
      const endDate = event.end_date ? new Date(event.end_date) : startDate

      // Add event to each day it spans
      const current = new Date(startDate)
      while (current <= endDate) {
        const key = `${event.member_id}-${formatDateISO(current)}`
        const existing = map.get(key) || []
        existing.push(event)
        map.set(key, existing)
        current.setDate(current.getDate() + 1)
      }
    })
    return map
  }, [memberEvents])

  // Group household events by date (for multi-day events, add to each day)
  const householdEventsByDate = useMemo(() => {
    const map = new Map<string, HouseholdEvent[]>()
    householdEvents.forEach((event) => {
      const startDate = new Date(event.event_date)
      const endDate = event.end_date ? new Date(event.end_date) : startDate

      // Add event to each day it spans
      const current = new Date(startDate)
      while (current <= endDate) {
        const key = formatDateISO(current)
        const existing = map.get(key) || []
        existing.push(event)
        map.set(key, existing)
        current.setDate(current.getDate() + 1)
      }
    })
    return map
  }, [householdEvents])

  // Get parent members who might have events (is_parent = true or has events)
  const parentMembers = useMemo(() => {
    const memberIds = new Set(memberEvents.map(e => e.member_id))
    return members?.filter(m => m.is_parent || memberIds.has(m.id)) || []
  }, [members, memberEvents])

  // Group tasks by child and date
  const tasksByChildDate = useMemo(() => {
    const map = new Map<string, ChildTask[]>()
    childTasks.forEach((task) => {
      const key = `${task.child_id}-${task.date}`
      const existing = map.get(key) || []
      existing.push(task)
      map.set(key, existing)
    })
    return map
  }, [childTasks])

  // Group external events by child and date
  const externalEventsByChildDate = useMemo(() => {
    const map = new Map<string, ExternalEvent[]>()
    externalEvents.forEach((event) => {
      if (!event.child_id) return // Skip events not linked to a child
      const key = `${event.child_id}-${event.event_date}`
      const existing = map.get(key) || []
      existing.push(event)
      map.set(key, existing)
    })
    return map
  }, [externalEvents])

  const getPickup = (childId: string, date: Date) => {
    return pickupMap.get(`${childId}-${formatDateISO(date)}`)
  }

  const getMeal = (date: Date) => {
    return mealMap.get(formatDateISO(date))
  }

  const getEventsForMemberDate = (memberId: string, date: Date) => {
    return eventsByMemberDate.get(`${memberId}-${formatDateISO(date)}`) || []
  }

  const getHouseholdEventsForDate = (date: Date) => {
    return householdEventsByDate.get(formatDateISO(date)) || []
  }

  const getTasksForChildDate = (childId: string, date: Date) => {
    return tasksByChildDate.get(`${childId}-${formatDateISO(date)}`) || []
  }

  const getExternalEventsForChildDate = (childId: string, date: Date) => {
    return externalEventsByChildDate.get(`${childId}-${formatDateISO(date)}`) || []
  }

  // Pre-compute holidays for each day of the week to avoid repeated lookups in render
  const holidaysByDate = useMemo(() => {
    const map = new Map<string, Holiday | null>()
    weekDates.forEach(date => {
      map.set(formatDateISO(date), getHoliday(date, holidays))
    })
    return map
  }, [weekDates, holidays])

  // Get service badge label (e.g., "Spond")
  const getServiceBadge = (event: ExternalEvent) => {
    // Special case for school closures
    if (event.event_type === 'school_closure') return 'Skole'
    const service = event.integration?.service?.toLowerCase()
    if (service === 'spond') return 'Spond'
    if (service === 'kidplan') return 'Kidplan'
    if (service === 'iskole') return 'iSkole'
    return 'Ekstern'
  }

  // Check if event is a school closure
  const isSchoolClosure = (event: ExternalEvent) => event.event_type === 'school_closure'

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Grid - ensure full width with proper column distribution */}
      <div className="overflow-x-auto -mx-px">
        <table className="w-full min-w-[700px] table-fixed">
          <colgroup>
            <col className="w-24" />
            {weekDates.map((_, i) => (
              <col key={i} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th
                className="p-3 text-left text-sm font-medium w-24"
                style={{ color: 'var(--muted)' }}
              >
                {/* Empty cell for row labels */}
              </th>
              {weekDates.map((date, i) => (
                <th
                  key={i}
                  className={cn(
                    'p-3 text-center text-sm font-medium min-w-[80px]',
                    isToday(date) && 'relative'
                  )}
                  style={{
                    background: isToday(date) ? 'rgba(232, 120, 109, 0.08)' : undefined,
                    color: isWeekend(date) ? 'var(--muted)' : 'var(--foreground)',
                  }}
                >
                  <div className="font-medium">{t.date.weekdaysShort[getWeekdayIndex(date)]}</div>
                  <div
                    className={cn(
                      'text-xs mt-1',
                      isToday(date) ? 'font-semibold' : ''
                    )}
                    style={{ color: isToday(date) ? 'var(--accent)' : 'var(--muted)' }}
                  >
                    {date.getDate()}.
                  </div>
                  {(() => {
                    const holiday = holidaysByDate.get(formatDateISO(date))
                    if (!holiday) return null
                    const label = holiday.type === 'birthday'
                      ? t.date.birthday.replace('{name}', holiday.name)
                      : holiday.name
                    return (
                      <div
                        className="text-xs mt-1 truncate max-w-[80px]"
                        style={{ color: holiday.type === 'birthday' ? '#a78bfa' : 'var(--color-coral)' }}
                        title={label}
                      >
                        {label}
                      </div>
                    )
                  })()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Child rows */}
            {children?.map((child, childIndex) => (
              <tr key={child.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
                      style={{
                        background: getChildColor(child.color).bg,
                        color: getChildColor(child.color).text
                      }}
                      aria-hidden="true"
                      title={child.name}
                    >
                      {child.name.charAt(0)}
                    </div>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {child.name}
                    </span>
                  </div>
                </td>
                {weekDates.map((date, i) => {
                  const pickup = getPickup(child.id, date)
                  const tasks = getTasksForChildDate(child.id, date)
                  const extEvents = getExternalEventsForChildDate(child.id, date)
                  const dateStr = formatDateISO(date)

                  return (
                    <td
                      key={i}
                      className="p-2 align-top"
                      style={{
                        background: isToday(date)
                          ? 'rgba(232, 120, 109, 0.08)'
                          : isWeekend(date)
                          ? 'var(--background)'
                          : undefined,
                      }}
                    >
                      <div className="space-y-1">
                        {/* Pickup selector / display */}
                        {editable ? (
                          <>
                            <select
                              value={pickup?.picker_id || ''}
                              onChange={(e) =>
                                onPickupChange?.(child.id, dateStr, e.target.value || null)
                              }
                              className="w-full text-sm p-2 rounded-lg transition-colors"
                              style={{
                                background: 'var(--background)',
                                border: '1px solid var(--border)',
                                color: 'var(--foreground)',
                              }}
                            >
                              <option value="">-</option>
                              {members?.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.short_name || m.name}
                                </option>
                              ))}
                            </select>
                            {/* Work calendar sync button */}
                            {pickup?.picker?.work_email && onWorkCalendarSync && (
                              <button
                                onClick={() => onWorkCalendarSync(pickup.id, !pickup.sync_to_work_calendar)}
                                disabled={syncingPickupId === pickup.id}
                                className="w-full flex items-center justify-center gap-1 text-xs py-1 px-2 rounded transition-colors disabled:opacity-50"
                                style={{
                                  background: pickup.sync_to_work_calendar
                                    ? 'rgba(131, 166, 151, 0.2)'
                                    : 'var(--background)',
                                  color: pickup.sync_to_work_calendar
                                    ? 'var(--color-sage)'
                                    : 'var(--muted)',
                                  border: '1px solid var(--border)',
                                }}
                                title={pickup.sync_to_work_calendar ? t.week.removeFromWorkCalendar : t.week.sendToWorkCalendar}
                              >
                                {syncingPickupId === pickup.id ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                                    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12"/>
                                  </svg>
                                ) : (
                                  <>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                      <line x1="16" y1="2" x2="16" y2="6"/>
                                      <line x1="8" y1="2" x2="8" y2="6"/>
                                      <line x1="3" y1="10" x2="21" y2="10"/>
                                    </svg>
                                    {pickup.sync_to_work_calendar ? '✓' : ''}
                                  </>
                                )}
                              </button>
                            )}
                          </>
                        ) : (
                          <div className="text-center">
                            {(() => {
                              const holiday = holidaysByDate.get(formatDateISO(date))
                              const isNonWorkingDay = isWeekend(date) || !!holiday
                              const hasPicker = !!pickup?.picker

                              if (hasPicker) {
                                return (
                                  <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                                    {pickup.picker?.short_name || pickup.picker?.name}
                                  </span>
                                )
                              }

                              // No picker assigned
                              if (isNonWorkingDay) {
                                // Weekend/holiday - just show dash, no warning
                                return (
                                  <span className="text-sm" style={{ color: 'var(--muted)', opacity: 0.5 }}>
                                    —
                                  </span>
                                )
                              }

                              // Weekday without pickup - show warning
                              return (
                                <span className="text-xs" style={{ color: 'var(--color-coral)', opacity: 0.8 }}>
                                  {t.week.noPickup}
                                </span>
                              )
                            })()}
                          </div>
                        )}

                        {/* Child tasks */}
                        {tasks.length > 0 && (() => {
                          const taskCellKey = `tasks-${child.id}-${dateStr}`
                          const isExpanded = expandedCells.has(taskCellKey)
                          const displayTasks = isExpanded ? tasks : tasks.slice(0, 2)
                          return (
                            <div className="space-y-0.5 pt-1 border-t border-dashed" style={{ borderColor: 'var(--border)' }}>
                              {displayTasks.map((task) => {
                                const config = getTaskConfig(task.task_type as ChildTaskType)
                                const isDone = task.status === 'done'
                                return (
                                  <button
                                    key={task.id}
                                    onClick={() => onTaskClick?.(task)}
                                    className="w-full flex items-center gap-1 text-xs py-0.5 px-1 rounded transition-colors text-left touch-feedback"
                                    style={{
                                      background: isDone ? 'transparent' : 'rgba(229, 185, 94, 0.15)',
                                      color: isDone ? 'var(--muted)' : 'var(--foreground)',
                                      textDecoration: isDone ? 'line-through' : 'none',
                                      opacity: isDone ? 0.6 : 1,
                                    }}
                                    title={task.notes || task.title}
                                  >
                                    <span className="flex-shrink-0">{config.icon}</span>
                                    <span className="truncate">{task.title}</span>
                                  </button>
                                )
                              })}
                              {tasks.length > 2 && (
                                <button
                                  onClick={() => toggleCellExpansion(taskCellKey)}
                                  className="text-xs hover:underline cursor-pointer"
                                  style={{ color: 'var(--muted)' }}
                                >
                                  {isExpanded
                                    ? t.week.showLess || 'Vis mindre'
                                    : t.week.more.replace('{count}', String(tasks.length - 2))}
                                </button>
                              )}
                            </div>
                          )
                        })()}

                        {/* External events (Spond, Kidplan, etc.) */}
                        {extEvents.length > 0 && (() => {
                          const eventCellKey = `ext-${child.id}-${dateStr}`
                          const isExpanded = expandedCells.has(eventCellKey)
                          const displayEvents = isExpanded ? extEvents : extEvents.slice(0, 2)
                          return (
                            <div className="space-y-0.5 pt-1 border-t border-dashed" style={{ borderColor: 'rgba(126, 182, 196, 0.4)' }}>
                              {displayEvents.map((event) => {
                                const closure = isSchoolClosure(event)
                                return (
                                  <button
                                    key={event.id}
                                    onClick={() => onExternalEventClick?.(event)}
                                    className="w-full flex items-center gap-1 text-xs py-0.5 px-1 rounded transition-colors text-left touch-feedback"
                                    style={{
                                      background: closure ? 'rgba(178, 154, 198, 0.2)' : 'rgba(126, 182, 196, 0.15)',
                                      color: 'var(--foreground)',
                                    }}
                                    title={`[${getServiceBadge(event)}] ${event.title}${event.event_time ? ` kl ${event.event_time.substring(0, 5)}` : ''}`}
                                  >
                                    {closure ? (
                                      <span className="flex-shrink-0">🏫</span>
                                    ) : (
                                      <span className="flex-shrink-0 text-[10px] px-1 rounded" style={{ background: 'var(--color-sky)', color: 'white' }}>
                                        {getServiceBadge(event).substring(0, 1)}
                                      </span>
                                    )}
                                    <span className="truncate">{event.title}</span>
                                    {event.event_time && !closure && (
                                      <span className="flex-shrink-0 text-[10px]" style={{ color: 'var(--muted)' }}>
                                        {event.event_time.substring(0, 5)}
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                              {extEvents.length > 2 && (
                                <button
                                  onClick={() => toggleCellExpansion(eventCellKey)}
                                  className="text-xs hover:underline cursor-pointer"
                                  style={{ color: 'var(--muted)' }}
                                >
                                  {isExpanded
                                    ? t.week.showLess || 'Vis mindre'
                                    : t.week.more.replace('{count}', String(extEvents.length - 2))}
                                </button>
                              )}
                            </div>
                          )
                        })()}

                        {/* Add task button (editable mode) */}
                        {editable && onAddTask && (
                          <button
                            onClick={() => onAddTask(child.id, dateStr)}
                            className="w-full flex items-center justify-center gap-1 text-xs py-0.5 px-1 rounded transition-colors opacity-50 hover:opacity-100"
                            style={{ color: 'var(--muted)' }}
                            title={t.week.addTask}
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="12" y1="5" x2="12" y2="19"/>
                              <line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}

            {/* Calendar section (Family + Parent events) */}
            {(householdEvents.length > 0 || parentMembers.length > 0) && (
              <>
                {/* Separator row */}
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-2 text-xs font-medium"
                    style={{ color: 'var(--muted)', background: 'var(--background)' }}
                  >
                    {t.week.calendar}
                  </td>
                </tr>

                {/* Family/Household events row - only show if there are events */}
                {householdEvents.length > 0 && (
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
                          style={{
                            background: 'rgba(167, 139, 250, 0.2)',
                            color: '#a78bfa'
                          }}
                        >
                          🏠
                        </div>
                        <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                          {t.week.family || 'Familien'}
                        </span>
                      </div>
                    </td>
                    {weekDates.map((date, i) => {
                      const events = getHouseholdEventsForDate(date)

                      return (
                        <td
                          key={i}
                          className="p-2 text-center"
                          style={{
                            background: isToday(date)
                              ? 'rgba(167, 139, 250, 0.08)'
                              : isWeekend(date)
                              ? 'var(--background)'
                              : undefined,
                          }}
                        >
                          {events.length > 0 ? (() => {
                            const cellKey = `household-${formatDateISO(date)}`
                            const isExpanded = expandedCells.has(cellKey)
                            const displayEvents = isExpanded ? events : events.slice(0, 2)
                            return (
                              <div className="flex flex-col gap-1">
                                {displayEvents.map((event) => (
                                  <button
                                    key={event.id}
                                    onClick={() => onHouseholdEventClick?.(event)}
                                    className="group flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all hover:scale-105 text-left"
                                    style={{
                                      background: 'rgba(167, 139, 250, 0.2)',
                                      opacity: event.is_redistributed ? 0.5 : 1,
                                    }}
                                    title={event.title}
                                  >
                                    <span className="shrink-0">🏠</span>
                                    <span
                                      className="truncate min-w-0"
                                      style={{ color: '#a78bfa' }}
                                    >
                                      {event.event_time && (
                                        <span className="font-medium">
                                          {event.event_time.substring(0, 5)}{' '}
                                        </span>
                                      )}
                                      <span className="hidden sm:inline">{event.title}</span>
                                      <span className="sm:hidden">{event.title.substring(0, 15)}{event.title.length > 15 ? '…' : ''}</span>
                                    </span>
                                    {event.is_redistributed && (
                                      <span className="shrink-0 text-[10px]" title="Redistribuert">↗</span>
                                    )}
                                  </button>
                                ))}
                                {events.length > 2 && (
                                  <button
                                    onClick={() => toggleCellExpansion(cellKey)}
                                    className="text-xs hover:underline cursor-pointer"
                                    style={{ color: 'var(--muted)' }}
                                  >
                                    {isExpanded
                                      ? t.week.showLess || 'Vis mindre'
                                      : `+${events.length - 2}`}
                                  </button>
                                )}
                              </div>
                            )
                          })() : null}
                        </td>
                      )
                    })}
                  </tr>
                )}

                {/* Parent events rows */}
                {parentMembers.map((member) => (
                  <tr key={`event-${member.id}`} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
                          style={{
                            background: 'rgba(167, 139, 250, 0.2)',
                            color: '#a78bfa'
                          }}
                        >
                          {member.short_name?.charAt(0) || member.name.charAt(0)}
                        </div>
                        <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                          {member.short_name || member.name}
                        </span>
                      </div>
                    </td>
                    {weekDates.map((date, i) => {
                      const events = getEventsForMemberDate(member.id, date)

                      return (
                        <td
                          key={i}
                          className="p-2 text-center"
                          style={{
                            background: isToday(date)
                              ? 'rgba(167, 139, 250, 0.08)'
                              : isWeekend(date)
                              ? 'var(--background)'
                              : undefined,
                          }}
                        >
                          {events.length > 0 ? (() => {
                            const memberEventKey = `member-${member.id}-${formatDateISO(date)}`
                            const isExpanded = expandedCells.has(memberEventKey)
                            const displayEvents = isExpanded ? events : events.slice(0, 2)
                            return (
                              <div className="flex flex-col gap-1">
                                {displayEvents.map((event) => {
                                  const config = getEventConfig(event.event_type as MemberEventType)
                                  return (
                                    <button
                                      key={event.id}
                                      onClick={() => onEventClick?.(event)}
                                      className="group flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all hover:scale-105 text-left"
                                      style={{ background: config.bg }}
                                      title={event.title}
                                    >
                                      <span className="shrink-0">{config.icon}</span>
                                      <span
                                        className="truncate min-w-0"
                                        style={{ color: config.text }}
                                      >
                                        {event.event_time && (
                                          <span className="font-medium">
                                            {event.event_time.substring(0, 5)}{' '}
                                          </span>
                                        )}
                                        <span className="hidden sm:inline">{event.title}</span>
                                        <span className="sm:hidden">{event.title.substring(0, 15)}{event.title.length > 15 ? '…' : ''}</span>
                                      </span>
                                    </button>
                                  )
                                })}
                                {events.length > 2 && (
                                  <button
                                    onClick={() => toggleCellExpansion(memberEventKey)}
                                    className="text-xs hover:underline cursor-pointer"
                                    style={{ color: 'var(--muted)' }}
                                  >
                                    {isExpanded
                                      ? t.week.showLess || 'Vis mindre'
                                      : t.week.more.replace('{count}', String(events.length - 2))}
                                  </button>
                                )}
                              </div>
                            )
                          })() : (
                            <span className="text-sm" style={{ color: 'var(--muted)', opacity: 0.3 }}>
                              -
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </>
            )}

            {/* Meal row */}
            <tr style={{ background: 'rgba(229, 185, 94, 0.08)' }}>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ background: 'var(--color-honey)', color: 'white' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
                      <path d="M7 2v20"/>
                      <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
                    </svg>
                  </div>
                  <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                    {t.home.meal}
                  </span>
                </div>
              </td>
              {weekDates.map((date, i) => {
                const meal = getMeal(date)
                const dateStr = formatDateISO(date)

                return (
                  <td
                    key={i}
                    className="p-2 text-center"
                    style={{
                      background: isToday(date) ? 'rgba(229, 185, 94, 0.15)' : undefined,
                    }}
                  >
                    {editable ? (
                      <MealSelector
                        value={meal?.recipe?.name || meal?.custom_meal || ''}
                        recipes={recipes}
                        onChange={(value, recipeId) => onMealChange?.(dateStr, value || null, recipeId)}
                        onRequestAISuggestion={onRequestAISuggestion ? () => onRequestAISuggestion(dateStr) : undefined}
                        placeholder="..."
                      />
                    ) : (
                      <span
                        className="text-sm block truncate max-w-full"
                        style={{
                          color: meal ? 'var(--foreground)' : 'var(--muted)',
                          opacity: meal ? 1 : 0.5,
                        }}
                        title={meal?.recipe?.name || meal?.custom_meal || undefined}
                      >
                        {meal?.recipe?.name || meal?.custom_meal || '-'}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
})
