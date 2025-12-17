import { createClient } from '@/lib/supabase/server'
import { TodayOverview } from '@/components/TodayOverview'
import { WeekGrid } from '@/components/WeekGrid'
import { UniversalAIInput } from '@/components/ai'
import { formatDateISO, addDays } from '@/lib/utils'
import Link from 'next/link'
import { getLanguageFromCookieOrBrowser } from '@/lib/i18n/cookie.server'
import { getTranslations } from '@/lib/i18n/translations'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const language = await getLanguageFromCookieOrBrowser()
  const t = getTranslations(language)

  // If not logged in, show welcome page
  if (!user) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center max-w-md mx-auto animate-fade-in">
          <img
            src="/icons/icon.svg"
            alt="Familjen"
            width={80}
            height={80}
            className="rounded-2xl mb-8 shadow-lg mx-auto"
          />
          <h1 className="text-4xl font-semibold font-display mb-4" style={{ color: 'var(--foreground)' }}>
            {t.home.welcome}
          </h1>
          <p className="text-lg mb-8" style={{ color: 'var(--muted)' }}>
            {t.login.subtitle}
          </p>
          <Link
            href="/login"
            className="btn btn-primary text-lg px-8 py-4"
          >
            {t.common.next}
          </Link>
        </div>
      </div>
    )
  }

  // Check if user has a household
  let { data: myMembership } = await supabase
    .from('household_members')
    .select('id, household_id')
    .eq('user_id', user.id)
    .single()

  // If no membership by user_id, try to claim a pending invite via RPC
  // This uses a SECURITY DEFINER function to bypass RLS for invite claiming
  if (!myMembership) {
    const { data: claimedInvite } = await supabase
      .rpc('claim_invite_for_current_user')

    if (claimedInvite && claimedInvite.length > 0) {
      myMembership = {
        id: claimedInvite[0].member_id,
        household_id: claimedInvite[0].household_id
      }
    }
  }

  // If user doesn't have a household, show create household option
  if (!myMembership) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center animate-fade-in">
        <div className="text-center max-w-md mx-auto">
          <div
            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-8"
            style={{ background: 'rgba(229, 185, 94, 0.2)' }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9,22 9,12 15,12 15,22"/>
            </svg>
          </div>
          <h1 className="text-3xl font-semibold font-display mb-4" style={{ color: 'var(--foreground)' }}>
            {t.wizard.waitingForInvite}
          </h1>
          <p className="text-lg mb-8" style={{ color: 'var(--muted)' }}>
            {t.wizard.waitingForInviteDesc}
          </p>
          <Link
            href="/ny-husstand"
            className="btn btn-primary text-lg px-8 py-4"
          >
            {t.settings.household}
          </Link>
        </div>
      </div>
    )
  }

  // Fetch household data - rolling 7-day view starting from today
  const today = new Date()
  const todayStr = formatDateISO(today)
  const weekStart = today  // Start from today, not Monday
  const weekEnd = addDays(weekStart, 6)
  const weekStartStr = formatDateISO(weekStart)
  const weekEndStr = formatDateISO(weekEnd)

  // Fetch all data in parallel, filtering by household_id to prevent admin seeing other households
  const [childrenResult, membersResult, pickupsResult, mealsResult, eventsResult, tasksResult, remindersResult] = await Promise.all([
    supabase.from('children').select('*').eq('household_id', myMembership.household_id).order('sort_order'),
    supabase.from('household_members').select('*').eq('household_id', myMembership.household_id),
    supabase.from('pickups').select(`*, child:children(*), picker:household_members(*)`).eq('household_id', myMembership.household_id).gte('date', weekStartStr).lte('date', weekEndStr),
    supabase.from('meals').select(`*, recipe:recipes(*)`).eq('household_id', myMembership.household_id).gte('date', weekStartStr).lte('date', weekEndStr),
    // Fetch events that overlap with this week
    supabase.from('member_events').select('*').eq('household_id', myMembership.household_id).lte('date', weekEndStr).or(`end_date.gte.${weekStartStr},end_date.is.null`),
    // Fetch child tasks for this week
    supabase.from('child_tasks').select('*, child:children(*)').eq('household_id', myMembership.household_id).gte('date', weekStartStr).lte('date', weekEndStr).order('date').order('time'),
    // Fetch household reminders for this week
    supabase.from('household_reminders').select('*, assignee:household_members(*)').eq('household_id', myMembership.household_id).gte('date', weekStartStr).lte('date', weekEndStr).eq('status', 'open').order('date').order('time'),
  ])

  // Check for errors
  const queryError = childrenResult.error || membersResult.error || pickupsResult.error || mealsResult.error || eventsResult.error || tasksResult.error || remindersResult.error
  if (queryError) {
    console.error('Error loading home page data:', queryError)
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
          <Link
            href="/"
            className="btn btn-primary"
          >
            {t.common.retry}
          </Link>
        </div>
      </div>
    )
  }

  const children = childrenResult.data
  const members = membersResult.data
  const pickups = pickupsResult.data
  const meals = mealsResult.data
  const memberEvents = eventsResult.data
  const childTasks = tasksResult.data || []
  const householdReminders = remindersResult.data || []

  // Get today's summary
  const todayPickups = pickups?.filter(p => p.date === todayStr) || []
  const todayMeal = meals?.find(m => m.date === todayStr) || null
  const todayTasks = childTasks.filter(t => t.date === todayStr)
  const todayReminders = householdReminders.filter(r => r.date === todayStr)

  const todaySummary = {
    date: todayStr,
    pickups: todayPickups,
    meal: todayMeal,
    tasks: todayTasks,
    reminders: todayReminders,
  }

  // Check if we have any data set up
  const hasSetup = children && children.length > 0

  if (!hasSetup) {
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
          <Link
            href="/innstillinger"
            className="btn btn-primary"
          >
            {t.nav.settings}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Universal AI Input - At top on all screen sizes */}
      <UniversalAIInput
        householdId={myMembership.household_id}
        children={children || []}
        members={members || []}
        currentUserId={user.id}
      />

      {/* Today's Overview */}
      <TodayOverview summary={todaySummary} />

      {/* Week Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.common.week}
          </h2>
          <Link
            href="/uke"
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            {t.common.edit} →
          </Link>
        </div>
        <WeekGrid
          children={children || []}
          members={members || []}
          pickups={pickups || []}
          meals={meals || []}
          memberEvents={memberEvents || []}
          weekStart={weekStart}
        />
      </div>
    </div>
  )
}
