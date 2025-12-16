'use client'

import { useState, useMemo, useCallback } from 'react'
import { WeekGrid } from './WeekGrid'
import { DayView } from './DayView'
import { getWeekDates, getWeekStart, formatDateISO } from '@/lib/utils'
import type { Child, HouseholdMember, PickupWithDetails, MealWithRecipe } from '@/lib/types'

interface ResponsiveWeekViewProps {
  children: Child[]
  members: HouseholdMember[]
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
  weekStart?: Date | string  // May be serialized as string from server components
  editable?: boolean
  onPickupChange?: (childId: string, date: string, pickerId: string | null) => void
  onMealChange?: (date: string, mealName: string | null) => void
}

export function ResponsiveWeekView({
  children,
  members,
  pickups,
  meals,
  weekStart: providedWeekStart,
  editable = false,
  onPickupChange,
  onMealChange,
}: ResponsiveWeekViewProps) {
  // Ensure weekStart is a Date object (it may be serialized as string from server)
  const weekStart = useMemo(() => {
    if (!providedWeekStart) return getWeekStart(new Date())
    return providedWeekStart instanceof Date ? providedWeekStart : new Date(providedWeekStart)
  }, [providedWeekStart])

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart])

  // Track which day is selected for mobile view (0-6, Monday to Sunday)
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => {
    // Default to today if it's in the current week, otherwise Monday
    const today = new Date()
    const todayStr = formatDateISO(today)
    const todayIndex = weekDates.findIndex(d => formatDateISO(d) === todayStr)
    return todayIndex >= 0 ? todayIndex : 0
  })

  const selectedDate = weekDates[selectedDayIndex]

  const handlePreviousDay = useCallback(() => {
    setSelectedDayIndex(prev => Math.max(0, prev - 1))
  }, [])

  const handleNextDay = useCallback(() => {
    setSelectedDayIndex(prev => Math.min(6, prev + 1))
  }, [])

  return (
    <>
      {/* Mobile: Day view (hidden on md+) */}
      <div className="md:hidden">
        <DayView
          date={selectedDate}
          children={children}
          members={members}
          pickups={pickups}
          meals={meals}
          editable={editable}
          onPickupChange={onPickupChange}
          onMealChange={onMealChange}
          onPreviousDay={handlePreviousDay}
          onNextDay={handleNextDay}
          canGoPrevious={selectedDayIndex > 0}
          canGoNext={selectedDayIndex < 6}
        />

        {/* Day indicators */}
        <div className="flex justify-center gap-1.5 mt-4">
          {weekDates.map((_, index) => (
            <button
              key={index}
              onClick={() => setSelectedDayIndex(index)}
              className="w-2 h-2 rounded-full transition-all"
              style={{
                background: index === selectedDayIndex
                  ? 'var(--accent)'
                  : 'var(--border)',
                transform: index === selectedDayIndex ? 'scale(1.2)' : 'scale(1)',
              }}
              aria-label={`Gå til dag ${index + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Desktop: Grid view (hidden on mobile) */}
      <div className="hidden md:block">
        <WeekGrid
          children={children}
          members={members}
          pickups={pickups}
          meals={meals}
          weekStart={weekStart}
          editable={editable}
          onPickupChange={onPickupChange}
          onMealChange={onMealChange}
        />
      </div>
    </>
  )
}
