'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

export interface IntegrationStatus {
  id: string
  service: 'spond' | 'kidplan' | 'iskole' | 'mykid'
  displayName: string
  lastSyncStatus: string | null
  lastSyncError: string | null
  lastSyncAt: string | null
}

interface Props {
  integrations: IntegrationStatus[]
}

const SERVICE_NAMES: Record<string, string> = {
  spond: 'Spond',
  kidplan: 'Kidplan',
  iskole: 'iSkole',
  mykid: 'MyKid',
}

/**
 * Banner that shows when integrations have sync failures.
 * Designed to be visible but not overwhelming - dismissible but actionable.
 *
 * Philosophy: Users trust that synced data is accurate. If sync fails,
 * they need to know immediately so they don't miss important messages.
 */
export function SyncStatusBanner({ integrations }: Props) {
  const [dismissed, setDismissed] = useState(false)

  // Find integrations with errors
  const failedIntegrations = useMemo(() => {
    return integrations.filter(
      (i) => i.lastSyncStatus === 'error' || i.lastSyncStatus === 'auth_failed'
    )
  }, [integrations])

  // Group by error type for smarter messaging
  const { authFailed, otherErrors } = useMemo(() => {
    const auth: IntegrationStatus[] = []
    const other: IntegrationStatus[] = []

    for (const integration of failedIntegrations) {
      if (integration.lastSyncStatus === 'auth_failed') {
        auth.push(integration)
      } else {
        other.push(integration)
      }
    }

    return { authFailed: auth, otherErrors: other }
  }, [failedIntegrations])

  // Nothing to show
  if (failedIntegrations.length === 0 || dismissed) {
    return null
  }

  // Format service names nicely
  const formatServiceList = (items: IntegrationStatus[]) => {
    const names = items.map((i) => i.displayName || SERVICE_NAMES[i.service] || i.service)
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]} og ${names[1]}`
    return `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`
  }

  // Determine the message based on error types
  const getMessage = () => {
    if (authFailed.length > 0 && otherErrors.length > 0) {
      // Both types of errors
      return {
        title: 'Problemer med synkronisering',
        description: `${formatServiceList(authFailed)} trenger ny innlogging. ${formatServiceList(otherErrors)} har synkfeil.`,
        action: 'Sjekk innstillinger',
      }
    } else if (authFailed.length > 0) {
      // Only auth failures - user can fix this
      const count = authFailed.length
      return {
        title: count === 1 ? 'Innlogging utløpt' : 'Innlogginger utløpt',
        description: `${formatServiceList(authFailed)} trenger ny innlogging for å synkronisere meldinger.`,
        action: 'Logg inn på nytt',
      }
    } else {
      // Only sync errors - might be temporary
      return {
        title: 'Synkronisering feilet',
        description: `Kunne ikke hente data fra ${formatServiceList(otherErrors)}. Prøv igjen senere.`,
        action: 'Sjekk status',
      }
    }
  }

  const { title, description, action } = getMessage()
  const hasAuthError = authFailed.length > 0

  return (
    <div
      role="alert"
      className="relative rounded-xl overflow-hidden animate-fade-in"
      style={{
        background: hasAuthError
          ? 'linear-gradient(135deg, rgba(232, 120, 109, 0.15) 0%, rgba(232, 120, 109, 0.08) 100%)'
          : 'linear-gradient(135deg, rgba(229, 185, 94, 0.15) 0%, rgba(229, 185, 94, 0.08) 100%)',
        border: `1px solid ${hasAuthError ? 'rgba(232, 120, 109, 0.3)' : 'rgba(229, 185, 94, 0.3)'}`,
      }}
    >
      {/* Content */}
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3 sm:gap-4">
          {/* Icon */}
          <div
            className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center"
            style={{
              background: hasAuthError ? 'rgba(232, 120, 109, 0.2)' : 'rgba(229, 185, 94, 0.2)',
            }}
          >
            {hasAuthError ? (
              // Key icon for auth errors
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-coral)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="sm:w-6 sm:h-6"
              >
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            ) : (
              // Warning icon for other errors
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-honey)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="sm:w-6 sm:h-6"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            )}
          </div>

          {/* Text content */}
          <div className="flex-1 min-w-0">
            <h3
              className="font-semibold text-sm sm:text-base"
              style={{ color: 'var(--foreground)' }}
            >
              {title}
            </h3>
            <p
              className="text-xs sm:text-sm mt-0.5 sm:mt-1 leading-relaxed"
              style={{ color: 'var(--muted)' }}
            >
              {description}
            </p>

            {/* Action button - full width on mobile */}
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <Link
                href="/innstillinger?tab=integrations"
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: hasAuthError ? 'var(--color-coral)' : 'var(--color-honey)',
                  color: 'white',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                {action}
              </Link>

              {/* Dismiss button - subtle on mobile */}
              <button
                onClick={() => setDismissed(true)}
                className="text-xs sm:text-sm py-2 px-3 rounded-lg transition-colors hover:bg-black/5"
                style={{ color: 'var(--muted)' }}
                aria-label="Avvis varsel"
              >
                Avvis
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Subtle accent stripe at top */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{
          background: hasAuthError ? 'var(--color-coral)' : 'var(--color-honey)',
        }}
      />
    </div>
  )
}
