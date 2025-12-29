import 'server-only'
import { cookies, headers } from 'next/headers'
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './types'

export const LANGUAGE_COOKIE_NAME = 'familjen-lang'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/**
 * Server-side: Get language from cookie or detect from browser
 */
export async function getLanguageFromCookieOrBrowser(): Promise<Language> {
  const cookieStore = await cookies()
  const cookieLang = cookieStore.get(LANGUAGE_COOKIE_NAME)?.value

  // Check if cookie has valid language
  if (cookieLang && isValidLanguage(cookieLang)) {
    return cookieLang as Language
  }

  // Detect from browser Accept-Language header
  const headersList = await headers()
  const acceptLanguage = headersList.get('accept-language')
  if (acceptLanguage) {
    const detected = detectLanguageFromHeader(acceptLanguage)
    if (detected) {
      return detected
    }
  }

  return DEFAULT_LANGUAGE
}

/**
 * Parse Accept-Language header and return first matching language
 * Example: "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7,nb;q=0.6"
 */
function detectLanguageFromHeader(acceptLanguage: string): Language | null {
  // Parse into array of language codes (ignoring region and quality)
  const languages = acceptLanguage
    .split(',')
    .map(lang => {
      const [code] = lang.trim().split(';')
      // Get primary language code (e.g., "sv-SE" -> "sv")
      return code.split('-')[0].toLowerCase()
    })

  // Find first matching supported language
  for (const lang of languages) {
    if (isValidLanguage(lang)) {
      return lang as Language
    }
  }

  return null
}

/**
 * Check if a string is a valid language code
 */
function isValidLanguage(lang: string): boolean {
  return LANGUAGES.some(l => l.code === lang)
}
