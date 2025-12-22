import { createClient } from '@/lib/supabase/server'
import { TodayOverview } from '@/components/TodayOverview'
import { AIHeadsUpSection } from '@/components/AIHeadsUpSection'
import { WeekGrid } from '@/components/WeekGrid'
import { UniversalAIInput } from '@/components/ai'
import { SuggestionBanner } from '@/components/integrations/SuggestionReview'
import { RecentPhotos } from '@/components/RecentPhotos'
import { HomeRefreshWrapper } from '@/components/HomeRefreshWrapper'
import { getHomePageData, getTodaySummary, getAttentionStatus } from '@/lib/data/home'
import { TransitionLink } from '@/components/TransitionLink'
import Image from 'next/image'
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
          <TransitionLink
            href="/ny-husstand"
            className="btn btn-primary text-lg px-8 py-4"
          >
            {t.settings.household}
          </TransitionLink>
        </div>
      </div>
    )
  }

  // Fetch all household data using dedicated loader
  const { data: homeData, error: dataError } = await getHomePageData(supabase, myMembership.household_id)

  if (dataError || !homeData) {
    console.error('Error loading home page data:', dataError)
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
          <TransitionLink
            href="/"
            className="btn btn-primary"
          >
            {t.common.retry}
          </TransitionLink>
        </div>
      </div>
    )
  }

  const { children, members, pickups, meals, memberEvents, childTasks, householdReminders, holidays, recentPhotos, weekStart } = homeData
  const todaySummary = getTodaySummary(homeData)

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

  // Calculate status for today using helper
  const { childrenWithoutPickup, noMeal, isAllReady } = getAttentionStatus(homeData)

  // Build descriptive attention message
  const getAttentionMessage = () => {
    const hasPickupIssue = childrenWithoutPickup.length > 0
    const hasMealIssue = noMeal

    if (hasPickupIssue && hasMealIssue) {
      // Both missing
      if (childrenWithoutPickup.length === 1) {
        return t.home.missingPickupForAndDinner.replace('{name}', childrenWithoutPickup[0].name)
      }
      return t.home.missingPickupAndDinner
    } else if (hasPickupIssue) {
      // Only pickup missing
      if (childrenWithoutPickup.length === 1) {
        return t.home.missingPickupFor.replace('{name}', childrenWithoutPickup[0].name)
      }
      return t.home.missingPickup
    } else if (hasMealIssue) {
      // Only meal missing
      return t.home.missingDinner
    }
    return ''
  }

  return (
    <HomeRefreshWrapper>
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
            href="/uke"
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

      {/* Universal AI Input - At top on all screen sizes */}
      <UniversalAIInput
        householdId={myMembership.household_id}
        children={children || []}
        members={members || []}
        currentUserId={user.id}
      />

      {/* Suggestion Banner */}
      <SuggestionBanner
        householdId={myMembership.household_id}
        children={children || []}
        members={members || []}
      />

      {/* Today's Overview */}
      <TodayOverview summary={todaySummary} holidays={holidays} />

      {/* AI Heads Up - Week lookahead */}
      <AIHeadsUpSection items={homeData.aiHeadsUps} />

      {/* Recent Photos */}
      {recentPhotos.length > 0 && <RecentPhotos photos={recentPhotos} />}

      {/* Week Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.common.week}
          </h2>
          <TransitionLink
            href="/uke"
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            {t.common.edit} →
          </TransitionLink>
        </div>
        <WeekGrid
          children={children || []}
          members={members || []}
          pickups={pickups || []}
          meals={meals || []}
          memberEvents={memberEvents || []}
          holidays={holidays}
          weekStart={weekStart}
        />
      </div>
    </div>
    </HomeRefreshWrapper>
  )
}
