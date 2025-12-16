import { createClient } from '@supabase/supabase-js'

/**
 * Service role client for admin operations (bypasses RLS)
 * Only use server-side for:
 * - Updating user metadata (app_metadata.is_admin)
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
 * Update user's app_metadata.is_admin based on allowed_emails table
 */
export async function syncUserAdminStatus(userId: string, email: string): Promise<boolean> {
  const adminClient = createAdminClient()

  // Check if user is admin in allowed_emails
  const { data: allowedEmail } = await adminClient
    .from('allowed_emails')
    .select('is_admin')
    .eq('email', email.toLowerCase())
    .single()

  const isAdmin = allowedEmail?.is_admin === true

  // Update user's app_metadata
  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    app_metadata: { is_admin: isAdmin },
  })

  if (error) {
    console.error('Failed to update user admin status:', error)
    return false
  }

  return isAdmin
}
