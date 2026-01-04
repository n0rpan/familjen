/**
 * HomeDataLoader - Server Component
 *
 * Fetches all home page data on the server and passes to HomePageContent.
 * Works for both production (Supabase) and demo mode (generated data).
 *
 * This is the key component for PPR - it runs on the server and streams
 * the rendered content to the client.
 */

import { fetchHomePageData, getDemoHomePageData, getTodaySummary } from '@/lib/data/server'
import { HomePageContent } from './HomePageContent'
import { formatDateISO, addDays } from '@/lib/utils'
import type { AIHeadsUp, Child } from '@/lib/types'

interface HomeDataLoaderProps {
  householdId: string
  isDemo: boolean
}

export async function HomeDataLoader({ householdId, isDemo }: HomeDataLoaderProps) {
  // Fetch data - same structure for demo and production
  const data = isDemo
    ? getDemoHomePageData()
    : await fetchHomePageData(householdId)

  // Calculate today's summary
  const todaySummary = getTodaySummary(data)

  // Calculate status for attention banner
  const todayStr = formatDateISO(new Date())
  const todayPickups = data.pickups.filter(p => p.date === todayStr)
  const todayMeal = data.meals.find(m => m.date === todayStr)

  const childrenWithoutPickup = data.children.filter(child =>
    !todayPickups.some(p => p.child_id === child.id && p.picker_id)
  ) as Child[]
  const noMeal = !todayMeal || (!todayMeal.recipe_id && !todayMeal.custom_meal)
  const isAllReady = childrenWithoutPickup.length === 0 && !noMeal

  // Generate demo AI heads-up data
  const aiHeadsUps: AIHeadsUp[] = isDemo ? generateDemoHeadsUps(data) : []

  return (
    <HomePageContent
      householdId={data.household?.id || 'demo'}
      currentUserId={data.currentMember?.user_id || undefined}
      children={data.children}
      members={data.members}
      todaySummary={todaySummary}
      pickups={data.pickups}
      meals={data.meals}
      memberEvents={data.memberEvents}
      householdEvents={data.householdEvents}
      externalEvents={data.externalEvents}
      childTasks={data.tasks}
      holidays={data.holidays}
      weekStart={data.weekStart}
      aiHeadsUps={aiHeadsUps}
      recentPhotos={[]}
      childrenWithoutPickup={childrenWithoutPickup}
      noMeal={noMeal}
      isAllReady={isAllReady}
      isDemo={isDemo}
    />
  )
}

// Helper to generate demo heads-up data
function generateDemoHeadsUps(data: ReturnType<typeof getDemoHomePageData>): AIHeadsUp[] {
  if (data.children.length === 0) return []

  const today = new Date()
  const tomorrow = addDays(today, 1)
  const nextWeek = addDays(today, 5)
  const firstChildName = data.children[0]?.name || 'Emilie'

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
      childId: data.children[0]?.id || 'demo-child',
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
      memberId: data.members[0]?.id || 'demo-member',
      memberName: data.members[0]?.name || 'Pappa',
      source: {
        table: 'member_events',
        id: 'demo-event-1',
        sourceType: 'memberEvent',
      },
      hasConflict: true,
      href: '/uke?demo=true',
    },
  ]
}
