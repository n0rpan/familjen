/**
 * Home Page - Server Component with PPR (Partial Prerendering)
 *
 * This page uses Next.js PPR to provide instant loads:
 * - Static shell (layout, navigation) renders immediately
 * - Dynamic content (data from Supabase) streams in via Suspense
 *
 * Both demo and production use the same components for consistency.
 */

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getLanguageFromCookieOrBrowser } from '@/lib/i18n/cookie.server'
import { getTranslations } from '@/lib/i18n/translations'
import { HomeDataLoader } from '@/components/home/HomeDataLoader'
import { HomeClientInteractions } from '@/components/home/HomeClientInteractions'
import { HomePageSkeleton } from '@/components/Skeleton'
import { TransitionLink } from '@/components/TransitionLink'
import Image from 'next/image'

interface HomePageProps {
  searchParams: Promise<{ demo?: string }>
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams
  const isDemo = params.demo === 'true'
  const language = await getLanguageFromCookieOrBrowser()
  const t = getTranslations(language)

  // Demo mode - use demo data, same components
  if (isDemo) {
    return (
      <>
        <Suspense fallback={<HomePageSkeleton />}>
          <HomeDataLoader householdId="demo" isDemo={true} />
        </Suspense>
        <HomeClientInteractions householdId="demo" isDemo={true} />
      </>
    )
  }

  // Production mode - check auth and household
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Not logged in
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

  // Get household ID from JWT (fast, no extra query)
  let householdId = user.app_metadata?.household_id as string | undefined

  // Fallback: If JWT doesn't have household_id, check database
  // This handles cases where JWT wasn't refreshed after joining a household
  if (!householdId) {
    const { data: memberData } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (memberData?.household_id) {
      householdId = memberData.household_id
    }
  }

  // No household - show onboarding options
  if (!householdId) {
    return <NoHouseholdView t={t} />
  }

  // Check if household has children (quick query)
  const { count } = await supabase
    .from('children')
    .select('*', { count: 'exact', head: true })
    .eq('household_id', householdId)

  // No children - needs setup
  if (count === 0) {
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

  // Ready! Load home page with data streaming
  return (
    <>
      <Suspense fallback={<HomePageSkeleton />}>
        <HomeDataLoader householdId={householdId} isDemo={false} />
      </Suspense>
      <HomeClientInteractions householdId={householdId} isDemo={false} />
    </>
  )
}

// Separate component for no-household state with invite claiming
async function NoHouseholdView({ t }: { t: ReturnType<typeof getTranslations> }) {
  const supabase = await createClient()

  // Try to claim any pending invite
  const { data: claimedInvite } = await supabase.rpc('claim_invite_for_current_user')

  // If invite was claimed, the user now has a household - redirect to trigger refresh
  if (claimedInvite && claimedInvite.length > 0) {
    redirect('/')
  }

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
