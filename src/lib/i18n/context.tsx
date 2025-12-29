'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { Language, TranslationStrings } from './types'
import { DEFAULT_LANGUAGE } from './types'
import { getTranslations } from './translations'
import { setLanguageCookie, getLanguageFromCookieClient } from './cookie'

interface LanguageContextValue {
  language: Language
  setLanguage: (lang: Language) => void
  t: TranslationStrings
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

interface LanguageProviderProps {
  children: ReactNode
  initialLanguage?: Language
}

/**
 * Provider component that wraps the app and provides language context
 */
export function LanguageProvider({ children, initialLanguage }: LanguageProviderProps) {
  // Use initial language from server, then sync with client cookie
  const [language, setLanguageState] = useState<Language>(initialLanguage ?? DEFAULT_LANGUAGE)
  const [isHydrated, setIsHydrated] = useState(false)

  // After hydration, check if client cookie differs from server-provided language
  useEffect(() => {
    setIsHydrated(true)
    const clientLang = getLanguageFromCookieClient()
    if (clientLang !== language) {
      // Client cookie takes precedence (user may have changed it)
      setLanguageState(clientLang)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    setLanguageCookie(lang)
    // Update html lang attribute
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang
    }
  }, [])

  const t = getTranslations(language)

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

/**
 * Hook to access language context
 * Returns: { language, setLanguage, t }
 */
export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}

/**
 * Hook to access just the translations
 * Convenience hook for components that only need t
 */
export function useTranslation(): TranslationStrings {
  const { t } = useLanguage()
  return t
}
