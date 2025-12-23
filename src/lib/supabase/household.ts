import type { SupabaseClient } from '@supabase/supabase-js'
import type { Household } from '@/lib/types'

// PostgREST error codes
const PGRST_NO_ROWS = 'PGRST116'      // "The result contains 0 rows"
const PGRST_MULTIPLE_ROWS = 'PGRST103' // "The result contains more than 1 row" (deprecated)
const PGRST_MULTIPLE_ROWS_NEW = 'PGRST116' // In newer versions, multiple rows also returns 116

/**
 * Fetches the current user's household with proper error handling.
 *
 * This queries through household_members to get the user's specific household,
 * avoiding issues where admins can see all households via RLS.
 *
 * @param supabase - Supabase client instance
 * @returns The household data, or null if not found
 */
export async function getUserHousehold(
  supabase: SupabaseClient
): Promise<{ data: Household | null; error: string | null; multipleHouseholds: boolean }> {
  // First get the user's household_id via their membership
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { data: null, error: 'Not authenticated', multipleHouseholds: false }
  }

  const { data: membership, error: memberError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (memberError) {
    console.error('Error fetching membership:', memberError)
    return { data: null, error: memberError.message, multipleHouseholds: false }
  }

  if (!membership) {
    return { data: null, error: null, multipleHouseholds: false }
  }

  // Now fetch the specific household by ID
  const { data: household, error: householdError } = await supabase
    .from('households')
    .select('*')
    .eq('id', membership.household_id)
    .single()

  if (householdError) {
    console.error('Error fetching household:', householdError)
    return { data: null, error: householdError.message, multipleHouseholds: false }
  }

  return { data: household as Household, error: null, multipleHouseholds: false }
}

