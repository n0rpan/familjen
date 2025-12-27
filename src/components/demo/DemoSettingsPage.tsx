'use client'

/**
 * DemoSettingsPage Component
 *
 * Client-side version of the settings page that uses demo data hooks.
 * Shows demo household settings, members, and children.
 */

import { useState } from 'react'
import { useHousehold, useMembers, useChildren } from '@/hooks/data'
import { useLanguage } from '@/lib/i18n/context'
import { TransitionLink } from '@/components/TransitionLink'

export function DemoSettingsPage() {
  const { t } = useLanguage()
  const [activeTab, setActiveTab] = useState<'profile' | 'household' | 'members' | 'children'>('household')

  const { household, currentMember, loading: householdLoading } = useHousehold()
  const { members, loading: membersLoading } = useMembers()
  const { children, loading: childrenLoading } = useChildren()

  const loading = householdLoading || membersLoading || childrenLoading

  const tabs = [
    { id: 'household' as const, label: 'Husstand' },
    { id: 'members' as const, label: 'Medlemmer' },
    { id: 'children' as const, label: 'Barn' },
    { id: 'profile' as const, label: 'Min profil' },
  ]

  if (loading) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.settings}</h1>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-12 bg-gray-200 rounded-xl" />
          <div className="h-48 bg-gray-200 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header mb-6">
        <h1 className="page-title">{t.nav.settings}</h1>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors`}
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
        {activeTab === 'household' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                Husstandsinnstillinger
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--muted)' }}>
                    Husstands navn
                  </label>
                  <input
                    type="text"
                    value={household?.name || ''}
                    readOnly
                    className="w-full px-4 py-2 rounded-lg"
                    style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--muted)' }}>
                    AI kontekst for måltider
                  </label>
                  <textarea
                    value={household?.ai_meal_context || ''}
                    readOnly
                    rows={3}
                    className="w-full px-4 py-2 rounded-lg"
                    style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'members' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
              Medlemmer ({members.length})
            </h2>
            {members.map(member => (
              <div
                key={member.id}
                className="flex items-center gap-4 p-4 rounded-lg"
                style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-semibold"
                  style={{ background: 'var(--accent)', color: 'white' }}
                >
                  {member.short_name?.[0] || member.name[0]}
                </div>
                <div className="flex-1">
                  <div className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    {member.name}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--muted)' }}>
                    {member.email}
                  </div>
                </div>
                {member.is_household_admin && (
                  <span
                    className="px-2 py-1 text-xs rounded-full"
                    style={{ background: 'rgba(229, 185, 94, 0.2)', color: 'var(--color-honey-dark)' }}
                  >
                    Admin
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'children' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
              Barn ({children.length})
            </h2>
            {children.map(child => (
              <div
                key={child.id}
                className="flex items-center gap-4 p-4 rounded-lg"
                style={{
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderLeft: `4px solid var(--color-${child.color})`,
                }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-semibold"
                  style={{ background: `var(--color-${child.color})`, color: 'white' }}
                >
                  {child.name[0]}
                </div>
                <div className="flex-1">
                  <div className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    {child.name}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--muted)' }}>
                    {child.location_name || 'Ingen lokasjon'}
                  </div>
                  {child.allergies && child.allergies.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {child.allergies.map((allergy, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 text-xs rounded-full"
                          style={{ background: 'rgba(232, 120, 109, 0.2)', color: 'var(--color-coral)' }}
                        >
                          {allergy}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'profile' && currentMember && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
              Min profil
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--muted)' }}>
                  Navn
                </label>
                <input
                  type="text"
                  value={currentMember.name}
                  readOnly
                  className="w-full px-4 py-2 rounded-lg"
                  style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--muted)' }}>
                  E-post
                </label>
                <input
                  type="email"
                  value={currentMember.email || ''}
                  readOnly
                  className="w-full px-4 py-2 rounded-lg"
                  style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                />
              </div>
              {currentMember.work_email && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--muted)' }}>
                    Jobb-e-post
                  </label>
                  <input
                    type="email"
                    value={currentMember.work_email}
                    readOnly
                    className="w-full px-4 py-2 rounded-lg"
                    style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Demo notice */}
      <div
        className="mt-6 p-4 rounded-lg text-center text-sm"
        style={{ background: 'rgba(229, 185, 94, 0.1)', color: 'var(--color-honey-dark)' }}
      >
        I demo-modus er endringer ikke lagret
      </div>
    </div>
  )
}
