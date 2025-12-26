'use client'

import { memo, useEffect, useState, useMemo } from 'react'
import type { ExternalEvent, ExternalEventLocalOverrides } from '@/lib/types'
import type { TranslationStrings } from '@/lib/i18n/types'

interface ExternalEventModalProps {
  isOpen: boolean
  event: ExternalEvent | null
  saving: boolean
  t: TranslationStrings
  onSave: (updates: {
    local_overrides: ExternalEventLocalOverrides | null
    user_notes: string | null
    is_hidden: boolean
  }) => void
  onClose: () => void
}

export const ExternalEventModal = memo(function ExternalEventModal({
  isOpen,
  event,
  saving,
  t,
  onSave,
  onClose,
}: ExternalEventModalProps) {
  // Form state
  const [title, setTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventTime, setEventTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [location, setLocation] = useState('')
  const [userNotes, setUserNotes] = useState('')
  const [isHidden, setIsHidden] = useState(false)

  // Initialize form when event changes
  useEffect(() => {
    if (event) {
      const overrides = event.local_overrides
      setTitle(overrides?.title ?? event.title)
      setEventDate(overrides?.event_date ?? event.event_date)
      setEventTime(formatTimeForInput(overrides?.event_time ?? event.event_time))
      setEndDate(overrides?.end_date ?? event.end_date ?? '')
      setEndTime(formatTimeForInput(overrides?.end_time ?? event.end_time))
      setLocation(overrides?.location ?? event.location ?? '')
      setUserNotes(event.user_notes ?? '')
      setIsHidden(event.is_hidden)
    }
  }, [event])

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Check if any field has been modified from original
  const hasLocalEdits = useMemo(() => {
    if (!event) return false
    return (
      title !== event.title ||
      eventDate !== event.event_date ||
      formatTimeForInput(eventTime) !== formatTimeForInput(event.event_time) ||
      (endDate || null) !== (event.end_date || null) ||
      formatTimeForInput(endTime) !== formatTimeForInput(event.end_time) ||
      (location || null) !== (event.location || null)
    )
  }, [event, title, eventDate, eventTime, endDate, endTime, location])

  // Format time from HH:MM:SS to HH:MM for input
  function formatTimeForInput(time: string | null | undefined): string {
    if (!time) return ''
    return time.substring(0, 5)
  }

  // Format time from HH:MM to HH:MM:SS for storage
  function formatTimeForStorage(time: string): string | null {
    if (!time) return null
    return time.length === 5 ? `${time}:00` : time
  }

  // Reset all fields to original values
  const handleReset = () => {
    if (!event) return
    setTitle(event.title)
    setEventDate(event.event_date)
    setEventTime(formatTimeForInput(event.event_time))
    setEndDate(event.end_date ?? '')
    setEndTime(formatTimeForInput(event.end_time))
    setLocation(event.location ?? '')
  }

  // Handle save
  const handleSave = () => {
    if (!event) return

    // Build local overrides (only include changed fields)
    let localOverrides: ExternalEventLocalOverrides | null = null

    if (hasLocalEdits) {
      localOverrides = {}
      if (title !== event.title) localOverrides.title = title
      if (eventDate !== event.event_date) localOverrides.event_date = eventDate
      if (formatTimeForInput(eventTime) !== formatTimeForInput(event.event_time)) {
        localOverrides.event_time = formatTimeForStorage(eventTime)
      }
      if ((endDate || null) !== (event.end_date || null)) {
        localOverrides.end_date = endDate || null
      }
      if (formatTimeForInput(endTime) !== formatTimeForInput(event.end_time)) {
        localOverrides.end_time = formatTimeForStorage(endTime)
      }
      if ((location || null) !== (event.location || null)) {
        localOverrides.location = location || null
      }
    }

    onSave({
      local_overrides: localOverrides,
      user_notes: userNotes || null,
      is_hidden: isHidden,
    })
  }

  if (!isOpen || !event) return null

  // Get service display info
  const serviceName = event.integration?.service || 'external'
  const displayName = event.integration?.display_name || ''
  const serviceLabel = getServiceLabel(serviceName)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="external-event-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0, 0, 0, 0.5)' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-6 space-y-5 animate-fade-in"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2
            id="external-event-modal-title"
            className="text-xl font-semibold font-display"
            style={{ color: 'var(--foreground)' }}
          >
            {t.week.editEvent}
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

        {/* Source info banner */}
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: getServiceBackground(serviceName) }}
        >
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: getServiceColor(serviceName), color: 'white' }}
          >
            {getServiceBadge(serviceName)}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              {serviceLabel}
            </span>
            {displayName && (
              <span className="text-sm block truncate" style={{ color: 'var(--muted)' }}>
                {displayName}
              </span>
            )}
          </div>
        </div>

        {/* Hidden status toggle */}
        <div
          className="flex items-center justify-between p-3 rounded-xl"
          style={{ background: 'var(--background)' }}
        >
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isHidden ? (
                <>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </>
              ) : (
                <>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </>
              )}
            </svg>
            <span className="text-sm" style={{ color: 'var(--foreground)' }}>
              {isHidden ? 'Skjult fra kalender' : 'Synlig i kalender'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsHidden(!isHidden)}
            className="relative w-12 h-7 rounded-full transition-colors"
            style={{
              background: isHidden ? 'var(--muted)' : 'var(--accent)',
            }}
          >
            <span
              className="absolute top-1 w-5 h-5 rounded-full bg-white transition-transform"
              style={{
                left: isHidden ? '4px' : 'calc(100% - 24px)',
              }}
            />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                {t.week.eventTitle}
              </label>
              {title !== event.title && (
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  Opprinnelig: {event.title}
                </span>
              )}
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input"
              placeholder={t.week.eventTitle}
            />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  {t.week.startDate}
                </label>
              </div>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="input"
              />
              {eventDate !== event.event_date && (
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  Opprinnelig: {event.event_date}
                </span>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                {t.week.taskTime}
              </label>
              <input
                type="time"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                className="input"
              />
            </div>
          </div>

          {/* End Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                {t.week.endDate} <span style={{ color: 'var(--muted)' }}>({t.common.optional})</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input"
                min={eventDate}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                Sluttid <span style={{ color: 'var(--muted)' }}>({t.common.optional})</span>
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="input"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
              Sted <span style={{ color: 'var(--muted)' }}>({t.common.optional})</span>
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="input"
              placeholder="Legg til sted"
            />
          </div>

          {/* Description (read-only) */}
          {event.description && (
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                Beskrivelse
              </label>
              <div
                className="p-3 rounded-xl text-sm"
                style={{ background: 'var(--background)', color: 'var(--muted)' }}
              >
                {event.description}
              </div>
            </div>
          )}

          {/* Personal notes */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
              {t.week.taskNotes} <span style={{ color: 'var(--muted)' }}>({t.common.optional})</span>
            </label>
            <textarea
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              className="input min-h-[80px] resize-none"
              placeholder="Legg til egne notater..."
            />
          </div>
        </div>

        {/* Reset button (if there are local edits) */}
        {hasLocalEdits && (
          <button
            type="button"
            onClick={handleReset}
            className="w-full p-3 rounded-xl text-sm font-medium transition-colors"
            style={{ background: 'rgba(232, 120, 109, 0.1)', color: 'var(--color-coral)' }}
          >
            Tilbakestill til opprinnelige verdier
          </button>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="btn btn-secondary"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title || !eventDate}
            className="btn btn-primary"
          >
            {saving ? t.common.loading : t.common.save}
          </button>
        </div>
      </div>
    </div>
  )
})

// Helper functions for service styling
function getServiceLabel(service: string): string {
  switch (service.toLowerCase()) {
    case 'spond': return 'Spond'
    case 'kidplan': return 'Kidplan'
    case 'iskole': return 'iSkole'
    case 'mykid': return 'MyKid'
    default: return 'Ekstern kalender'
  }
}

function getServiceBadge(service: string): string {
  switch (service.toLowerCase()) {
    case 'spond': return 'S'
    case 'kidplan': return 'K'
    case 'iskole': return 'I'
    case 'mykid': return 'M'
    default: return 'E'
  }
}

function getServiceColor(service: string): string {
  switch (service.toLowerCase()) {
    case 'spond': return '#ff6b35'
    case 'kidplan': return '#4caf50'
    case 'iskole': return '#2196f3'
    case 'mykid': return '#9c27b0'
    default: return 'var(--accent)'
  }
}

function getServiceBackground(service: string): string {
  switch (service.toLowerCase()) {
    case 'spond': return 'rgba(255, 107, 53, 0.1)'
    case 'kidplan': return 'rgba(76, 175, 80, 0.1)'
    case 'iskole': return 'rgba(33, 150, 243, 0.1)'
    case 'mykid': return 'rgba(156, 39, 176, 0.1)'
    default: return 'var(--background)'
  }
}
