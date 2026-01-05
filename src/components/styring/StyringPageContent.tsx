'use client'

/**
 * StyringPageContent - Client Component
 *
 * Renders the home control panels (Somfy, Toshiba, MelCloud).
 * Each panel handles its own data fetching and state management.
 */

import { useLanguage } from '@/lib/i18n/context'
import { HomeControlPanel } from '@/components/integrations/HomeControlPanel'
import { ToshibaACPanel } from '@/components/integrations/ToshibaACPanel'
import { MelCloudACPanel } from '@/components/integrations/MelCloudACPanel'
import { TransitionLink } from '@/components/TransitionLink'
import type { StyringPageData } from '@/lib/data/server'

interface StyringPageContentProps {
  initialData?: StyringPageData
  isDemo?: boolean
}

export function StyringPageContent({ initialData, isDemo }: StyringPageContentProps) {
  // initialData is available for future use - currently panels fetch their own data
  void initialData
  const { t } = useLanguage()

  // Demo mode is not fully supported for home control - show message
  if (isDemo) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="mb-2">
          <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.nav.homeControl}
          </h1>
          <p className="mt-2" style={{ color: 'var(--muted)' }}>
            {t.homeControl.connectSomfyToshiba}
          </p>
        </div>

        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div
            className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ background: 'rgba(126, 182, 196, 0.2)' }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-sky)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9,22 9,12 15,12 15,22" />
            </svg>
          </div>
          <p style={{ color: 'var(--muted)' }}>
            {t.common.viewOnly}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="mb-2">
        <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
          {t.nav.homeControl}
        </h1>
        <p className="mt-2" style={{ color: 'var(--muted)' }}>
          {t.homeControl.connectSomfyToshiba}
        </p>
      </div>

      {/* Somfy screens/blinds and groups */}
      <HomeControlPanel showSettingsLink={false} />

      {/* Toshiba AC devices */}
      <ToshibaACPanel showSettingsLink={false} />

      {/* MelCloud (Mitsubishi) AC devices */}
      <MelCloudACPanel showSettingsLink={false} />

      {/* Single settings link at page level */}
      <div className="text-center pt-2">
        <TransitionLink
          href="/innstillinger"
          className="text-sm inline-flex items-center gap-1"
          style={{ color: 'var(--muted)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          {t.settings.title}
        </TransitionLink>
      </div>
    </div>
  )
}
