'use client'

/**
 * DemoHomePage Component
 *
 * Client-side wrapper that uses demo data hooks and renders
 * the same HomePageContent component as production.
 * This ensures demo and production are visually identical.
 */

import { useMemo } from 'react'
import { useWeekData, getTodaySummaryFromWeekData } from '@/hooks/data'
import { HomePageContent } from '@/components/home/HomePageContent'
import { formatDateISO, addDays } from '@/lib/utils'
import type { AIHeadsUp } from '@/lib/types'

export function DemoHomePage() {
  const weekData = useWeekData()

  const {
    household,
    children,
    members,
    pickups,
    meals,
    memberEvents,
    householdEvents,
    externalEvents,
    tasks: childTasks,
    holidays,
    weekStart,
    loading,
    error,
  } = weekData

  // Generate sample AI heads-up data for demo
  const demoHeadsUps: AIHeadsUp[] = useMemo(() => {
    if (children.length === 0) return []

    const today = new Date()
    const tomorrow = addDays(today, 1)
    const nextWeek = addDays(today, 5)

    const firstChildName = children[0]?.name || 'Emilie'

    return [
      {
        id: 'demo-headsup-1',
        type: 'suggestion',
        priority: 'normal',
        title: 'Husk gymtøy',
        description: `${firstChildName} har gym på torsdag`,
        date: formatDateISO(tomorrow),
        endDate: null,
        time: '08:00',
        childId: children[0]?.id || 'demo-child',
        childName: firstChildName,
        memberId: null,
        memberName: null,
        source: {
          table: 'external_suggestions',
          id: 'demo-suggestion-1',
          sourceType: 'suggestion',
          displayName: 'Barnehagen',
        },
        hasConflict: false,
        href: '/uke?demo=true',
      },
      {
        id: 'demo-headsup-2',
        type: 'member_event',
        priority: 'high',
        title: 'Pappa på jobb-reise',
        description: 'Mandag til onsdag',
        date: formatDateISO(nextWeek),
        endDate: formatDateISO(addDays(nextWeek, 2)),
        time: null,
        childId: null,
        childName: null,
        memberId: members[0]?.id || 'demo-member',
        memberName: members[0]?.name || 'Pappa',
        source: {
          table: 'member_events',
          id: 'demo-event-1',
          sourceType: 'memberEvent',
        },
        hasConflict: true,
        href: '/uke?demo=true',
      },
    ]
  }, [children, members])

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

  // Get today's summary from week data
  const todaySummary = getTodaySummaryFromWeekData(weekData)

  // Calculate attention status (same logic as production)
  const todayPickups = pickups.filter(p => p.date === todaySummary.date)
  const todayMeal = meals.find(m => m.date === todaySummary.date)
  const childrenWithoutPickup = children.filter(child =>
    !todayPickups.some(p => p.child_id === child.id && p.picker_id)
  )
  const noMeal = !todayMeal || (!todayMeal.recipe_id && !todayMeal.custom_meal)
  const isAllReady = childrenWithoutPickup.length === 0 && !noMeal

  return (
    <HomePageContent
      householdId={household?.id || 'demo'}
      children={children}
      members={members}
      todaySummary={todaySummary}
      pickups={pickups}
      meals={meals}
      memberEvents={memberEvents}
      householdEvents={householdEvents}
      externalEvents={externalEvents}
      childTasks={childTasks}
      holidays={holidays}
      weekStart={weekStart}
      aiHeadsUps={demoHeadsUps}
      recentPhotos={[]} // No photos in demo
      childrenWithoutPickup={childrenWithoutPickup}
      noMeal={noMeal}
      isAllReady={isAllReady}
      isDemo={true}
    />
  )
}
