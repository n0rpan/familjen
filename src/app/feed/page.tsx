import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getLanguageFromCookieOrBrowser } from '@/lib/i18n/cookie.server'
import { getTranslations } from '@/lib/i18n/translations'
import { FeedPage } from '@/components/feed/FeedPage'
import type { FeedFilter } from '@/components/feed/FeedFilters'

interface Props {
  searchParams: Promise<{ service?: string; type?: string }>
}

export default async function Feed({ searchParams }: Props) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const language = await getLanguageFromCookieOrBrowser()
  const t = getTranslations(language)

  // Redirect to login if not authenticated
  if (!user) {
    redirect('/login')
  }

  // Check if user has a household
  const { data: myMembership } = await supabase
    .from('household_members')
    .select('id, household_id')
    .eq('user_id', user.id)
    .single()

  // Redirect to household setup if no membership
  if (!myMembership) {
    redirect('/ny-husstand')
  }

  // Check if integrations are enabled
  const { data: household } = await supabase
    .from('households')
    .select('external_integrations_enabled')
    .eq('id', myMembership.household_id)
    .single()

  // Determine initial filter from URL params
  const getInitialFilter = (): FeedFilter => {
    const service = params.service?.toLowerCase()
    const type = params.type?.toLowerCase()

    // Handle type parameter (photos, etc.)
    if (type === 'photos') return 'photos'
    if (type === 'reminders') return 'reminders'

    // Handle service parameter
    if (service === 'spond') return 'spond'
    if (service === 'iskole') return 'school'
    if (service === 'kidplan' || service === 'mykid') return 'kindergarten'

    return 'all'
  }

  const initialFilter = getInitialFilter()

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header mb-6">
        <h1 className="page-title">{t.nav.feed}</h1>
        <p style={{ color: 'var(--muted)' }}>
          Meldinger, bilder og varsler fra Spond, barnehage og skole
        </p>
      </div>

      {household?.external_integrations_enabled ? (
        <FeedPage householdId={myMembership.household_id} initialFilter={initialFilter} />
      ) : (
        <div
          className="card p-8 text-center"
          style={{
            border: '2px dashed var(--border)',
            background: 'transparent',
          }}
        >
          <div className="mb-4">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--muted)', margin: '0 auto' }}
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            Integrasjoner ikke aktivert
          </h2>
          <p className="mb-4" style={{ color: 'var(--muted)' }}>
            Kontakt administrator for å aktivere integrasjoner for din husstand.
          </p>
        </div>
      )}
    </div>
  )
}
