/**
 * Client-side cookie utilities for language preference
 */
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './types'

export const LANGUAGE_COOKIE_NAME = 'familjen-lang'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/**
 * Check if a string is a valid language code
 */
export function isValidLanguage(lang: string): boolean {
  return LANGUAGES.some(l => l.code === lang)
}

/**
 * Client-side: Get language from cookie
 */
export function getLanguageFromCookieClient(): Language {
  if (typeof document === 'undefined') return DEFAULT_LANGUAGE

  const match = document.cookie.match(new RegExp(`${LANGUAGE_COOKIE_NAME}=([^;]+)`))
  if (match && isValidLanguage(match[1])) {
    return match[1] as Language
  }

  return DEFAULT_LANGUAGE
}

/**
 * Client-side: Set language cookie
 */
export function setLanguageCookie(lang: Language): void {
  if (typeof document === 'undefined') return
  document.cookie = `${LANGUAGE_COOKIE_NAME}=${lang}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
}
