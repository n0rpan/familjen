'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useWeekData, getTodaySummaryFromWeekData } from '@/hooks/data'
import { HomePageContent } from '@/components/home/HomePageContent'
import { TransitionLink } from '@/components/TransitionLink'
import { useLanguage } from '@/lib/i18n/context'
import Image from 'next/image'
import { formatDateISO, addDays } from '@/lib/utils'
import type { AIHeadsUp, Household, HouseholdMember, Child } from '@/lib/types'

export default function HomePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isDemo = searchParams.get('demo') === 'true'
  const { t } = useLanguage()
  const supabase = useMemo(() => createClient(), [])

  // Demo mode data - useWeekData auto-detects demo mode via context
  const weekData = useWeekData()

  // Production mode state
  const [loading, setLoading] = useState(!isDemo)
  const [authState, setAuthState] = useState<'loading' | 'loggedOut' | 'noHousehold' | 'noChildren' | 'ready'>('loading')
  const [household, setHousehold] = useState<Household | null>(null)
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [homeData, setHomeData] = useState<{
    pickups: Parameters<typeof HomePageContent>[0]['pickups']
    meals: Parameters<typeof HomePageContent>[0]['meals']
    memberEvents: Parameters<typeof HomePageContent>[0]['memberEvents']
    householdEvents: Parameters<typeof HomePageContent>[0]['householdEvents']
    externalEvents: Parameters<typeof HomePageContent>[0]['externalEvents']
    childTasks: Parameters<typeof HomePageContent>[0]['childTasks']
    holidays: Parameters<typeof HomePageContent>[0]['holidays']
    weekStart: Date
    aiHeadsUps: AIHeadsUp[]
    recentPhotos: Parameters<typeof HomePageContent>[0]['recentPhotos']
    todaySummary: Parameters<typeof HomePageContent>[0]['todaySummary']
    childrenWithoutPickup: Child[]
    noMeal: boolean
    isAllReady: boolean
  } | null>(null)

  // Load production data
  const loadData = useCallback(async () => {
    if (isDemo) return

    setLoading(true)
    try {
      // Check auth
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setAuthState('loggedOut')
        setLoading(false)
        return
      }
      setUserId(user.id)

      // Check household membership
      let { data: myMembership } = await supabase
        .from('household_members')
        .select('id, household_id')
        .eq('user_id', user.id)
        .single()

      // Try to claim pending invite
      if (!myMembership) {
        const { data: claimedInvite } = await supabase.rpc('claim_invite_for_current_user')
        if (claimedInvite && claimedInvite.length > 0) {
          myMembership = {
            id: claimedInvite[0].member_id,
            household_id: claimedInvite[0].household_id
          }
        }
      }

      if (!myMembership) {
        setAuthState('noHousehold')
        setLoading(false)
        return
      }

      const householdId = myMembership.household_id

      // Load household data in parallel
      const [
        { data: householdData },
        { data: membersData },
        { data: childrenData },
      ] = await Promise.all([
        supabase.from('households').select('*').eq('id', householdId).single(),
        supabase.from('household_members').select('*').eq('household_id', householdId),
        supabase.from('children').select('*').eq('household_id', householdId).order('sort_order', { ascending: true }),
      ])

      if (!householdData) {
        setAuthState('noHousehold')
        setLoading(false)
        return
      }

      setHousehold(householdData as Household)
      setMembers((membersData || []) as HouseholdMember[])
      setChildren((childrenData || []) as Child[])

      // Check if setup is needed
      if (!childrenData || childrenData.length === 0) {
        setAuthState('noChildren')
        setLoading(false)
        return
      }

      // Load all home page data
      const today = new Date()
      const todayStr = formatDateISO(today)
      const weekStart = new Date(today)
      weekStart.setDate(today.getDate() - today.getDay() + 1) // Monday
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 6)
      const weekStartStr = formatDateISO(weekStart)
      const weekEndStr = formatDateISO(weekEnd)

      const [
        { data: pickupsData },
        { data: mealsData },
        { data: memberEventsData },
        { data: householdEventsData },
        { data: externalEventsData },
        { data: childTasksData },
        { data: aiHeadsUpsData },
        { data: photosData },
      ] = await Promise.all([
        supabase
          .from('pickups')
          .select('*, children(name, color), picker:household_members!pickups_picker_id_fkey(id, name, short_name)')
          .eq('household_id', householdId)
          .gte('date', weekStartStr)
          .lte('date', weekEndStr),
        supabase
          .from('meals')
          .select('*, recipes(id, name, description)')
          .eq('household_id', householdId)
          .gte('date', weekStartStr)
          .lte('date', weekEndStr),
        supabase
          .from('member_events')
          .select('*')
          .eq('household_id', householdId)
          .gte('date', weekStartStr)
          .lte('date', weekEndStr),
        supabase
          .from('household_events')
          .select('*')
          .eq('household_id', householdId)
          .gte('date', weekStartStr)
          .lte('date', weekEndStr),
        supabase
          .from('external_events')
          .select('*, external_integrations!inner(household_id)')
          .eq('external_integrations.household_id', householdId)
          .gte('event_date', weekStartStr)
          .lte('event_date', weekEndStr),
        supabase
          .from('child_tasks')
          .select('*, children!inner(household_id)')
          .eq('children.household_id', householdId)
          .gte('date', weekStartStr)
          .lte('date', weekEndStr),
        supabase
          .from('ai_heads_ups')
          .select('*')
          .eq('household_id', householdId)
          .eq('is_dismissed', false)
          .gte('date', todayStr)
          .order('date', { ascending: true })
          .limit(5),
        supabase
          .from('external_photos')
          .select('*, external_integrations!inner(household_id), children(name)')
          .eq('external_integrations.household_id', householdId)
          .order('taken_at', { ascending: false })
          .limit(8),
      ])

      // Transform data
      const pickups = (pickupsData || []).map(p => ({
        ...p,
        child_name: p.children?.name || '',
        child_color: p.children?.color || 'sky',
        picker_name: p.picker?.name || null,
        picker_short_name: p.picker?.short_name || null,
      }))

      const meals = (mealsData || []).map(m => ({
        ...m,
        recipe: m.recipes || null,
      }))

      // Calculate today's summary
      const todayPickups = pickups.filter(p => p.date === todayStr)
      const todayMeal = meals.find(m => m.date === todayStr)
      const todayTasks = (childTasksData || []).filter(t => t.date === todayStr)

      const todaySummary = {
        date: todayStr,
        pickups: todayPickups,
        meal: todayMeal || null,
        tasks: todayTasks,
        events: [],
      }

      // Calculate attention status
      const childrenWithoutPickup = (childrenData || []).filter(child =>
        !todayPickups.some(p => p.child_id === child.id && p.picker_id)
      ) as Child[]
      const noMeal = !todayMeal || (!todayMeal.recipe_id && !todayMeal.custom_meal)
      const isAllReady = childrenWithoutPickup.length === 0 && !noMeal

      // Transform photos
      const recentPhotos = (photosData || []).map(p => ({
        id: p.id,
        title: p.title,
        taken_at: p.taken_at,
        storage_path: p.storage_path,
        thumbnail_path: p.thumbnail_path,
        child_name: p.children?.name || null,
        image_url: null,
      }))

      setHomeData({
        pickups,
        meals,
        memberEvents: (memberEventsData || []) as Parameters<typeof HomePageContent>[0]['memberEvents'],
        householdEvents: (householdEventsData || []) as Parameters<typeof HomePageContent>[0]['householdEvents'],
        externalEvents: (externalEventsData || []) as Parameters<typeof HomePageContent>[0]['externalEvents'],
        childTasks: (childTasksData || []) as Parameters<typeof HomePageContent>[0]['childTasks'],
        holidays: [],
        weekStart,
        aiHeadsUps: (aiHeadsUpsData || []) as AIHeadsUp[],
        recentPhotos,
        todaySummary,
        childrenWithoutPickup,
        noMeal,
        isAllReady,
      })

      setAuthState('ready')
    } catch (error) {
      console.error('Error loading home data:', error)
      setAuthState('loggedOut')
    } finally {
      setLoading(false)
    }
  }, [isDemo, supabase])

  useEffect(() => {
    if (!isDemo) {
      loadData()
    }
  }, [isDemo, loadData])

  // Demo mode: Generate AI heads-up data
  const demoHeadsUps: AIHeadsUp[] = useMemo(() => {
    if (!isDemo || weekData.children.length === 0) return []

    const today = new Date()
    const tomorrow = addDays(today, 1)
    const nextWeek = addDays(today, 5)
    const firstChildName = weekData.children[0]?.name || 'Emilie'

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
        childId: weekData.children[0]?.id || 'demo-child',
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
        memberId: weekData.members[0]?.id || 'demo-member',
        memberName: weekData.members[0]?.name || 'Pappa',
        source: {
          table: 'member_events',
          id: 'demo-event-1',
          sourceType: 'memberEvent',
        },
        hasConflict: true,
        href: '/uke?demo=true',
      },
    ]
  }, [isDemo, weekData.children, weekData.members])

  // Demo mode rendering
  if (isDemo) {
    if (weekData.loading) {
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

    if (weekData.error) {
      return (
        <div className="space-y-8 animate-fade-in">
          <div
            className="rounded-2xl p-8 text-center"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <p className="text-red-500">{weekData.error}</p>
          </div>
        </div>
      )
    }

    const todaySummary = getTodaySummaryFromWeekData(weekData)
    const todayPickups = weekData.pickups.filter(p => p.date === todaySummary.date)
    const todayMeal = weekData.meals.find(m => m.date === todaySummary.date)
    const childrenWithoutPickup = weekData.children.filter(child =>
      !todayPickups.some(p => p.child_id === child.id && p.picker_id)
    )
    const noMeal = !todayMeal || (!todayMeal.recipe_id && !todayMeal.custom_meal)
    const isAllReady = childrenWithoutPickup.length === 0 && !noMeal

    return (
      <HomePageContent
        householdId={weekData.household?.id || 'demo'}
        children={weekData.children}
        members={weekData.members}
        todaySummary={todaySummary}
        pickups={weekData.pickups}
        meals={weekData.meals}
        memberEvents={weekData.memberEvents}
        householdEvents={weekData.householdEvents}
        externalEvents={weekData.externalEvents}
        childTasks={weekData.tasks}
        holidays={weekData.holidays}
        weekStart={weekData.weekStart}
        aiHeadsUps={demoHeadsUps}
        recentPhotos={[]}
        childrenWithoutPickup={childrenWithoutPickup}
        noMeal={noMeal}
        isAllReady={isAllReady}
        isDemo={true}
      />
    )
  }

  // Production mode: Loading state
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

  // Production mode: Not logged in
  if (authState === 'loggedOut') {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center max-w-md mx-auto animate-fade-in">
          <Image
            src="/icons/icon.svg"
            alt="Familjen"
            width={80}
            height={80}
            className="rounded-2xl mb-8 shadow-lg mx-auto"
            priority
          />
          <h1 className="text-4xl font-semibold font-display mb-4" style={{ color: 'var(--foreground)' }}>
            {t.home.welcome}
          </h1>
          <p className="text-lg mb-8" style={{ color: 'var(--muted)' }}>
            {t.login.subtitle}
          </p>
          <TransitionLink
            href="/login"
            className="btn btn-primary text-lg px-8 py-4"
          >
            {t.common.next}
          </TransitionLink>
        </div>
      </div>
    )
  }

  // Production mode: No household
  if (authState === 'noHousehold') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center animate-fade-in">
        <div className="w-full max-w-md mx-auto px-4">
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
              style={{ background: 'var(--accent)' }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9,22 9,12 15,12 15,22"/>
              </svg>
            </div>
            <h1 className="text-2xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
              {t.signup.getStarted}
            </h1>
          </div>

          <div className="space-y-4">
            <TransitionLink
              href="/"
              className="block p-5 rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start gap-4">
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(126, 182, 196, 0.2)' }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                    {t.signup.wasInvited}
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {t.signup.wasInvitedDesc}
                  </p>
                  <span
                    className="inline-block mt-3 text-sm font-medium"
                    style={{ color: 'var(--accent)' }}
                  >
                    {t.signup.checkInvite} →
                  </span>
                </div>
              </div>
            </TransitionLink>

            <TransitionLink
              href="/ny-husstand"
              className="block p-5 rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start gap-4">
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(229, 185, 94, 0.2)' }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                    {t.signup.createNew}
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {t.signup.createNewDesc}
                  </p>
                  <span
                    className="inline-block mt-3 text-sm font-medium"
                    style={{ color: 'var(--accent)' }}
                  >
                    {t.common.next} →
                  </span>
                </div>
              </div>
            </TransitionLink>
          </div>

          <div
            className="mt-6 flex items-start gap-3 p-4 rounded-xl"
            style={{ background: 'rgba(229, 185, 94, 0.1)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <p className="text-sm" style={{ color: 'var(--color-honey-dark, #A68A3A)' }}>
              {t.signup.dontCreateIfPartner}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Production mode: No children (needs setup)
  if (authState === 'noChildren') {
    return (
      <div className="space-y-8 animate-fade-in">
        <div
          className="rounded-2xl p-8 md:p-12 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
            style={{ background: 'rgba(232, 120, 109, 0.15)' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h2 className="text-2xl font-semibold font-display mb-3" style={{ color: 'var(--foreground)' }}>
            {t.wizard.welcome}
          </h2>
          <p className="mb-8 max-w-md mx-auto" style={{ color: 'var(--muted)' }}>
            {t.wizard.welcomeSubtitle}
          </p>
          <TransitionLink
            href="/innstillinger"
            className="btn btn-primary"
          >
            {t.nav.settings}
          </TransitionLink>
        </div>
      </div>
    )
  }

  // Production mode: Ready with data
  if (authState === 'ready' && homeData && household) {
    return (
      <HomePageContent
        householdId={household.id}
        currentUserId={userId || undefined}
        children={children}
        members={members}
        todaySummary={homeData.todaySummary}
        pickups={homeData.pickups}
        meals={homeData.meals}
        memberEvents={homeData.memberEvents}
        householdEvents={homeData.householdEvents}
        externalEvents={homeData.externalEvents}
        childTasks={homeData.childTasks}
        holidays={homeData.holidays}
        weekStart={homeData.weekStart}
        aiHeadsUps={homeData.aiHeadsUps}
        recentPhotos={homeData.recentPhotos}
        childrenWithoutPickup={homeData.childrenWithoutPickup}
        noMeal={homeData.noMeal}
        isAllReady={homeData.isAllReady}
        isDemo={false}
      />
    )
  }

  // Error state
  return (
    <div className="space-y-8 animate-fade-in">
      <div
        className="rounded-2xl p-8 md:p-12 text-center"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
          style={{ background: 'rgba(232, 120, 109, 0.15)' }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h2 className="text-2xl font-semibold font-display mb-3" style={{ color: 'var(--foreground)' }}>
          {t.errors.loadFailed}
        </h2>
        <p className="mb-8 max-w-md mx-auto" style={{ color: 'var(--muted)' }}>
          {t.errors.generic}
        </p>
        <button
          onClick={() => loadData()}
          className="btn btn-primary"
        >
          {t.common.retry}
        </button>
      </div>
    </div>
  )
}
