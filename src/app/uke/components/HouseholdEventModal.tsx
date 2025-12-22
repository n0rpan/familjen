'use client'

import { memo, useEffect } from 'react'
import type { HouseholdEvent } from '@/lib/types'
import type { TranslationStrings } from '@/lib/i18n/types'

interface HouseholdEventModalProps {
  isOpen: boolean
  editingEvent: HouseholdEvent | null
  eventForm: {
    title: string
    date: string
    end_date: string
    time: string
    location: string
  }
  saving: boolean
  t: TranslationStrings
  onFormChange: (form: HouseholdEventModalProps['eventForm']) => void
  onSave: () => void
  onDelete: () => void
  onClose: () => void
}

export const HouseholdEventModal = memo(function HouseholdEventModal({
  isOpen,
  editingEvent,
  eventForm,
  saving,
  t,
  onFormChange,
  onSave,
  onDelete,
  onClose,
}: HouseholdEventModalProps) {
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

  const isIcsEvent = editingEvent?.source === 'ics_calendar'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="household-event-modal-title"
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
            id="household-event-modal-title"
            className="text-xl font-semibold font-display"
            style={{ color: 'var(--foreground)' }}
          >
            {editingEvent ? t.week.editEvent : t.week.familyEvent}
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

        {/* ICS source warning */}
        {isIcsEvent && (
          <div
            className="flex items-center gap-2 p-3 rounded-lg text-sm"
            style={{ background: 'rgba(167, 139, 250, 0.15)', color: 'var(--foreground)' }}
          >
            <span>📅</span>
            <span>{t.week.icsEventReadOnly}</span>
          </div>
        )}

        {/* Form */}
        <div className="space-y-4">
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
              placeholder={t.week.familyEvent}
              disabled={isIcsEvent}
            />
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
                disabled={isIcsEvent}
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
                disabled={isIcsEvent}
              />
            </div>
          </div>

          {/* Time (optional) */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
              {t.week.taskTime} <span style={{ color: 'var(--muted)' }}>({t.common.optional})</span>
            </label>
            <input
              type="time"
              value={eventForm.time}
              onChange={(e) => onFormChange({ ...eventForm, time: e.target.value })}
              className="input"
              disabled={isIcsEvent}
            />
          </div>

          {/* Location (optional, read-only for ICS events) */}
          {editingEvent?.location && (
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                📍 {editingEvent.location}
              </label>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <div>
            {editingEvent && !isIcsEvent && (
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
              {isIcsEvent ? t.common.close : t.common.cancel}
            </button>
            {!isIcsEvent && (
              <button
                onClick={onSave}
                disabled={saving || !eventForm.title || !eventForm.date}
                className="btn btn-primary"
              >
                {saving ? t.common.loading : t.common.save}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
