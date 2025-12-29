/**
 * iSkole Integration
 *
 * Provides access to the iSkole school administration system.
 * Used by Norwegian schools for timetables, grades, absences, and communication.
 */

export { ISkoleClient } from './client'
export {
  ISkoleError,
  ISkoleAuthError,
  ISkoleSessionExpiredError,
  ISKOLE_DAY_TYPES,
  type ISkoleSession,
  type ISkoleChild,
  type ISkoleMessage,
  type ISkoleTimeplanEntry,
  type ISkoleAbsence,
  type ISkoleSchoolCalendarDay,
  type MappedISkoleMessage,
  type MappedISkoleEvent,
} from './types'
