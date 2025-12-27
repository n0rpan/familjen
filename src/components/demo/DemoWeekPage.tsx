'use client'

/**
 * DemoWeekPage Component
 *
 * Client-side version of the week page that uses demo data hooks.
 * Rendered when ?demo=true is in the URL.
 */

import { useState, useMemo } from 'react'
import { useWeekData } from '@/hooks/data'
import { WeekGrid } from '@/components/WeekGrid'
import { TransitionLink } from '@/components/TransitionLink'
import { useLanguage } from '@/lib/i18n/context'
import { formatWeekHeaderLocalized } from '@/lib/utils'
import dynamic from 'next/dynamic'
import { nb, sv } from 'react-day-picker/locale'
import 'react-day-picker/style.css'

// Dynamic imports for code splitting
const DayPicker = dynamic(
  () => import('react-day-picker').then(mod => mod.DayPicker),
  { ssr: false, loading: () => <div className="p-4 text-center text-sm" style={{ color: 'var(--muted)' }}>...</div> }
)

export function DemoWeekPage() {
  const { language, t } = useLanguage()
  const [weekOffset, setWeekOffset] = useState(0)
  const [showCalendar, setShowCalendar] = useState(false)

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
      />
    </div>
  )
}
