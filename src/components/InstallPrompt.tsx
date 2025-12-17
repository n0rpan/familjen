'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n/context'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Track visits and engagement for smarter install prompt timing
const VISIT_THRESHOLD = 3
const STORAGE_KEY = 'familjen-install-prompt'

function getInstallPromptState() {
  if (typeof window === 'undefined') return { visits: 0, engaged: false, dismissed: false }
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : { visits: 0, engaged: false, dismissed: false }
  } catch {
    return { visits: 0, engaged: false, dismissed: false }
  }
}

function updateInstallPromptState(updates: Partial<{ visits: number; engaged: boolean; dismissed: boolean }>) {
  if (typeof window === 'undefined') return
  try {
    const current = getInstallPromptState()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...updates }))
  } catch {
    // localStorage not available
  }
}

// Call this when user engages with a core feature (e.g., adds a pickup, creates a meal plan)
// This will make the install prompt show on next visit
export function markUserEngaged() {
  updateInstallPromptState({ engaged: true })
}

export function InstallPrompt() {
  const { t } = useLanguage()
  const [isInstalled, setIsInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isAndroid, setIsAndroid] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showInstructions, setShowInstructions] = useState(false)
  const [shouldShowPrompt, setShouldShowPrompt] = useState(false)

  useEffect(() => {
    // Check if already installed (standalone mode)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    setIsInstalled(isStandalone)

    // Detect platform
    const ua = navigator.userAgent.toLowerCase()
    setIsIOS(/iphone|ipad|ipod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream)
    setIsAndroid(/android/.test(ua))

    // Track visit and check if we should show prompt
    const state = getInstallPromptState()
    const newVisits = state.visits + 1
    updateInstallPromptState({ visits: newVisits })

    // Show prompt after 3+ visits OR if user has engaged with core features
    // Don't show if user previously dismissed
    if (!state.dismissed && (newVisits >= VISIT_THRESHOLD || state.engaged)) {
      setShouldShowPrompt(true)
    }

    // Listen for install prompt (Android/Chrome)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
    }
  }, [])

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Android/Chrome - use native prompt
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setDeferredPrompt(null)
      }
    } else {
      // iOS or other - show instructions
      setShowInstructions(true)
    }
  }

  const handleDismiss = () => {
    updateInstallPromptState({ dismissed: true })
    setShouldShowPrompt(false)
  }

  // Already installed
  if (isInstalled) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(139, 168, 136, 0.15)' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div>
          <p className="font-medium" style={{ color: 'var(--color-sage)' }}>
            {t.install?.installed || 'App installert'}
          </p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.install?.installedDesc || 'Familjen er lagt til på hjemskjermen din.'}
          </p>
        </div>
      </div>
    )
  }

  // Don't show prompt until user has earned it (3+ visits or engaged)
  if (!shouldShowPrompt) {
    return null
  }

  return (
    <div>
      <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: 'var(--card-alt)' }}>
        <div className="flex-1">
          <p className="font-medium">{t.install?.title || 'Installer app'}</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.install?.description || 'Legg til Familjen på hjemskjermen for raskere tilgang.'}
          </p>
        </div>
        <div className="flex items-center gap-2 ml-3">
          <button
            onClick={handleDismiss}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
            style={{ color: 'var(--muted)' }}
            aria-label={t.common?.dismiss || 'Dismiss'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <button
            onClick={handleInstallClick}
            className="px-4 py-2 rounded-lg font-medium transition-colors"
            style={{ background: 'var(--color-sky)', color: 'white' }}
          >
            {t.install?.install || 'Installer'}
          </button>
        </div>
      </div>

      {/* Instructions modal */}
      {showInstructions && (
        <div className="mt-4 p-4 rounded-xl" style={{ background: 'rgba(126, 182, 196, 0.15)', border: '1px solid var(--color-sky)' }}>
          <div className="flex justify-between items-start mb-3">
            <h4 className="font-medium" style={{ color: 'var(--color-sky)' }}>
              {t.install?.howTo || 'Slik installerer du'}
            </h4>
            <button
              onClick={() => setShowInstructions(false)}
              className="p-1 rounded hover:bg-[var(--sand)]"
              style={{ color: 'var(--muted)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {isIOS ? (
            <ol className="text-sm space-y-2" style={{ color: 'var(--foreground)' }}>
              <li className="flex items-start gap-2">
                <span className="font-bold" style={{ color: 'var(--color-sky)' }}>1.</span>
                <span>{t.install?.iosStep1 || 'Trykk på Del-ikonet'} <span className="inline-block align-middle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                    <polyline points="16 6 12 2 8 6"/>
                    <line x1="12" y1="2" x2="12" y2="15"/>
                  </svg>
                </span> {t.install?.iosStep1b || 'nederst i Safari'}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold" style={{ color: 'var(--color-sky)' }}>2.</span>
                <span>{t.install?.iosStep2 || 'Bla ned og trykk "Legg til på Hjem-skjerm"'}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold" style={{ color: 'var(--color-sky)' }}>3.</span>
                <span>{t.install?.iosStep3 || 'Trykk "Legg til"'}</span>
              </li>
            </ol>
          ) : (
            <ol className="text-sm space-y-2" style={{ color: 'var(--foreground)' }}>
              <li className="flex items-start gap-2">
                <span className="font-bold" style={{ color: 'var(--color-sky)' }}>1.</span>
                <span>{t.install?.androidStep1 || 'Trykk på meny-ikonet (⋮) i nettleseren'}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold" style={{ color: 'var(--color-sky)' }}>2.</span>
                <span>{t.install?.androidStep2 || 'Velg "Installer app" eller "Legg til på startskjermen"'}</span>
              </li>
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
