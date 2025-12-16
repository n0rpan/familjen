'use client'

import { useMemo } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import {
  formatDateISO,
  isToday,
  cn,
} from '@/lib/utils'
import type { Child, HouseholdMember, PickupWithDetails, MealWithRecipe } from '@/lib/types'
import { getChildColor } from '@/lib/colors'

interface DayViewProps {
  date: Date
  children: Child[]
  members: HouseholdMember[]
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
  editable?: boolean
  onPickupChange?: (childId: string, date: string, pickerId: string | null) => void
  onMealChange?: (date: string, mealName: string | null) => void
  onPreviousDay?: () => void
  onNextDay?: () => void
  canGoPrevious?: boolean
  canGoNext?: boolean
}

export function DayView({
  date,
  children,
  members,
  pickups,
  meals,
  editable = false,
  onPickupChange,
  onMealChange,
  onPreviousDay,
  onNextDay,
  canGoPrevious = true,
  canGoNext = true,
}: DayViewProps) {
  const { language, t } = useLanguage()
  const dateStr = formatDateISO(date)
  const dayOfWeek = date.getDay()
  const dayName = t.date.weekdays[dayOfWeek === 0 ? 6 : dayOfWeek - 1]
  const today = isToday(date)

  const pickupMap = useMemo(() => {
    const map = new Map<string, PickupWithDetails>()
    pickups.forEach((p) => {
      if (p.date === dateStr) {
        map.set(p.child_id, p)
      }
    })
    return map
  }, [pickups, dateStr])

  const meal = useMemo(() => {
    return meals.find((m) => m.date === dateStr)
  }, [meals, dateStr])

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Header with navigation */}
      <div
        className="flex items-center justify-between px-4 py-4"
        style={{
          borderBottom: '1px solid var(--border)',
          background: today ? 'rgba(232, 120, 109, 0.08)' : undefined,
        }}
      >
        <button
          onClick={onPreviousDay}
          disabled={!canGoPrevious}
          className={cn(
            'w-11 h-11 rounded-full flex items-center justify-center transition-colors',
            canGoPrevious ? 'active:bg-[var(--sand)]' : 'opacity-30'
          )}
          style={{ color: 'var(--foreground)' }}
          aria-label={t.common.previousDay}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div className="text-center">
          <div className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>
            {dayName}
          </div>
          <div
            className={cn('text-sm', today && 'font-semibold')}
            style={{ color: today ? 'var(--accent)' : 'var(--muted)' }}
          >
            {date.getDate()}. {t.date.monthsShort[date.getMonth()]}
            {today && ` (${t.common.today.toLowerCase()})`}
          </div>
        </div>

        <button
          onClick={onNextDay}
          disabled={!canGoNext}
          className={cn(
            'w-11 h-11 rounded-full flex items-center justify-center transition-colors',
            canGoNext ? 'active:bg-[var(--sand)]' : 'opacity-30'
          )}
          style={{ color: 'var(--foreground)' }}
          aria-label={t.common.nextDay}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      {/* Children pickups */}
      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {children.map((child, index) => {
          const pickup = pickupMap.get(child.id)
          return (
            <div key={child.id} className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                  style={{
                    background: getChildColor(child.color).bg,
                    color: getChildColor(child.color).text,
                  }}
                >
                  {child.name.charAt(0)}
                </div>
                <div>
                  <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {child.name}
                  </div>
                  {child.location_name && (
                    <div className="text-sm" style={{ color: 'var(--muted)' }}>
                      {child.location_name}
                    </div>
                  )}
                </div>
              </div>

              {editable ? (
                <select
                  value={pickup?.picker_id || ''}
                  onChange={(e) => onPickupChange?.(child.id, dateStr, e.target.value || null)}
                  className="w-full text-base p-3 rounded-xl transition-colors min-h-[48px]"
                  style={{
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    color: 'var(--foreground)',
                  }}
                >
                  <option value="">{t.week.selectPickerPrompt}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  className="flex items-center gap-2 p-3 rounded-xl"
                  style={{ background: 'var(--background)' }}
                >
                  {pickup?.picker ? (
                    <>
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
                        style={{ background: 'var(--color-sage)', color: 'white' }}
                      >
                        {pickup.picker.name.charAt(0)}
                      </div>
                      <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                        {t.home.picksUp.replace('{name}', pickup.picker.name)}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>{t.week.notAssigned}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Meal section */}
        <div className="p-4" style={{ background: 'rgba(229, 185, 94, 0.08)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'var(--color-honey)', color: 'white' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
                <path d="M7 2v20"/>
                <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
              </svg>
            </div>
            <div className="font-medium" style={{ color: 'var(--foreground)' }}>
              {t.home.meal}
            </div>
          </div>

          {editable ? (
            <input
              type="text"
              value={meal?.recipe?.name || meal?.custom_meal || ''}
              onChange={(e) => onMealChange?.(dateStr, e.target.value || null)}
              placeholder={t.week.mealPlaceholder}
              className="w-full text-base p-3 rounded-xl min-h-[48px]"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
            />
          ) : (
            <div
              className="p-3 rounded-xl"
              style={{ background: 'var(--card)' }}
            >
              <span
                style={{
                  color: meal ? 'var(--foreground)' : 'var(--muted)',
                  fontWeight: meal ? 500 : 400,
                }}
              >
                {meal?.recipe?.name || meal?.custom_meal || t.home.noMealPlanned}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
