'use client'

import { memo } from 'react'
import type { TranslationStrings, Language } from '@/lib/i18n/types'

interface FamilyCalendarSectionProps {
  familyCalendarUrl: string
  savingFamilyCalendar: boolean
  syncingFamilyCalendar: boolean
  familyCalendarLastSync: string | null
  familyCalendarError: string | null
  familyCalendarEventCount: number
  language: Language
  t: TranslationStrings
  onFamilyCalendarUrlChange: (url: string) => void
  onSaveFamilyCalendar: () => void
  onSyncFamilyCalendar: () => void
}

export const FamilyCalendarSection = memo(function FamilyCalendarSection({
  familyCalendarUrl,
  savingFamilyCalendar,
  syncingFamilyCalendar,
  familyCalendarLastSync,
  familyCalendarError,
  familyCalendarEventCount,
  language,
  t,
  onFamilyCalendarUrlChange,
  onSaveFamilyCalendar,
  onSyncFamilyCalendar,
}: FamilyCalendarSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm mb-1" style={{ color: 'var(--foreground)' }}>
          {t.settings.familyCalendarUrl || 'ICS-kalender URL'}
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={familyCalendarUrl}
            onChange={(e) => onFamilyCalendarUrlChange(e.target.value)}
            placeholder="https://calendar.google.com/calendar/ical/..."
            className="input"
            style={{ flex: '1 1 auto', minWidth: 0 }}
          />
          <button
            onClick={onSaveFamilyCalendar}
            disabled={savingFamilyCalendar}
            className="btn btn-primary"
          >
            {savingFamilyCalendar ? t.common.saving : t.common.save}
          </button>
        </div>
      </div>

      {familyCalendarUrl && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            onClick={onSyncFamilyCalendar}
            disabled={syncingFamilyCalendar}
            className="btn btn-secondary text-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {syncingFamilyCalendar ? (
              <>
                <svg width="14" height="14" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                {t.common.syncing || 'Synkroniserer...'}
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 2v6h-6"/>
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
                  <path d="M3 22v-6h6"/>
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
                </svg>
                {t.common.sync || 'Synkroniser'}
              </>
            )}
          </button>

          {familyCalendarLastSync && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {t.settings.lastSynced || 'Sist synkronisert'}: {new Date(familyCalendarLastSync).toLocaleString(language === 'en' ? 'en-GB' : language === 'sv' ? 'sv-SE' : 'nb-NO')}
            </span>
          )}
        </div>
      )}

      {/* Event count display */}
      {familyCalendarUrl && (
        <div className="text-xs" style={{ color: familyCalendarEventCount > 0 ? 'var(--color-sage)' : 'var(--muted)' }}>
          {familyCalendarEventCount > 0
            ? `${familyCalendarEventCount} ${familyCalendarEventCount === 1 ? (t.home.event || 'hendelse') : (t.home.events || 'hendelser')} i kalenderen`
            : (t.settings.noEventsInCalendar || 'Ingen hendelser funnet i kalenderen')}
        </div>
      )}

      {familyCalendarError && (
        <div className="p-3 rounded-lg text-sm" style={{ background: 'rgba(232, 120, 109, 0.1)', color: 'var(--color-coral)' }}>
          {familyCalendarError}
        </div>
      )}
    </div>
  )
})
