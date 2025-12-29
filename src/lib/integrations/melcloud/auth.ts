/**
 * MELCloud Authentication Helpers
 *
 * Handles token caching and authentication for MELCloud API calls.
 */

import { createClient } from '@/lib/supabase/server'
import { MelCloudClient } from './client'
import { MelCloudAuthError } from './types'

/**
 * In-flight authentication promises to prevent race conditions.
 * When multiple concurrent requests need auth for the same account,
 * they will share the same Promise instead of triggering parallel logins.
 */
const authInFlight = new Map<string, Promise<MelCloudClient>>()

interface CachedTokens {
  contextKey: string
  expiry: string
  isExpired: boolean
}

/**
 * Get an authenticated MELCloud client for an account.
 *
 * This function handles token caching:
 * 1. First tries to use cached tokens from the database
 * 2. If tokens are expired, does a full re-login
 * 3. Saves new tokens to the database after successful auth
 *
 * Uses mutex pattern to prevent race conditions when multiple
 * concurrent requests need authentication for the same account.
 *
 * @param accountId - The home_control_accounts ID
 * @returns An authenticated MelCloudClient
 */
export async function getAuthenticatedClient(accountId: string): Promise<MelCloudClient> {
  // Check for in-flight auth operation for this account
  const existingAuth = authInFlight.get(accountId)
  if (existingAuth) {
    return existingAuth
  }

  // Create new auth promise and store it
  const authPromise = performAuthentication(accountId)
  authInFlight.set(accountId, authPromise)

  try {
    return await authPromise
  } finally {
    // Clean up after completion (success or failure)
    authInFlight.delete(accountId)
  }
}

/**
 * Internal function that performs the actual authentication.
 */
async function performAuthentication(accountId: string): Promise<MelCloudClient> {
  const supabase = await createClient()

  // Get account details
  const { data: account, error: accountError } = await supabase
    .from('home_control_accounts')
    .select('id, service')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    throw new MelCloudAuthError('Account not found')
  }

  if (account.service !== 'melcloud') {
    throw new MelCloudAuthError('Not a MELCloud account')
  }

  const client = new MelCloudClient({
    debug: process.env.NODE_ENV === 'development',
  })

  // Try to use cached tokens
  const { data: cachedTokens } = await supabase.rpc('get_melcloud_tokens', {
    p_account_id: accountId,
  })

  if (cachedTokens && !cachedTokens.isExpired && cachedTokens.contextKey) {
    // Use cached context key
    client.loginWithToken(
      cachedTokens.contextKey,
      new Date(cachedTokens.expiry).getTime()
    )
    return client
  }

  // Fall back to full login with credentials
  const { data: credentials, error: credError } = await supabase.rpc(
    'get_home_control_credentials',
    { p_account_id: accountId }
  )

  if (credError || !credentials) {
    throw new MelCloudAuthError('Could not retrieve credentials')
  }

  const { email, password } = credentials as { email: string; password: string }
  await client.login(email, password)

  // Save tokens for future use
  const tokens = client.getTokens()
  await supabase.rpc('update_melcloud_tokens', {
    p_account_id: accountId,
    p_context_key: tokens.contextKey,
    p_expires_in: client.getTokenExpiresIn(),
  })

  return client
}

/**
 * Clear cached tokens for an account (e.g., after auth failure).
 */
export async function clearCachedTokens(accountId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc('clear_melcloud_tokens', { p_account_id: accountId })
}
