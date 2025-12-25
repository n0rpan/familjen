'use client'

import { memo } from 'react'
import type { Household, AllowedEmail } from '@/lib/types'
import type { TranslationStrings } from '@/lib/i18n/types'

interface HouseholdAdminSectionProps {
  household: Household | null
  inviteEmail: string
  invitedEmails: AllowedEmail[]
  savingInvite: boolean
  showDeleteConfirm: boolean
  deleteConfirmText: string
  t: TranslationStrings
  onInviteEmailChange: (email: string) => void
  onInviteUser: (e: React.FormEvent) => void
  onRemoveInvite: (emailId: string) => void
  onShowDeleteConfirmChange: (show: boolean) => void
  onDeleteConfirmTextChange: (text: string) => void
  onDeleteHousehold: () => void
}

export const HouseholdAdminSection = memo(function HouseholdAdminSection({
  household,
  inviteEmail,
  invitedEmails,
  savingInvite,
  showDeleteConfirm,
  deleteConfirmText,
  t,
  onInviteEmailChange,
  onInviteUser,
  onRemoveInvite,
  onShowDeleteConfirmChange,
  onDeleteConfirmTextChange,
  onDeleteHousehold,
}: HouseholdAdminSectionProps) {
  return (
    <section
      className="rounded-2xl p-6 md:p-8"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(229, 185, 94, 0.2)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
            {t.settings.household}
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.admin.userAccessDesc}
          </p>
        </div>
      </div>

      {/* Invite form */}
      <form onSubmit={onInviteUser} className="mb-6">
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
          {t.admin.addUser}
        </label>
        <div className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => onInviteEmailChange(e.target.value)}
            placeholder={t.admin.emailPlaceholder}
            className="input"
            style={{ flex: '1 1 auto', minWidth: 0 }}
            required
          />
          <button
            type="submit"
            disabled={savingInvite || !inviteEmail.trim()}
            className="btn btn-primary"
          >
            {savingInvite ? t.common.saving : t.common.add}
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          {t.admin.usersAddedViaSettings}
        </p>
      </form>

      {/* Invited emails list */}
      {invitedEmails.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--foreground)' }}>
            Inviterte brukere
          </p>
          <div className="space-y-2">
            {invitedEmails.map((email) => (
              <div
                key={email.id}
                className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: 'var(--background)' }}
              >
                <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                  {email.email}
                </span>
                <button
                  onClick={() => onRemoveInvite(email.id)}
                  className="p-1 rounded hover:bg-red-50 transition-colors"
                  style={{ color: 'var(--muted)' }}
                  title="Fjern invitasjon"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete household */}
      <div className="pt-6" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-coral)' }}>
          {t.settings.dangerZone}
        </p>
        {!showDeleteConfirm ? (
          <button
            onClick={() => onShowDeleteConfirmChange(true)}
            className="btn text-sm"
            style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
          >
            {t.common.delete} {t.settings.household.toLowerCase()}
          </button>
        ) : (
          <div className="p-4 rounded-xl" style={{ background: 'rgba(232, 120, 109, 0.1)', border: '1px solid var(--color-coral)' }}>
            <p className="text-sm mb-3" style={{ color: 'var(--foreground)' }}>
              {t.common.confirmDelete}
            </p>
            <p className="text-sm mb-3" style={{ color: 'var(--foreground)' }}>
              &quot;<strong>{household?.name}</strong>&quot;
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => onDeleteConfirmTextChange(e.target.value)}
              placeholder={household?.name || ''}
              className="input mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={onDeleteHousehold}
                disabled={deleteConfirmText !== household?.name}
                className="btn"
                style={{
                  background: deleteConfirmText === household?.name ? 'var(--color-coral)' : 'var(--muted)',
                  color: 'white',
                }}
              >
                {t.common.delete}
              </button>
              <button
                onClick={() => {
                  onShowDeleteConfirmChange(false)
                  onDeleteConfirmTextChange('')
                }}
                className="btn btn-secondary"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
})
