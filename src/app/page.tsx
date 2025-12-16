import { createClient } from '@/lib/supabase/server'
import { TodayOverview } from '@/components/TodayOverview'
import { WeekGrid } from '@/components/WeekGrid'
import { formatDateISO, getWeekStart, addDays } from '@/lib/utils'
import Link from 'next/link'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // If not logged in, show welcome page
  if (!user) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center max-w-md mx-auto animate-fade-in">
          <div
            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-8 shadow-lg"
            style={{ background: 'var(--accent)' }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9,22 9,12 15,12 15,22"/>
            </svg>
          </div>
          <h1 className="text-4xl font-semibold font-display mb-4" style={{ color: 'var(--foreground)' }}>
            Velkommen til Familjen
          </h1>
          <p className="text-lg mb-8" style={{ color: 'var(--muted)' }}>
            Planlegg ukens henting og middager enkelt. Hold oversikt over hvem som henter barna og hva som er til middag.
          </p>
          <Link
            href="/login"
            className="btn btn-primary text-lg px-8 py-4"
          >
            Kom i gang
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

  // If no membership by user_id, check if there's a member with matching email
  if (!myMembership && user.email) {
    const { data: memberByEmail } = await supabase
      .from('household_members')
      .select('id, household_id, user_id')
      .eq('email', user.email.toLowerCase())
      .is('user_id', null)
      .single()

    // If found, link the user to this member record
    if (memberByEmail) {
      const { error: linkError } = await supabase
        .from('household_members')
        .update({ user_id: user.id })
        .eq('id', memberByEmail.id)

      if (!linkError) {
        myMembership = { id: memberByEmail.id, household_id: memberByEmail.household_id }
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
            Velkommen!
          </h1>
          <p className="text-lg mb-8" style={{ color: 'var(--muted)' }}>
            Du er ikke med i noen husstand ennå. Opprett en ny husstand for å komme i gang.
          </p>
          <Link
            href="/ny-husstand"
            className="btn btn-primary text-lg px-8 py-4"
          >
            Opprett husstand
          </Link>
          <p className="text-sm mt-6" style={{ color: 'var(--muted)' }}>
            Har noen invitert deg? Vent til de legger deg til i husstanden sin.
          </p>
        </div>
      </div>
    )
  }

  // Fetch household data
  const today = new Date()
  const todayStr = formatDateISO(today)
  const weekStart = getWeekStart(today)
  const weekEnd = addDays(weekStart, 6)
  const weekStartStr = formatDateISO(weekStart)
  const weekEndStr = formatDateISO(weekEnd)

  // Fetch all data in parallel
  const [childrenResult, membersResult, pickupsResult, mealsResult, eventsResult, tasksResult] = await Promise.all([
    supabase.from('children').select('*').order('sort_order'),
    supabase.from('household_members').select('*'),
    supabase.from('pickups').select(`*, child:children(*), picker:household_members(*)`).gte('date', weekStartStr).lte('date', weekEndStr),
    supabase.from('meals').select(`*, recipe:recipes(*)`).gte('date', weekStartStr).lte('date', weekEndStr),
    // Fetch events that overlap with this week
    supabase.from('member_events').select('*').lte('date', weekEndStr).or(`end_date.gte.${weekStartStr},end_date.is.null`),
    // Fetch child tasks for this week
    supabase.from('child_tasks').select('*, child:children(*)').gte('date', weekStartStr).lte('date', weekEndStr).order('date').order('time'),
  ])

  // Check for errors
  const queryError = childrenResult.error || membersResult.error || pickupsResult.error || mealsResult.error || eventsResult.error || tasksResult.error
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
            Kunne ikke laste data
          </h2>
          <p className="mb-8 max-w-md mx-auto" style={{ color: 'var(--muted)' }}>
            Det oppstod en feil ved lasting av data. Prøv å laste siden på nytt.
          </p>
          <Link
            href="/"
            className="btn btn-primary"
          >
            Last på nytt
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

  // Get today's summary
  const todayPickups = pickups?.filter(p => p.date === todayStr) || []
  const todayMeal = meals?.find(m => m.date === todayStr) || null
  const todayTasks = childTasks.filter(t => t.date === todayStr)

  const todaySummary = {
    date: todayStr,
    pickups: todayPickups,
    meal: todayMeal,
    tasks: todayTasks,
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
            Kom i gang med Familjen
          </h2>
          <p className="mb-8 max-w-md mx-auto" style={{ color: 'var(--muted)' }}>
            For å bruke appen må du først legge til barna og familiemedlemmene dine.
          </p>
          <Link
            href="/innstillinger"
            className="btn btn-primary"
          >
            Gå til innstillinger
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Today's Overview */}
      <TodayOverview summary={todaySummary} />

      {/* Week Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            Denne uken
          </h2>
          <Link
            href="/uke"
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            Rediger uke →
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
