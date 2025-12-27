'use client'

/**
 * Demo Banner
 *
 * Fixed banner at the top of the page indicating demo mode.
 * Shows "Exit demo" button to clear state and redirect to login.
 */

import { useDemo } from '@/lib/demo/context'
import { useLanguage } from '@/lib/i18n/context'

export function DemoBanner() {
  const { isDemo, exitDemo } = useDemo()
  const { t } = useLanguage()

  if (!isDemo) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-4 py-2"
      style={{
        background: 'linear-gradient(135deg, var(--color-honey) 0%, #D4A84B 100%)',
        color: 'white',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
      }}
    >
      <div className="flex items-center gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="text-sm font-medium">
          {t.demo?.banner ?? 'Dette er en demo med eksempeldata'}
        </span>
      </div>
      <button
        onClick={exitDemo}
        className="text-sm font-medium underline hover:no-underline transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-honey)] rounded px-2 py-1"
      >
        {t.demo?.exit ?? 'Avslutt demo'}
      </button>
    </div>
  )
}
