'use client'

/**
 * DemoAdminPage Component
 *
 * Client-side version of the admin page that uses demo data hooks.
 * Shows fake households and allowed emails for demo purposes.
 */

import { useState } from 'react'
import { useAdmin } from '@/hooks/data'
import { useLanguage } from '@/lib/i18n/context'

type AdminTab = 'households' | 'emails' | 'ai'

export function DemoAdminPage() {
  const { t } = useLanguage()
  const [activeTab, setActiveTab] = useState<AdminTab>('households')

  const { households, allowedEmails, isAdmin, loading, error } = useAdmin()

  const tabs = [
    { id: 'households' as const, label: 'Husstander' },
    { id: 'emails' as const, label: 'Tillatte e-poster' },
    { id: 'ai' as const, label: 'AI-innstillinger' },
  ]

  if (loading) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.admin}</h1>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-12 bg-gray-200 rounded-xl" />
          <div className="h-48 bg-gray-200 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.admin}</h1>
        </div>
        <div className="card p-8 text-center">
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.admin}</h1>
        </div>
        <div className="card p-8 text-center">
          <p style={{ color: 'var(--muted)' }}>Du har ikke tilgang til admin-panelet</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header mb-6">
        <h1 className="page-title">{t.nav.admin}</h1>
        <p style={{ color: 'var(--muted)' }}>
          Administrer husstander og brukere
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
            style={{
              background: activeTab === tab.id ? 'var(--accent)' : 'var(--card)',
              color: activeTab === tab.id ? 'white' : 'var(--foreground)',
              border: `1px solid ${activeTab === tab.id ? 'transparent' : 'var(--border)'}`,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="card p-6">
        {activeTab === 'households' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
                Husstander ({households.length})
              </h2>
            </div>
            <div className="space-y-3">
              {households.map(household => (
                <div
                  key={household.id}
                  className="p-4 rounded-lg"
                  style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                        {household.name}
                      </h3>
                      <p className="text-sm" style={{ color: 'var(--muted)' }}>
                        {household.memberCount} medlemmer, {household.childrenCount} barn
                      </p>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      Opprettet: {new Date(household.created_at).toLocaleDateString('nb-NO')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'emails' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
                Tillatte e-poster ({allowedEmails.length})
              </h2>
              <button
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                + Legg til
              </button>
            </div>
            <div className="space-y-2">
              {allowedEmails.map(email => (
                <div
                  key={email.id}
                  className="flex items-center justify-between p-3 rounded-lg"
                  style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center gap-3">
                    <span style={{ color: 'var(--foreground)' }}>{email.email}</span>
                    {email.is_admin && (
                      <span
                        className="px-2 py-0.5 text-xs rounded-full"
                        style={{ background: 'rgba(229, 185, 94, 0.2)', color: 'var(--color-honey-dark)' }}
                      >
                        Admin
                      </span>
                    )}
                    {email.can_create_household && (
                      <span
                        className="px-2 py-0.5 text-xs rounded-full"
                        style={{ background: 'rgba(131, 166, 151, 0.2)', color: 'var(--color-sage)' }}
                      >
                        Kan opprette
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
              AI-innstillinger
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--muted)' }}>
                  AI-modell
                </label>
                <select
                  className="w-full px-4 py-2 rounded-lg"
                  style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                  defaultValue="google/gemini-2.5-flash-lite"
                >
                  <option value="google/gemini-2.5-flash-lite">Google Gemini 2.5 Flash Lite</option>
                  <option value="anthropic/claude-sonnet-4">Anthropic Claude Sonnet 4</option>
                  <option value="openai/gpt-4o">OpenAI GPT-4o</option>
                </select>
              </div>
              <div
                className="p-4 rounded-lg"
                style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
              >
                <h3 className="font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                  Forbruk denne måneden
                </h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-semibold" style={{ color: 'var(--accent)' }}>
                      1,247
                    </div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>Forespørsler</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold" style={{ color: 'var(--accent)' }}>
                      523K
                    </div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>Tokens</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold" style={{ color: 'var(--accent)' }}>
                      $0.52
                    </div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>Kostnad</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Demo notice */}
      <div
        className="mt-6 p-4 rounded-lg text-center text-sm"
        style={{ background: 'rgba(229, 185, 94, 0.1)', color: 'var(--color-honey-dark)' }}
      >
        Dette er demodata - faktiske husstander og brukere vises ikke
      </div>
    </div>
  )
}
