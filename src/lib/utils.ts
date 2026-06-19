import type { Language, TranslationStrings } from './i18n/types'
import { getTranslations } from './i18n/translations'

/**
 * Get the locale string for Intl APIs based on language
 */
export function getLocale(language: Language): string {
  switch (language) {
    case 'nb': return 'nb-NO'
    case 'sv': return 'sv-SE'
    case 'en': return 'en-US'
    default: return 'nb-NO'
  }
}

/**
 * Format a relative time string like "2 days ago", "1 week ago"
 * Uses localized strings from translations
 */
export function formatRelativeTime(
  dateStr: string,
  language: Language,
  t: TranslationStrings
): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return t.common.today
  if (diffDays === 1) return t.common.yesterday
  if (diffDays < 7) {
    const suffix = language === 'en' ? 'ago' : language === 'sv' ? 'sedan' : 'siden'
    return `${diffDays} ${t.common.days} ${suffix}`
  }
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7)
    const weekWord = weeks === 1
      ? (language === 'en' ? 'week' : language === 'sv' ? 'vecka' : 'uke')
      : (language === 'en' ? 'weeks' : language === 'sv' ? 'veckor' : 'uker')
    const suffix = language === 'en' ? 'ago' : language === 'sv' ? 'sedan' : 'siden'
    return `${weeks} ${weekWord} ${suffix}`
  }

  // For dates older than 30 days, show the formatted date
  return formatDateShort(dateStr, language)
}

/**
 * Format a date as short localized string (e.g., "16 Dec", "16 des")
 */
export function formatDateShort(dateStr: string, language: Language): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString(getLocale(language), { day: 'numeric', month: 'short' })
}

/**
 * Format a date in localized style: "mandag 16. desember" (nb), "Monday 16. december" (en)
 */
export function formatDateLocalized(date: Date, lang: Language): string {
  const t = getTranslations(lang)
  const dayOfWeek = t.date.weekdays[getWeekdayIndex(date)]
  const dayOfMonth = date.getDate()
  const month = t.date.months[date.getMonth()]
  return `${dayOfWeek.toLowerCase()} ${dayOfMonth}. ${month}`
}

/**
 * Format a date as ISO date string (YYYY-MM-DD) using local timezone
 * Note: Uses local date components to avoid UTC conversion issues
 */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * The app's canonical timezone. All synced external event dates/times are
 * normalised to this zone so they render correctly regardless of where the
 * server runs (e.g. UTC on Vercel).
 */
export const APP_TIMEZONE = 'Europe/Oslo'

// Reuse a single formatter instance (constructing Intl.DateTimeFormat is costly).
const osloDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/**
 * Format an absolute instant (Date or ISO timestamp) into the app timezone
 * (Europe/Oslo), returning a wall-clock date and time that always agree on the
 * same calendar day. Use this for external event timestamps instead of mixing
 * toISOString() (UTC) with toTimeString() (server-local), which shifts times by
 * the server's UTC offset and can disagree on the date near midnight.
 *
 * Returns null for invalid input.
 */
export function formatInstantInAppTimezone(
  input: Date | string | number
): { date: string; time: string } | null {
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return null

  const parts = osloDateTimeFormatter.formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const year = get('year')
  const month = get('month')
  const day = get('day')
  // en-CA renders 24h "00".."23"; guard against the "24:00" edge some engines emit.
  const hour = get('hour') === '24' ? '00' : get('hour')
  const minute = get('minute')
  const second = get('second')
  if (!year || !month || !day || !hour || !minute) return null

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}:${second || '00'}`,
  }
}

/**
 * Get the weekday index (0 = Monday, 6 = Sunday) - ISO week style
 * Converts JavaScript's getDay() (0=Sun, 6=Sat) to ISO format (0=Mon, 6=Sun)
 */
export function getWeekdayIndex(date: Date): number {
  const day = date.getDay()
  return day === 0 ? 6 : day - 1
}

/**
 * Get the localized weekday name for a date
 * Uses ISO week order (Mon-Sun) from translation strings
 */
export function getWeekdayName(date: Date, t: TranslationStrings): string {
  return t.date.weekdays[getWeekdayIndex(date)]
}

/**
 * Get the localized short weekday name for a date
 * Uses ISO week order (Mon-Sun) from translation strings
 */
export function getWeekdayNameShort(date: Date, t: TranslationStrings): string {
  return t.date.weekdaysShort[getWeekdayIndex(date)]
}

/**
 * Get the Monday of the week containing the given date
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Get all dates in a week starting from Monday
 */
export function getWeekDates(weekStart: Date): Date[] {
  const start = weekStart instanceof Date ? weekStart : new Date(weekStart)
  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    dates.push(d)
  }
  return dates
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return formatDateISO(date1) === formatDateISO(date2)
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Get week number (ISO week)
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/**
 * Get the Monday of a given ISO week number
 * @param week - ISO week number (1-53)
 * @param year - Year (defaults to current year, or infers from week proximity)
 * @returns Date object for Monday of that week
 */
export function getWeekStartFromWeekNumber(week: number, year?: number): Date {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentWeek = getWeekNumber(now)

  // If no year provided, infer based on proximity
  // If requesting week 52/53 and we're in week 1-3, likely means last year
  // If requesting week 1-3 and we're in week 50+, likely means next year
  if (!year) {
    if (week >= 50 && currentWeek <= 3) {
      year = currentYear - 1
    } else if (week <= 3 && currentWeek >= 50) {
      year = currentYear + 1
    } else {
      year = currentYear
    }
  }

  // Find January 4th of the year (always in week 1 per ISO)
  const jan4 = new Date(year, 0, 4)
  const jan4DayOfWeek = jan4.getDay() || 7  // Convert Sunday=0 to 7

  // Find the Monday of week 1
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - jan4DayOfWeek + 1)

  // Add (week - 1) * 7 days to get to the target week
  const targetMonday = new Date(week1Monday)
  targetMonday.setDate(week1Monday.getDate() + (week - 1) * 7)
  targetMonday.setHours(0, 0, 0, 0)

  return targetMonday
}

/**
 * Parse week parameter from URL
 * Supports formats: "2" (week number), "2025-02" (year-week)
 * @returns { weekStart: Date, year: number, week: number } or null if invalid
 */
export function parseWeekParam(param: string): { weekStart: Date; year: number; week: number } | null {
  if (!param) return null

  // Format: "2025-02" (year-week)
  if (param.includes('-')) {
    const [yearStr, weekStr] = param.split('-')
    const year = parseInt(yearStr, 10)
    const week = parseInt(weekStr, 10)
    if (isNaN(year) || isNaN(week) || week < 1 || week > 53) return null
    return { weekStart: getWeekStartFromWeekNumber(week, year), year, week }
  }

  // Format: "2" (just week number)
  const week = parseInt(param, 10)
  if (isNaN(week) || week < 1 || week > 53) return null
  const weekStart = getWeekStartFromWeekNumber(week)
  return { weekStart, year: weekStart.getFullYear(), week }
}

/**
 * Format week header in localized style: "Uke 51, 2024" (nb), "Week 51, 2024" (en)
 */
export function formatWeekHeaderLocalized(date: Date, lang: Language): string {
  const t = getTranslations(lang)
  return t.date.weekFormat
    .replace('{week}', String(getWeekNumber(date)))
    .replace('{year}', String(date.getFullYear()))
}

/**
 * CN helper for conditional classnames
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * Holiday/special day type for calendar events
 */
export interface Holiday {
  date: string
  name: string
  type?: 'holiday' | 'birthday'  // Default is 'holiday'
}

/**
 * Get an appropriate emoji for a holiday based on its name
 */
export function getHolidayEmoji(holiday: Holiday): string {
  if (holiday.type === 'birthday') return '🎂'

  const name = holiday.name.toLowerCase()

  // Christmas
  if (name.includes('jul') || name.includes('christmas')) return '🎄'

  // New Year
  if (name.includes('nyttår') || name.includes('new year') || name.includes('nyår')) return '🎆'

  // Easter
  if (name.includes('påske') || name.includes('easter') || name.includes('påsk') ||
      name.includes('langfredag') || name.includes('skjærtorsdag') ||
      name.includes('good friday') || name.includes('långfredag')) return '🐣'

  // Constitution Day / National Days
  if (name.includes('17. mai') || name.includes('17 mai') || name.includes('grunnlov') ||
      name.includes('nationaldag') || name.includes('national day') ||
      name.includes('6. juni') || name.includes('6 juni')) return '🎊'

  // May Day / Labor Day
  if (name.includes('1. mai') || name.includes('1 mai') || name.includes('arbeid') ||
      name.includes('may day') || name.includes('labor') || name.includes('första maj')) return '🌷'

  // Ascension / Pentecost
  if (name.includes('himmelfart') || name.includes('ascension') ||
      name.includes('pinse') || name.includes('pentecost') || name.includes('pingst')) return '✨'

  // Midsummer
  if (name.includes('sankthans') || name.includes('midsommar') || name.includes('midsummer') ||
      name.includes('jonsok')) return '🌻'

  // Default celebration emoji
  return '🎊'
}

/**
 * Check if a date is a holiday
 */
export function isHoliday(date: Date | string, holidays: Holiday[]): boolean {
  const dateStr = typeof date === 'string' ? date : formatDateISO(date)
  return holidays.some(h => h.date === dateStr)
}

/**
 * Get holiday for a date, or null if not a holiday
 */
export function getHoliday(date: Date | string, holidays: Holiday[]): Holiday | null {
  const dateStr = typeof date === 'string' ? date : formatDateISO(date)
  return holidays.find(h => h.date === dateStr) || null
}

/**
 * Check if a date is a non-working day (weekend or holiday)
 */
export function isNonWorkingDay(date: Date | string, holidays: Holiday[]): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  return isWeekend(d) || isHoliday(date, holidays)
}

/**
 * Normalize a URL path by removing query strings and trailing slashes.
 * Used for consistent path comparison (e.g., "/uke/" and "/uke" are the same).
 * Preserves root "/" as-is.
 *
 * @example
 * normalizePath('/uke/') // => '/uke'
 * normalizePath('/uke?demo=true') // => '/uke'
 * normalizePath('/') // => '/'
 */
export function normalizePath(path: string): string {
  const withoutQuery = path.split('?')[0]
  // Remove trailing slash but keep root "/" as is
  return withoutQuery.length > 1 && withoutQuery.endsWith('/')
    ? withoutQuery.slice(0, -1)
    : withoutQuery
}

/**
 * Generate a unique temporary ID for offline items.
 * Uses timestamp + random suffix to avoid collisions when multiple items
 * are created in the same millisecond.
 *
 * @example
 * generateTempId() // => 'temp-1702500000000-x7k2m9'
 */
export function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
