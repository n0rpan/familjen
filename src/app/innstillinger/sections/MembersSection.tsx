'use client'

import { memo } from 'react'
import type { HouseholdMember } from '@/lib/types'
import type { TranslationStrings } from '@/lib/i18n/types'

interface MembersSectionProps {
  members: HouseholdMember[]
  newMember: {
    name: string
    short_name: string
    is_parent: boolean
    email: string
    birth_date: string
    work_email: string
  }
  saving: boolean
  t: TranslationStrings
  onNewMemberChange: (member: MembersSectionProps['newMember']) => void
  onAddMember: (e: React.FormEvent) => void
  onDeleteMember: (id: string) => void
}

export const MembersSection = memo(function MembersSection({
  members,
  newMember,
  saving,
  t,
  onNewMemberChange,
  onAddMember,
  onDeleteMember,
}: MembersSectionProps) {
  return (
    <div className="space-y-4">
      {/* Existing members */}
      <div className="space-y-2 mb-6">
        {members.length === 0 ? (
          <p className="text-center py-8" style={{ color: 'var(--muted)' }}>
            {t.common.noResults}
          </p>
        ) : (
          members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-4 rounded-xl transition-colors"
              style={{ background: 'var(--background)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                  style={{
                    background: member.is_parent ? 'var(--color-coral)' : 'var(--color-sage)',
                    color: 'white',
                  }}
                >
                  {(member.short_name || member.name).substring(0, 3)}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                      {member.name}
                    </span>
                    {member.is_parent && (
                      <span className="badge badge-coral">{t.settings.isParent}</span>
                    )}
                    {member.user_id ? (
                      <span className="badge badge-sage">{t.admin.connected}</span>
                    ) : member.email ? (
                      <span className="badge badge-honey">{t.common.pending}</span>
                    ) : null}
                  </div>
                  {member.email && (
                    <span className="text-sm" style={{ color: 'var(--muted)' }}>
                      {member.email}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => onDeleteMember(member.id)}
                className="p-2 rounded-lg transition-colors hover:bg-red-50"
                style={{ color: 'var(--muted)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3,6 5,6 21,6"/>
                  <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add new member form */}
      <form onSubmit={onAddMember} className="pt-6" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-sm font-medium mb-4" style={{ color: 'var(--foreground)' }}>
          {t.settings.addMember}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
              {t.settings.memberName}
            </label>
            <input
              type="text"
              placeholder={t.settings.memberName}
              value={newMember.name}
              onChange={(e) => onNewMemberChange({ ...newMember, name: e.target.value })}
              className="input"
              required
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
              {t.settings.memberShortName} ({t.common.optional})
            </label>
            <input
              type="text"
              placeholder={t.settings.shortNamePlaceholder}
              value={newMember.short_name}
              onChange={(e) => onNewMemberChange({ ...newMember, short_name: e.target.value })}
              className="input"
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
              {t.settings.memberEmailLabel || 'E-post (gir app-tilgang)'}
            </label>
            <input
              type="email"
              placeholder={t.admin.emailPlaceholder}
              value={newMember.email}
              onChange={(e) => onNewMemberChange({ ...newMember, email: e.target.value })}
              className="input"
            />
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              {t.settings.memberEmailHint || 'Kun nødvendig hvis de skal logge inn i appen'}
            </p>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.memberBirthDate} ({t.common.optional})</label>
            {newMember.birth_date ? (
              <div className="flex gap-2">
                <input
                  type="date"
                  value={newMember.birth_date}
                  onChange={(e) => onNewMemberChange({ ...newMember, birth_date: e.target.value })}
                  className="input flex-1"
                />
                <button
                  type="button"
                  onClick={() => onNewMemberChange({ ...newMember, birth_date: '' })}
                  className="px-3 rounded-xl transition-colors hover:bg-[var(--sand)]"
                  style={{ color: 'var(--muted)' }}
                  title={t.common.remove}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onNewMemberChange({ ...newMember, birth_date: new Date().toISOString().split('T')[0] })}
                className="input text-left w-full"
                style={{ color: 'var(--muted)' }}
              >
                + {t.settings.memberBirthDate}
              </button>
            )}
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.memberWorkEmail}</label>
            <input
              type="email"
              placeholder={t.settings.workEmailPlaceholder}
              value={newMember.work_email}
              onChange={(e) => onNewMemberChange({ ...newMember, work_email: e.target.value })}
              className="input"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={newMember.is_parent}
              onChange={(e) => onNewMemberChange({ ...newMember, is_parent: e.target.checked })}
              className="w-5 h-5 rounded"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="text-sm" style={{ color: 'var(--foreground)' }}>{t.settings.isParent}</span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--sand)', color: 'var(--muted)' }}>
              {t.settings.isParentDesc}
            </span>
          </label>
          <button
            type="submit"
            disabled={saving || !newMember.name}
            className="btn btn-primary ml-auto"
          >
            + {t.common.add}
          </button>
        </div>
      </form>
    </div>
  )
})
