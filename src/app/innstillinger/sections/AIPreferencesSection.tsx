'use client'

import { memo } from 'react'
import type { TranslationStrings } from '@/lib/i18n/types'

interface AIPreferencesSectionProps {
  shareNamesWithAi: boolean
  savingPrivacy: boolean
  aiMealContext: string
  savingAiContext: boolean
  t: TranslationStrings
  onToggleShareNames: () => void
  onAiContextChange: (context: string) => void
  onSaveAiContext: () => void
}

export const AIPreferencesSection = memo(function AIPreferencesSection({
  shareNamesWithAi,
  savingPrivacy,
  aiMealContext,
  savingAiContext,
  t,
  onToggleShareNames,
  onAiContextChange,
  onSaveAiContext,
}: AIPreferencesSectionProps) {
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
            <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 10 10.5v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
            <path d="M12 12v2"/>
            <path d="M10 22h4"/>
            <path d="M10 18h4v4h-4z"/>
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
            {t.week.aiSuggestions}
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.week.weekContext}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Privacy toggle */}
        <div
          className="p-4 rounded-xl"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <label className="flex items-start gap-4 cursor-pointer">
            <div className="relative flex-shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={shareNamesWithAi}
                onChange={onToggleShareNames}
                disabled={savingPrivacy}
                className="sr-only peer"
              />
              <div
                className="w-11 h-6 rounded-full transition-colors peer-focus:ring-2 peer-focus:ring-offset-2"
                style={{
                  background: shareNamesWithAi ? 'var(--color-sage)' : 'var(--muted)',
                }}
              />
              <div
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm"
                style={{
                  transform: shareNamesWithAi ? 'translateX(20px)' : 'translateX(0)',
                }}
              />
            </div>
            <div className="flex-1">
              <span className="block font-medium text-sm" style={{ color: 'var(--foreground)' }}>
                {t.settings?.shareNamesWithAi || 'Del barnas navn med AI'}
              </span>
              <span className="block text-xs mt-1" style={{ color: 'var(--muted)' }}>
                {shareNamesWithAi
                  ? (t.settings?.shareNamesEnabled || 'AI får se barnas navn for personlige forslag (f.eks. "Emma liker...")')
                  : (t.settings?.shareNamesDisabled || 'AI ser kun "Barn 1", "Barn 2" osv. med alder og allergier')}
              </span>
            </div>
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
            {t.week.weekContext}
          </label>
          <textarea
            value={aiMealContext}
            onChange={(e) => onAiContextChange(e.target.value)}
            placeholder={t.week.weekContextPlaceholder}
            rows={4}
            className="input resize-none"
          />
          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
            {t.admin.aiSettingsDesc}
          </p>
        </div>

        <button
          onClick={onSaveAiContext}
          disabled={savingAiContext}
          className="btn btn-primary"
        >
          {savingAiContext ? t.common.saving : t.common.save}
        </button>
      </div>
    </section>
  )
})
