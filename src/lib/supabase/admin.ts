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
 * In-flight sync operations to prevent redundant DB calls
 * Key: userId, Value: Promise of the sync operation
 *
 * When multiple pages load rapidly before JWT is synced, they all call
 * syncUserMetadata. This Map deduplicates so only one DB call happens.
 * The promise is removed after completion (success or failure).
 */
const inFlightSyncs = new Map<string, Promise<{ isAdmin: boolean; householdId: string | null }>>()

/**
 * Sync user metadata to JWT app_metadata for fast access without DB lookups
 * Stores: is_admin, household_id
 *
 * DEDUPLICATION: If a sync is already in-flight for this user, returns the
 * existing promise instead of starting a new one. This prevents redundant
 * DB calls when multiple pages load rapidly.
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
  // Check if there's already an in-flight sync for this user
  const existingSync = inFlightSyncs.get(userId)
  if (existingSync) {
    return existingSync
  }

  // Create the sync operation and track it
  const syncOperation = (async () => {
    try {
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
    } finally {
      // Always remove from tracking when done (success or failure)
      inFlightSyncs.delete(userId)
    }
  })()

  // Track the in-flight sync
  inFlightSyncs.set(userId, syncOperation)

  return syncOperation
}

