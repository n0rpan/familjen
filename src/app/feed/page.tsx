'use client'

/**
 * Feed Page - Shows messages, photos, and reminders from integrations
 *
 * AUTH: This route is protected by src/proxy.ts (Next.js 16 middleware).
 * See PROTECTED_PATHS in src/lib/supabase/middleware.ts - includes '/feed'.
 * Unauthenticated users are redirected to /login at the middleware level.
 */

import { useSearchParams } from 'next/navigation'
import { useLanguage } from '@/lib/i18n/context'
import { useFeed } from '@/hooks/data'
import { FeedPageContent } from '@/components/feed/FeedPageContent'
import type { FeedFilter } from '@/components/feed/FeedFilters'

export default function Feed() {
  const searchParams = useSearchParams()
  const isDemo = searchParams.get('demo') === 'true'
  const serviceFilter = searchParams.get('service')?.toLowerCase()
  const typeFilter = searchParams.get('type')?.toLowerCase()
  const { t } = useLanguage()

  // Use the unified feed hook - works for both demo and production
  const {
    messages,
    photos,
    reminders,
    notifications,
    integrationChildren,
    integrationStatuses,
    loading,
    error,
    integrationsEnabled,
    toggleReminder,
    syncIntegrations,
    refetch,
  } = useFeed()

  // Determine initial filter from URL params
  const getInitialFilter = (): FeedFilter => {
    if (typeFilter === 'photos') return 'photos'
    if (typeFilter === 'reminders') return 'reminders'
    if (serviceFilter === 'spond') return 'spond'
    if (serviceFilter === 'iskole') return 'school'
    if (serviceFilter === 'kidplan' || serviceFilter === 'mykid') return 'kindergarten'
    return 'all'
  }

  const initialFilter = getInitialFilter()

  // Handle reminder toggle with optimistic updates handled by FeedPageContent
  const handleToggleReminder = async (id: string, completed: boolean) => {
    if (isDemo) return
    await toggleReminder(id, completed)
    await refetch()
  }

  // Handle sync
  const handleSync = async () => {
    if (isDemo) return
    await syncIntegrations()
  }

  // Loading state
  if (loading) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.feed}</h1>
          <p style={{ color: 'var(--muted)' }}>
            {t.feed?.subtitle || 'Meldinger, bilder og varsler fra Spond, barnehage og skole'}
          </p>
        </div>
        <div className="space-y-4">
          <div className="animate-pulse h-12 rounded-xl" style={{ background: 'var(--background)' }} />
          <div className="animate-pulse h-32 rounded-xl" style={{ background: 'var(--card)' }} />
          <div className="animate-pulse h-32 rounded-xl" style={{ background: 'var(--card)' }} />
          <div className="animate-pulse h-32 rounded-xl" style={{ background: 'var(--card)' }} />
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.feed}</h1>
        </div>
        <div className="card p-8 text-center">
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    )
  }

  // Integrations not enabled (production only)
  if (!isDemo && !integrationsEnabled) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.feed}</h1>
          <p style={{ color: 'var(--muted)' }}>
            {t.feed?.subtitle || 'Meldinger, bilder og varsler fra Spond, barnehage og skole'}
          </p>
        </div>

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
            {t.feed.integrationsDisabled}
          </h2>
          <p className="mb-4" style={{ color: 'var(--muted)' }}>
            {t.feed.contactAdmin}
          </p>
        </div>
      </div>
    )
  }

  // Ready with data
  return (
    <div className="page-container animate-fade-in">
      <div className="page-header mb-6">
        <h1 className="page-title">{t.nav.feed}</h1>
        <p style={{ color: 'var(--muted)' }}>
          {t.feed?.subtitle || 'Meldinger, bilder og varsler fra Spond, barnehage og skole'}
        </p>
      </div>

      <FeedPageContent
        messages={messages}
        photos={photos}
        reminders={reminders}
        notifications={notifications}
        integrationChildren={integrationChildren}
        integrationStatuses={integrationStatuses}
        initialFilter={initialFilter}
        onToggleReminder={handleToggleReminder}
        onSync={handleSync}
        onNotificationUpdate={refetch}
        isDemo={isDemo}
      />
    </div>
  )
}
