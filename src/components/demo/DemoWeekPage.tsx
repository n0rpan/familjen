'use client'

/**
 * DemoWeekPage Component
 *
 * Client-side version of the week page that uses demo data hooks.
 * Rendered when ?demo=true is in the URL.
 */

import { useState, useCallback } from 'react'
import { useWeekData } from '@/hooks/data'
import { WeekGrid } from '@/components/WeekGrid'
import { TransitionLink } from '@/components/TransitionLink'
import { useLanguage } from '@/lib/i18n/context'
import { formatWeekHeaderLocalized } from '@/lib/utils'
import { getEventConfig, getTaskConfig } from '@/lib/colors'
import type { MemberEvent, HouseholdEvent, ExternalEvent, ChildTask } from '@/lib/types'
import dynamic from 'next/dynamic'
import { nb, sv } from 'react-day-picker/locale'
import 'react-day-picker/style.css'

// Dynamic imports for code splitting
const DayPicker = dynamic(
  () => import('react-day-picker').then(mod => mod.DayPicker),
  { ssr: false, loading: () => <div className="p-4 text-center text-sm" style={{ color: 'var(--muted)' }}>...</div> }
)

// Types for detail modal
type DetailModalContent =
  | { type: 'member'; event: MemberEvent }
  | { type: 'household'; event: HouseholdEvent }
  | { type: 'external'; event: ExternalEvent }
  | { type: 'task'; task: ChildTask }
  | null

export function DemoWeekPage() {
  const { language, t } = useLanguage()
  const [weekOffset, setWeekOffset] = useState(0)
  const [showCalendar, setShowCalendar] = useState(false)
  const [detailModal, setDetailModal] = useState<DetailModalContent>(null)

  const weekData = useWeekData({ weekOffset })

  const {
    household,
    children,
    members,
    pickups,
    meals,
    recipes,
    tasks,
    memberEvents,
    householdEvents,
    externalEvents,
    holidays,
    weekStart,
    loading,
    error,
    updatePickup,
    updateMeal,
  } = weekData

  // Navigate weeks
  const goToPreviousWeek = () => setWeekOffset(prev => prev - 1)
  const goToNextWeek = () => setWeekOffset(prev => prev + 1)
  const goToToday = () => setWeekOffset(0)

  // Calendar selection
  const handleCalendarSelect = (date: Date | undefined) => {
    if (!date) return
    const today = new Date()
    const todayWeekStart = new Date(today)
    const dayOfWeek = today.getDay()
    todayWeekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))

    const selectedWeekStart = new Date(date)
    const selectedDayOfWeek = date.getDay()
    selectedWeekStart.setDate(date.getDate() - (selectedDayOfWeek === 0 ? 6 : selectedDayOfWeek - 1))

    const diffTime = selectedWeekStart.getTime() - todayWeekStart.getTime()
    const diffWeeks = Math.round(diffTime / (7 * 24 * 60 * 60 * 1000))

    setWeekOffset(diffWeeks)
    setShowCalendar(false)
  }

  // Event click handlers (view-only in demo mode)
  const handleMemberEventClick = useCallback((event: MemberEvent) => {
    setDetailModal({ type: 'member', event })
  }, [])

  const handleHouseholdEventClick = useCallback((event: HouseholdEvent) => {
    setDetailModal({ type: 'household', event })
  }, [])

  const handleExternalEventClick = useCallback((event: ExternalEvent) => {
    setDetailModal({ type: 'external', event })
  }, [])

  const handleTaskClick = useCallback((task: ChildTask) => {
    setDetailModal({ type: 'task', task })
  }, [])

  const closeDetailModal = useCallback(() => {
    setDetailModal(null)
  }, [])

  // Get week header
  const weekHeader = formatWeekHeaderLocalized(weekStart, language)

  // Show loading state
  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.nav.weekPlan}
          </h1>
        </div>
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div className="animate-pulse">
            <div className="h-8 w-48 bg-gray-200 rounded mx-auto mb-4" />
            <div className="h-4 w-32 bg-gray-200 rounded mx-auto" />
          </div>
        </div>
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.nav.weekPlan}
          </h1>
        </div>
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header with week navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <TransitionLink href="/?demo=true">
            <button
              className="p-2 rounded-lg transition-colors hover:bg-gray-100"
              style={{ color: 'var(--muted)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          </TransitionLink>
          <h1 className="text-2xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.nav.weekPlan}
          </h1>
        </div>

        {/* Week selector */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousWeek}
            className="p-2 rounded-lg transition-colors hover:bg-gray-100"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>

          <button
            onClick={() => setShowCalendar(!showCalendar)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-gray-100"
            style={{ color: 'var(--foreground)' }}
          >
            {weekHeader}
          </button>

          <button
            onClick={goToNextWeek}
            className="p-2 rounded-lg transition-colors hover:bg-gray-100"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          {weekOffset !== 0 && (
            <button
              onClick={goToToday}
              className="px-3 py-1 text-xs font-medium rounded-full transition-colors"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              {t.common.today}
            </button>
          )}
        </div>
      </div>

      {/* Calendar popup */}
      {showCalendar && (
        <div
          className="absolute z-50 mt-2 rounded-xl shadow-lg p-4"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <DayPicker
            mode="single"
            selected={weekStart}
            onSelect={handleCalendarSelect}
            locale={language === 'nb' ? nb : language === 'sv' ? sv : undefined}
            showOutsideDays
            weekStartsOn={1}
          />
        </div>
      )}

      {/* Week Grid */}
      <WeekGrid
        children={children}
        members={members}
        pickups={pickups}
        meals={meals}
        memberEvents={memberEvents}
        holidays={holidays}
        weekStart={weekStart}
        editable
        onPickupChange={async (childId, date, pickerId) => {
          await updatePickup(childId, date, pickerId)
        }}
        onMealChange={async (date, customMeal, recipeId) => {
          await updateMeal(date, recipeId ?? null, customMeal)
        }}
        recipes={recipes}
        childTasks={tasks}
        householdEvents={householdEvents}
        externalEvents={externalEvents}
        onEventClick={handleMemberEventClick}
        onHouseholdEventClick={handleHouseholdEventClick}
        onExternalEventClick={handleExternalEventClick}
        onTaskClick={handleTaskClick}
      />

      {/* Detail Modal (view-only) */}
      {detailModal && (
        <DemoDetailModal
          content={detailModal}
          members={members}
          children={children}
          t={t}
          onClose={closeDetailModal}
        />
      )}
    </div>
  )
}

/**
 * Simple view-only detail modal for demo mode
 */
function DemoDetailModal({
  content,
  members,
  children: childrenList,
  t,
  onClose,
}: {
  content: NonNullable<DetailModalContent>
  members: { id: string; name: string }[]
  children: { id: string; name: string }[]
  t: ReturnType<typeof useLanguage>['t']
  onClose: () => void
}) {
  // Get display info based on content type
  let title = ''
  let subtitle = ''
  let date = ''
  let time = ''
  let location = ''
  let notes = ''
  let config: { bg: string; text: string; icon: string } | null = null

  if (content.type === 'member') {
    const event = content.event
    const member = members.find(m => m.id === event.member_id)
    title = event.title
    subtitle = member?.name || t.common.unknown
    date = event.date + (event.end_date && event.end_date !== event.date ? ` → ${event.end_date}` : '')
    config = getEventConfig(event.event_type)
  } else if (content.type === 'household') {
    const event = content.event
    title = event.title
    subtitle = t.week.familyEvent
    date = event.event_date + (event.end_date && event.end_date !== event.event_date ? ` → ${event.end_date}` : '')
    time = event.event_time?.substring(0, 5) || ''
    location = event.location || ''
    config = { bg: 'rgba(168, 162, 158, 0.2)', text: 'var(--foreground)', icon: '🏠' }
  } else if (content.type === 'external') {
    const event = content.event
    title = event.title
    subtitle = event.integration?.display_name || event.integration?.service || t.common.external
    date = event.event_date + (event.end_date && event.end_date !== event.event_date ? ` → ${event.end_date}` : '')
    time = event.event_time?.substring(0, 5) || ''
    location = event.location || ''
    config = { bg: 'rgba(126, 182, 196, 0.2)', text: 'var(--color-sky)', icon: '📅' }
  } else if (content.type === 'task') {
    const task = content.task
    const child = childrenList.find(c => c.id === task.child_id)
    const taskConfig = getTaskConfig(task.task_type)
    title = task.title
    subtitle = child?.name || t.common.unknown
    date = task.date
    time = task.time?.substring(0, 5) || ''
    notes = task.notes || ''
    config = { bg: 'rgba(229, 185, 94, 0.2)', text: 'var(--color-honey)', icon: taskConfig.icon }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] rounded-2xl p-6 space-y-4 animate-fade-in overflow-y-auto overflow-x-hidden"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header with icon */}
        <div className="flex items-start gap-3">
          {config && (
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
              style={{ background: config.bg }}
            >
              {config.icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
              {title}
            </h3>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {subtitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-gray-100"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Details */}
        <div className="space-y-3">
          {date && (
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: 'var(--muted)' }}>📅</span>
              <span style={{ color: 'var(--foreground)' }}>{date}</span>
            </div>
          )}
          {time && (
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: 'var(--muted)' }}>🕐</span>
              <span style={{ color: 'var(--foreground)' }}>{time}</span>
            </div>
          )}
          {location && (
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: 'var(--muted)' }}>📍</span>
              <span style={{ color: 'var(--foreground)' }}>{location}</span>
            </div>
          )}
          {notes && (
            <div className="text-sm p-3 rounded-lg" style={{ background: 'var(--sand)', color: 'var(--foreground)' }}>
              {notes}
            </div>
          )}
        </div>

        {/* Demo mode notice */}
        <div
          className="text-xs text-center py-2 px-3 rounded-lg"
          style={{ background: 'var(--sand)', color: 'var(--muted)' }}
        >
          {t.common.demoMode} - {t.common.viewOnly}
        </div>
      </div>
    </div>
  )
}
