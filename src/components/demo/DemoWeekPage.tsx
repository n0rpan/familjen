'use client'

/**
 * DemoWeekPage Component
 *
 * Client-side wrapper that uses demo data hooks and renders
 * the same UI structure as the production week page.
 * This ensures demo and production are visually identical.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useWeekData } from '@/hooks/data'
import { WeekGrid } from '@/components/WeekGrid'
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
  const [showWeekPicker, setShowWeekPicker] = useState(false)
  const [showWeekContext, setShowWeekContext] = useState(false)
  const [weekContext, setWeekContext] = useState('')
  const [detailModal, setDetailModal] = useState<DetailModalContent>(null)
  const weekPickerRef = useRef<HTMLDivElement>(null)

  const weekData = useWeekData({ weekOffset })

  const {
    household,
    children,
    members,
    pickups,
    meals,
    recipes,
    tasks: childTasks,
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

  // Close week picker on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (weekPickerRef.current && !weekPickerRef.current.contains(event.target as Node)) {
        setShowWeekPicker(false)
      }
    }
    if (showWeekPicker) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showWeekPicker])

  // Calendar selection
  const handleWeekSelect = useCallback((date: Date | undefined) => {
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
    setShowWeekPicker(false)
  }, [])

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

  // Show loading state
  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
              {t.week.title}
            </h1>
            <p className="mt-1" style={{ color: 'var(--muted)' }}>
              {t.week.editPickup}
            </p>
          </div>
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
              {t.week.title}
            </h1>
            <p className="mt-1" style={{ color: 'var(--muted)' }}>
              {t.week.editPickup}
            </p>
          </div>
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
      {/* Header with week navigation - SAME AS PRODUCTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.week.title}
          </h1>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            {t.week.editPickup}
          </p>
        </div>

        <div className="flex items-center gap-2 relative" ref={weekPickerRef}>
          <button
            onClick={() => setWeekOffset(weekOffset - 1)}
            className="p-2 rounded-xl transition-colors"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            aria-label={t.common.back}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <button
            onClick={() => setShowWeekPicker(!showWeekPicker)}
            className="px-4 py-2 text-sm font-medium rounded-xl transition-colors hover:opacity-80"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            {formatWeekHeaderLocalized(weekStart, language)}
          </button>
          <button
            onClick={() => setWeekOffset(weekOffset + 1)}
            className="p-2 rounded-xl transition-colors"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            aria-label={t.common.next}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="px-3 py-2 text-sm font-medium rounded-xl transition-colors"
              style={{ color: 'var(--accent)' }}
            >
              {t.common.today}
            </button>
          )}

          {/* Week picker dropdown */}
          {showWeekPicker && (
            <div
              className="absolute top-full mt-2 left-0 z-50 rounded-xl shadow-lg animate-fade-in"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <DayPicker
                mode="single"
                selected={weekStart}
                onSelect={handleWeekSelect}
                weekStartsOn={1}
                showOutsideDays
                locale={language === 'nb' ? nb : language === 'sv' ? sv : undefined}
                classNames={{
                  root: 'p-3',
                  month_caption: 'flex justify-center py-2 font-semibold',
                  nav: 'flex items-center justify-between absolute top-3 left-3 right-3',
                  button_previous: 'p-1 rounded hover:bg-[var(--background)]',
                  button_next: 'p-1 rounded hover:bg-[var(--background)]',
                  month_grid: 'w-full border-collapse',
                  weekdays: 'flex',
                  weekday: 'text-muted text-xs font-medium w-9 text-center',
                  week: 'flex',
                  day: 'w-9 h-9 text-center text-sm',
                  day_button: 'w-full h-full rounded-lg hover:bg-[var(--background)] transition-colors',
                  selected: 'bg-[var(--accent)] text-white rounded-lg',
                  today: 'font-bold text-[var(--accent)]',
                  outside: 'text-[var(--muted)] opacity-50',
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Week Context + Action Buttons - SAME AS PRODUCTION */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        {/* Week context toggle */}
        <div className="flex-1">
          <button
            onClick={() => setShowWeekContext(!showWeekContext)}
            className="flex items-center gap-2 text-sm font-medium transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            {showWeekContext ? t.common.close : t.common.add} {t.week.weekContext?.toLowerCase?.() ?? 'ukekontekst'}
            {weekContext && !showWeekContext && (
              <span className="inline-flex items-center justify-center w-2 h-2 rounded-full" style={{ background: 'var(--color-sage)' }} />
            )}
          </button>

          {showWeekContext && (
            <div className="mt-3 space-y-2">
              <textarea
                value={weekContext}
                onChange={(e) => setWeekContext(e.target.value)}
                placeholder={t.week.weekContextPlaceholder ?? 'Skriv notater for denne uken...'}
                rows={2}
                className="input text-sm resize-none"
              />
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {t.common.demoMode ?? 'Demo'} - {t.common.viewOnly ?? 'kun visning'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons - SAME AS PRODUCTION */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Copy last week */}
          <button
            disabled
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors opacity-50"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
            title={t.week.copyLastWeek ?? 'Kopier forrige uke'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>

          {/* Clear week */}
          <button
            disabled
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors opacity-50"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
            }}
            title={t.week.clearWeek ?? 'Tøm uken'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>

          {/* Quick pickup button */}
          <button
            disabled
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors opacity-50"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--color-sage)',
            }}
            title={t.week.quickPickup ?? 'Hurtigtildeling'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <polyline points="16 11 18 13 22 9"/>
            </svg>
          </button>

          {/* AI Suggestion button */}
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all opacity-50"
            style={{
              background: 'linear-gradient(135deg, var(--color-honey) 0%, #D4A84B 100%)',
              color: 'white',
              boxShadow: '0 2px 8px rgba(229, 185, 94, 0.3)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 10 10.5v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
              <path d="M12 12v2"/>
              <path d="M10 22h4"/>
              <path d="M10 18h4v4h-4z"/>
            </svg>
            {t.week.getAiSuggestions ?? 'Foreslå middager'}
          </button>
        </div>
      </div>

      {/* Add event button - SAME AS PRODUCTION */}
      <div className="flex items-center gap-4">
        <button
          disabled
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors opacity-50"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
            <line x1="12" y1="14" x2="12" y2="18"/>
            <line x1="10" y1="16" x2="14" y2="16"/>
          </svg>
          {t.week.addEvent ?? 'Legg til hendelse'}
        </button>
        {(memberEvents.length > 0 || householdEvents.length > 0) && (
          <span className="text-sm" style={{ color: 'var(--muted)' }}>
            {memberEvents.length + householdEvents.length} {(memberEvents.length + householdEvents.length) === 1 ? t.home.event : t.home.events}
          </span>
        )}
      </div>

      {/* Week Grid - SAME AS PRODUCTION */}
      <WeekGrid
        children={children}
        members={members}
        pickups={pickups}
        meals={meals}
        memberEvents={memberEvents}
        householdEvents={householdEvents}
        externalEvents={externalEvents}
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
        childTasks={childTasks}
        onEventClick={handleMemberEventClick}
        onHouseholdEventClick={handleHouseholdEventClick}
        onExternalEventClick={handleExternalEventClick}
        onTaskClick={handleTaskClick}
      />

      {/* Tips - SAME AS PRODUCTION */}
      <div
        className="flex items-start gap-3 p-4 rounded-xl"
        style={{ background: 'rgba(126, 182, 196, 0.15)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-sky)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{t.week.editPickup}</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.week.selectPicker ?? 'Klikk på en celle for å velge hvem som henter'}
          </p>
        </div>
      </div>

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
    subtitle = t.week.familyEvent ?? 'Familiehendelse'
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
      </div>
    </div>
  )
}
