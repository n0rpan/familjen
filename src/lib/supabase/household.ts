import type { SupabaseClient } from '@supabase/supabase-js'
import type { Household } from '@/lib/types'

// PostgREST error codes
const PGRST_NO_ROWS = 'PGRST116'      // "The result contains 0 rows"
const PGRST_MULTIPLE_ROWS = 'PGRST103' // "The result contains more than 1 row" (deprecated)
const PGRST_MULTIPLE_ROWS_NEW = 'PGRST116' // In newer versions, multiple rows also returns 116

/**
 * Fetches the current user's household with proper error handling.
 *
 * This handles the edge case where a user might somehow end up in multiple households
 * (data anomaly, admin operations, etc.) by:
 * 1. Querying for all visible households
 * 2. Returning the first one if exactly one exists
 * 3. Logging an error if multiple exist (data integrity issue)
 * 4. Returning null if none exist
 *
 * @param supabase - Supabase client instance
 * @returns The household data, or null if not found
 */
export async function getUserHousehold(
  supabase: SupabaseClient
): Promise<{ data: Household | null; error: string | null; multipleHouseholds: boolean }> {
  const { data, error } = await supabase
    .from('households')
    .select('*')

  if (error) {
    console.error('Error fetching households:', error)
    return { data: null, error: error.message, multipleHouseholds: false }
  }

  if (!data || data.length === 0) {
    return { data: null, error: null, multipleHouseholds: false }
  }

  if (data.length > 1) {
    // This indicates a data integrity issue - user is in multiple households
    // Log it for debugging but return the first one to keep the app functional
    console.error(
      `Data integrity warning: User belongs to ${data.length} households. ` +
      `IDs: ${data.map(h => h.id).join(', ')}. Using first one.`
    )
    return { data: data[0] as Household, error: null, multipleHouseholds: true }
  }

  return { data: data[0] as Household, error: null, multipleHouseholds: false }
}

/**
 * Safely handles PostgREST errors from .single() queries.
 * Useful for migrations from direct .single() calls.
 *
 * @param error - The error from Supabase query
 * @returns Object with categorized error info
 */
export function categorizeSupabaseError(error: { code?: string; message?: string } | null) {
  if (!error) return { isNoRows: false, isMultipleRows: false, isOther: false }

  const code = error.code || ''

  return {
    isNoRows: code === PGRST_NO_ROWS,
    // Multiple rows can come back as different codes depending on Supabase version
    isMultipleRows: code === PGRST_MULTIPLE_ROWS ||
      (code === PGRST_MULTIPLE_ROWS_NEW && error.message?.includes('more than')),
    isOther: code !== PGRST_NO_ROWS && code !== PGRST_MULTIPLE_ROWS,
  }
}
