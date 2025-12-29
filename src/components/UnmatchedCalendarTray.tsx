'use client'

import { useState } from 'react'
import type { UnmatchedCalendarInvite, HouseholdMember } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'

interface UnmatchedCalendarTrayProps {
  invites: UnmatchedCalendarInvite[]
  members: HouseholdMember[]
  onAssign: (invite: UnmatchedCalendarInvite, memberId: string) => void
  onDismiss: (inviteId: string) => void
}

export function UnmatchedCalendarTray({
  invites,
  members,
  onAssign,
  onDismiss,
}: UnmatchedCalendarTrayProps) {
  const { t } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
  const [assigningId, setAssigningId] = useState<string | null>(null)

  // Filter out expired invites (client-side)
  const today = new Date().toISOString().split('T')[0]
  const validInvites = invites.filter(invite => invite.expiresAt >= today)

  if (validInvites.length === 0) {
    return null
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('nb-NO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    })
  }

  const getDaysUntilExpiry = (expiresAt: string) => {
    const expiry = new Date(expiresAt)
    const now = new Date()
    const diffMs = expiry.getTime() - now.getTime()
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  }

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-[var(--sand)]"
        style={{
          color: 'var(--color-honey)',
          background: 'rgba(229, 185, 94, 0.1)',
          border: '1px solid rgba(229, 185, 94, 0.3)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
        {t.admin?.unmatchedInvites || 'Unmatched invites'}
        <span
          className="px-2 py-0.5 rounded-full text-xs font-semibold"
          style={{ background: 'var(--color-honey)', color: 'white' }}
        >
          {validInvites.length}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="mt-2 rounded-xl p-4 space-y-3"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.admin?.unmatchedInvitesDesc || 'These calendar invites could not be matched to a household member. Assign them or dismiss.'}
          </p>

          {validInvites.map((invite) => {
            const daysLeft = getDaysUntilExpiry(invite.expiresAt)
            const isAssigning = assigningId === invite.id

            return (
              <div
                key={invite.id}
                className="p-3 rounded-xl"
                style={{ background: 'var(--background)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      <span className="font-medium text-sm truncate" style={{ color: 'var(--foreground)' }}>
                        {invite.title}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                      <span>{formatDate(invite.date)}</span>
                      {invite.endDate && (
                        <>
                          <span>-</span>
                          <span>{formatDate(invite.endDate)}</span>
                        </>
                      )}
                      <span>•</span>
                      <span className="font-mono" title={t.admin?.emailMaskedForPrivacy || 'Email masked for privacy'}>
                        {invite.maskedEmail}
                      </span>
                    </div>
                    <div className="mt-1 text-xs" style={{ color: daysLeft <= 2 ? 'var(--color-coral)' : 'var(--muted)' }}>
                      {daysLeft <= 0
                        ? (t.admin?.expiringToday || 'Expires today')
                        : `${t.admin?.expiresIn || 'Expires in'} ${daysLeft} ${daysLeft === 1 ? (t.common?.day || 'day') : (t.common?.days || 'days')}`
                      }
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isAssigning ? (
                      <select
                        autoFocus
                        className="text-xs p-1.5 rounded-lg"
                        style={{
                          background: 'var(--card)',
                          border: '1px solid var(--border)',
                          color: 'var(--foreground)',
                        }}
                        onChange={(e) => {
                          if (e.target.value) {
                            onAssign(invite, e.target.value)
                          }
                          setAssigningId(null)
                        }}
                        onBlur={() => setAssigningId(null)}
                      >
                        <option value="">{t.week?.selectMember || 'Select member'}</option>
                        {members.filter(m => m.is_parent).map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <button
                          onClick={() => setAssigningId(invite.id)}
                          className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
                          style={{ color: 'var(--color-sage)' }}
                          title={t.admin?.assign || 'Assign'}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onDismiss(invite.id)}
                          className="p-2 rounded-lg transition-colors hover:bg-red-50"
                          style={{ color: 'var(--muted)' }}
                          title={t.common?.dismiss || 'Dismiss'}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
