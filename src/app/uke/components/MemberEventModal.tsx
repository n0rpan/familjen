'use client'

import { memo, useEffect } from 'react'
import type { HouseholdMember, MemberEvent, MemberEventType } from '@/lib/types'
import type { TranslationStrings } from '@/lib/i18n/types'

interface MemberEventModalProps {
  isOpen: boolean
  editingEvent: MemberEvent | null
  eventForm: {
    member_id: string
    title: string
    event_type: MemberEventType
    date: string
    end_date: string
  }
  members: HouseholdMember[]
  saving: boolean
  t: TranslationStrings
  onFormChange: (form: MemberEventModalProps['eventForm']) => void
  onSave: () => void
  onDelete: () => void
  onClose: () => void
}

export const MemberEventModal = memo(function MemberEventModal({
  isOpen,
  editingEvent,
  eventForm,
  members,
  saving,
  t,
  onFormChange,
  onSave,
  onDelete,
  onClose,
}: MemberEventModalProps) {
  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const eventTypes = [
    { value: 'work', label: `💼 ${t.week.eventTypes.work}`, bg: 'rgba(126, 182, 196, 0.2)' },
    { value: 'travel', label: `✈️ ${t.week.eventTypes.travel}`, bg: 'rgba(167, 139, 250, 0.2)' },
    { value: 'family', label: `👨‍👩‍👧 ${t.week.eventTypes.family}`, bg: 'rgba(232, 120, 109, 0.2)' },
    { value: 'other', label: `📅 ${t.week.eventTypes.other}`, bg: 'rgba(131, 166, 151, 0.2)' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-event-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0, 0, 0, 0.5)' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-2xl p-6 space-y-5 animate-fade-in"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2
            id="member-event-modal-title"
            className="text-xl font-semibold font-display"
            style={{ color: 'var(--foreground)' }}
          >
            {editingEvent ? t.week.editEvent : t.week.addEvent}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--muted)' }}
            aria-label={t.common.close}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Member select */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
              {t.week.selectMember}
            </label>
            <select
              value={eventForm.member_id}
              onChange={(e) => onFormChange({ ...eventForm, member_id: e.target.value })}
              className="input"
            >
              <option value="">{t.week.selectMember}</option>
              {members.filter(m => m.is_parent).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
              {t.week.eventTitle}
            </label>
            <input
              type="text"
              value={eventForm.title}
              onChange={(e) => onFormChange({ ...eventForm, title: e.target.value })}
              className="input"
              placeholder={t.week.eventTitle}
            />
          </div>

          {/* Event type */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
              {t.week.eventType}
            </label>
            <div className="flex flex-wrap gap-2">
              {eventTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => onFormChange({ ...eventForm, event_type: type.value as MemberEventType })}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: type.bg,
                    border: eventForm.event_type === type.value ? '2px solid var(--foreground)' : '2px solid transparent',
                    transform: eventForm.event_type === type.value ? 'scale(1.05)' : undefined,
                  }}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                {t.week.startDate}
              </label>
              <input
                type="date"
                value={eventForm.date}
                onChange={(e) => onFormChange({ ...eventForm, date: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                {t.week.endDate} <span style={{ color: 'var(--muted)' }}>({t.common.optional})</span>
              </label>
              <input
                type="date"
                value={eventForm.end_date}
                onChange={(e) => onFormChange({ ...eventForm, end_date: e.target.value })}
                className="input"
                min={eventForm.date}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <div>
            {editingEvent && (
              <button
                onClick={onDelete}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ color: 'var(--color-coral)' }}
              >
                {t.common.delete}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="btn btn-secondary"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={onSave}
              disabled={saving || !eventForm.member_id || !eventForm.title || !eventForm.date}
              className="btn btn-primary"
            >
              {saving ? t.common.loading : t.common.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
