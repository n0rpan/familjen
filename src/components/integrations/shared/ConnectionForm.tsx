'use client'

import { memo, useState, useCallback } from 'react'
import type { CredentialField } from './types'

interface ConnectionFormProps {
  fields: CredentialField[]
  serviceName: string
  testing: boolean
  tested: boolean
  connecting: boolean
  onTest: (credentials: Record<string, string>) => void
  onSave: (credentials: Record<string, string>) => void
  onCancel: () => void
  title?: string
  saveLabel?: string
  successText?: string
  children?: React.ReactNode // For mapping UI after connection tested
  canSave?: boolean // Whether save button should be enabled
}

export const ConnectionForm = memo(function ConnectionForm({
  fields,
  serviceName,
  testing,
  tested,
  connecting,
  onTest,
  onSave,
  onCancel,
  title,
  saveLabel = 'Lagre',
  successText = 'Tilkobling bekreftet',
  children,
  canSave = true,
}: ConnectionFormProps) {
  const [credentials, setCredentials] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, '']))
  )

  const handleChange = useCallback((key: string, value: string) => {
    setCredentials((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleTest = useCallback(() => {
    onTest(credentials)
  }, [credentials, onTest])

  const handleSave = useCallback(() => {
    onSave(credentials)
  }, [credentials, onSave])

  const allFieldsFilled = fields.every((f) => credentials[f.key]?.trim())

  return (
    <div
      className="p-4 rounded-xl space-y-4"
      style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
    >
      <p className="font-medium" style={{ color: 'var(--foreground)' }}>
        {title || `Koble til ${serviceName}`}
      </p>

      {/* Credential inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((field) => (
          <div key={field.key}>
            <label className="block text-sm mb-1" style={{ color: 'var(--muted)' }}>
              {field.label}
            </label>
            <input
              type={field.type}
              value={credentials[field.key]}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="input w-full"
              disabled={tested}
              autoComplete={field.type === 'password' ? 'current-password' : undefined}
            />
          </div>
        ))}
      </div>

      {/* Test connection button */}
      {!tested && (
        <button
          onClick={handleTest}
          disabled={testing || !allFieldsFilled}
          className="btn btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          {testing ? (
            <>
              <svg width="14" height="14" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              Tester tilkobling...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              Test tilkobling
            </>
          )}
        </button>
      )}

      {/* Connection tested indicator */}
      {tested && (
        <div
          className="flex items-center gap-2 p-3 rounded-lg"
          style={{ background: 'rgba(139, 178, 139, 0.15)', color: 'var(--color-sage)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span className="text-sm font-medium">{successText}</span>
        </div>
      )}

      {/* Custom content (mapping UI) */}
      {tested && children}

      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        {tested && (
          <button
            onClick={handleSave}
            disabled={connecting || !canSave}
            className="btn btn-primary"
          >
            {connecting ? 'Lagrer...' : saveLabel}
          </button>
        )}
        <button
          onClick={onCancel}
          className="btn btn-secondary"
        >
          Avbryt
        </button>
      </div>
    </div>
  )
})

interface LoadingSkeletonProps {
  count?: number
}

export const LoadingSkeleton = memo(function LoadingSkeleton({
  count = 1,
}: LoadingSkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-xl animate-pulse"
          style={{ background: 'var(--background)' }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-lg"
              style={{ background: 'var(--sand)' }}
            />
            <div className="space-y-2 flex-1">
              <div
                className="h-4 rounded w-1/3"
                style={{ background: 'var(--sand)' }}
              />
              <div
                className="h-3 rounded w-1/4"
                style={{ background: 'var(--sand)' }}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <div
              className="h-8 rounded-lg w-24"
              style={{ background: 'var(--sand)' }}
            />
            <div
              className="h-8 rounded-lg w-28"
              style={{ background: 'var(--sand)' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
})

interface EmptyStateProps {
  serviceName: string
  onAdd: () => void
}

export const EmptyState = memo(function EmptyState({
  serviceName,
  onAdd,
}: EmptyStateProps) {
  return (
    <div className="text-center py-8">
      <p className="mb-4" style={{ color: 'var(--muted)' }}>
        Ingen {serviceName}-integrasjon ennå
      </p>
      <button onClick={onAdd} className="btn btn-primary">
        + Legg til {serviceName}
      </button>
    </div>
  )
})
