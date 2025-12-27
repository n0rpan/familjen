'use client'

/**
 * DemoHomePage Component
 *
 * Client-side version of the home page that uses demo data hooks.
 * Rendered when ?demo=true is in the URL.
 */

import { useWeekData, getTodaySummaryFromWeekData } from '@/hooks/data'
import { TodaySection } from '@/components/TodaySection'
import { WeekGrid } from '@/components/WeekGrid'
import { TransitionLink } from '@/components/TransitionLink'
import { useLanguage } from '@/lib/i18n/context'

export function DemoHomePage() {
  const { t } = useLanguage()
  const weekData = useWeekData()

  const {
    household,
    currentMember,
    children,
    members,
    pickups,
    meals,
    memberEvents,
    holidays,
    weekStart,
    loading,
    error,
  } = weekData

  // Show loading state
  if (loading) {
    return (
      <div className="space-y-8 animate-fade-in">
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
      <div className="space-y-8 animate-fade-in">
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    )
  }

  // Get today's summary
  const todaySummary = getTodaySummaryFromWeekData(weekData)

  // Calculate attention status
  const todayPickups = pickups.filter(p => p.date === todaySummary.date)
  const todayMeal = meals.find(m => m.date === todaySummary.date)
  const childrenWithoutPickup = children.filter(child =>
    !todayPickups.some(p => p.child_id === child.id && p.picker_id)
  )
  const noMeal = !todayMeal || (!todayMeal.recipe_id && !todayMeal.custom_meal)
  const isAllReady = childrenWithoutPickup.length === 0 && !noMeal

  // Build attention message
  const getAttentionMessage = () => {
    const hasPickupIssue = childrenWithoutPickup.length > 0
    const hasMealIssue = noMeal

    if (hasPickupIssue && hasMealIssue) {
      if (childrenWithoutPickup.length === 1) {
        return t.home.missingPickupForAndDinner.replace('{name}', childrenWithoutPickup[0].name)
      }
      return t.home.missingPickupAndDinner
    } else if (hasPickupIssue) {
      if (childrenWithoutPickup.length === 1) {
        return t.home.missingPickupFor.replace('{name}', childrenWithoutPickup[0].name)
      }
      return t.home.missingPickup
    } else if (hasMealIssue) {
      return t.home.missingDinner
    }
    return ''
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Today's Status Summary */}
      {isAllReady ? (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ background: 'rgba(131, 166, 151, 0.15)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span className="text-sm font-medium" style={{ color: 'var(--color-sage-dark, #5A7A57)' }}>
            {t.home.allReadyForToday}
          </span>
        </div>
      ) : (
        <TransitionLink
          href="/uke?demo=true"
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-opacity hover:opacity-80"
          style={{ background: 'rgba(229, 185, 94, 0.15)' }}
        >
          <div className="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span className="text-sm font-medium" style={{ color: 'var(--color-honey-dark, #A68A3A)' }}>
              {getAttentionMessage()}
            </span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </TransitionLink>
      )}

      {/* Today's Overview */}
      <TodaySection
        summary={todaySummary}
        holidays={holidays}
        members={members}
        children={children}
        householdId={household?.id || 'demo'}
      />

      {/* Week Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.common.week}
          </h2>
          <TransitionLink
            href="/uke?demo=true"
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            {t.common.edit} →
          </TransitionLink>
        </div>
        <WeekGrid
          children={children}
          members={members}
          pickups={pickups}
          meals={meals}
          memberEvents={memberEvents}
          holidays={holidays}
          weekStart={weekStart}
        />
      </div>
    </div>
  )
}
