import type { Language, TranslationStrings } from '../types'
import { nb } from './nb'
import { sv } from './sv'
import { en } from './en'

export const translations: Record<Language, TranslationStrings> = {
  nb,
  sv,
  en,
}

/**
 * Get translations for a specific language
 */
export function getTranslations(lang: Language): TranslationStrings {
  return translations[lang]
}
