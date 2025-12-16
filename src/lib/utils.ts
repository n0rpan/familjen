// Norwegian weekday names
export const WEEKDAYS_NO = [
  'Mandag',
  'Tirsdag',
  'Onsdag',
  'Torsdag',
  'Fredag',
  'Lørdag',
  'Søndag',
] as const

export const WEEKDAYS_SHORT_NO = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'] as const

// Norwegian month names
export const MONTHS_NO = [
  'januar',
  'februar',
  'mars',
  'april',
  'mai',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'desember',
] as const

/**
 * Format a date in Norwegian style: "mandag 16. desember"
 */
export function formatDateNorwegian(date: Date): string {
  const dayOfWeek = WEEKDAYS_NO[getWeekdayIndex(date)]
  const dayOfMonth = date.getDate()
  const month = MONTHS_NO[date.getMonth()]
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
 * Get the weekday index (0 = Monday, 6 = Sunday) - ISO week style
 */
export function getWeekdayIndex(date: Date): number {
  const day = date.getDay()
  return day === 0 ? 6 : day - 1
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
 * Format week header: "Uke 51, 2024"
 */
export function formatWeekHeader(date: Date): string {
  return `Uke ${getWeekNumber(date)}, ${date.getFullYear()}`
}

/**
 * CN helper for conditional classnames
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}
