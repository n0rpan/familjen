import { createClient } from '@supabase/supabase-js'

/**
 * Service role client for admin operations (bypasses RLS)
 * Only use server-side for:
 * - Updating user metadata (app_metadata.is_admin, household_id)
 * - Admin-level database operations
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for admin operations')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Sync user metadata to JWT app_metadata for fast access without DB lookups
 * Stores: is_admin, household_id
 *
 * Call this:
 * - On login (auth callback)
 * - When user joins/leaves a household
 */
export async function syncUserMetadata(
  userId: string,
  email: string,
  householdId: string | null
): Promise<{ isAdmin: boolean; householdId: string | null }> {
  const adminClient = createAdminClient()

  // Check if user is admin in allowed_emails
  const { data: allowedEmail } = await adminClient
    .from('allowed_emails')
    .select('is_admin')
    .eq('email', email.toLowerCase())
    .single()

  const isAdmin = allowedEmail?.is_admin === true

  // Update user's app_metadata with both admin status and household_id
  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    app_metadata: {
      is_admin: isAdmin,
      household_id: householdId,
    },
  })

  if (error) {
    console.error('Failed to update user metadata:', error)
    throw error
  }

  return { isAdmin, householdId }
}

