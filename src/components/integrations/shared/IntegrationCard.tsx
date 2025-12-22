'use client'

import { memo } from 'react'
import type { Integration, IntegrationMapping, ServiceName } from './types'

interface IntegrationCardProps {
  integration: Integration
  mappings: IntegrationMapping[]
  syncing: boolean
  service: ServiceName
  children?: React.ReactNode // For custom content in the card
  onSync: () => void
  onEdit: () => void
  onRemove: () => void
  renderMappings?: (mappings: IntegrationMapping[]) => React.ReactNode
}

const SERVICE_ICONS: Record<ServiceName, React.ReactNode> = {
  spond: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
      <line x1="9" y1="9" x2="9.01" y2="9"/>
      <line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>
  ),
  mykid: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>
      <path d="M17 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" opacity="0.5"/>
      <path d="M9 21c-3 0-6-2-6-6"/>
      <path d="M17 21c3 0 6-2 6-6" opacity="0.5"/>
    </svg>
  ),
  kidplan: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  iskole: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  ),
}

const SERVICE_COLORS: Record<ServiceName, string> = {
  spond: 'var(--color-sage)',
  mykid: 'var(--color-honey)',
  kidplan: 'var(--color-lavender)',
  iskole: 'var(--color-sky)',
}

export const IntegrationCard = memo(function IntegrationCard({
  integration,
  mappings,
  syncing,
  service,
  children,
  onSync,
  onEdit,
  onRemove,
  renderMappings,
}: IntegrationCardProps) {
  const color = SERVICE_COLORS[service]
  const icon = SERVICE_ICONS[service]
  const integrationMappings = mappings.filter((m) => m.id)

  return (
    <div
      className="p-4 rounded-xl"
      style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: `${color}20`, color }}
          >
            {icon}
          </div>
          <div>
            <p className="font-medium" style={{ color: 'var(--foreground)' }}>
              {integration.displayName}
            </p>
            {integration.accountEmail && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {integration.accountEmail}
              </p>
            )}
          </div>
        </div>

        <SyncStatusBadge
          status={integration.lastSyncStatus}
          lastSyncAt={integration.lastSyncAt}
        />
      </div>

      {/* Mappings display */}
      {integrationMappings.length > 0 && (
        <div className="mb-3">
          {renderMappings ? (
            renderMappings(integrationMappings)
          ) : (
            <div className="flex flex-wrap gap-2">
              {integrationMappings.map((mapping) => (
                <span
                  key={mapping.id}
                  className="px-2 py-1 rounded-lg text-xs"
                  style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
                >
                  {mapping.groupName}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Custom content */}
      {children}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={onSync}
          disabled={syncing}
          className="btn btn-secondary text-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          {syncing ? (
            <>
              <svg width="14" height="14" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              Synkroniserer...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 2v6h-6"/>
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
                <path d="M3 22v-6h6"/>
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
              </svg>
              Synkroniser
            </>
          )}
        </button>

        <button
          onClick={onEdit}
          className="btn btn-secondary text-sm"
        >
          Rediger koblinger
        </button>

        <button
          onClick={onRemove}
          className="btn text-sm"
          style={{ color: 'var(--color-coral)' }}
        >
          Fjern
        </button>
      </div>
    </div>
  )
})

interface SyncStatusBadgeProps {
  status: string
  lastSyncAt: string | null
}

export const SyncStatusBadge = memo(function SyncStatusBadge({
  status,
  lastSyncAt,
}: SyncStatusBadgeProps) {
  const getStatusColor = (s: string) => {
    switch (s) {
      case 'ok':
        return { bg: 'rgba(139, 178, 139, 0.2)', color: 'var(--color-sage)' }
      case 'error':
      case 'auth_failed':
        return { bg: 'rgba(232, 120, 109, 0.2)', color: 'var(--color-coral)' }
      case 'syncing':
        return { bg: 'rgba(229, 185, 94, 0.2)', color: 'var(--color-honey)' }
      default:
        return { bg: 'var(--sand)', color: 'var(--muted)' }
    }
  }

  const getStatusText = (s: string) => {
    switch (s) {
      case 'ok':
        return 'OK'
      case 'error':
        return 'Feil'
      case 'auth_failed':
        return 'Innlogging feilet'
      case 'syncing':
        return 'Synkroniserer'
      default:
        return 'Aldri synkronisert'
    }
  }

  const formatSyncTime = (time: string | null) => {
    if (!time) return null
    const date = new Date(time)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return 'Nettopp'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min siden`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} t siden`
    return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
  }

  const colors = getStatusColor(status)

  return (
    <div className="text-right">
      <span
        className="inline-block px-2 py-1 rounded-lg text-xs font-medium"
        style={{ background: colors.bg, color: colors.color }}
      >
        {getStatusText(status)}
      </span>
      {lastSyncAt && (
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {formatSyncTime(lastSyncAt)}
        </p>
      )}
    </div>
  )
})
