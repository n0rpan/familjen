/**
 * Toshiba Authentication Helpers
 *
 * Handles token caching and authentication for Toshiba API calls.
 */

import { createClient } from '@/lib/supabase/server'
import { ToshibaClient } from './client'
import { ToshibaAuthError } from './types'

/**
 * In-flight authentication promises to prevent race conditions.
 * When multiple concurrent requests need auth for the same account,
 * they will share the same Promise instead of triggering parallel logins.
 */
const authInFlight = new Map<string, Promise<ToshibaClient>>()

interface CachedTokens {
  accessToken: string
  consumerId: string
  sasToken?: string
  deviceId?: string
  expiry: string
  isExpired: boolean
}

/**
 * Get an authenticated Toshiba client for an account.
 *
 * This function handles token caching:
 * 1. First tries to use cached tokens from the database
 * 2. If tokens are expired, does a full re-login (Toshiba doesn't support refresh tokens)
 * 3. Saves new tokens to the database after successful auth
 *
 * Uses mutex pattern to prevent race conditions when multiple
 * concurrent requests need authentication for the same account.
 *
 * @param accountId - The home_control_accounts ID
 * @returns An authenticated ToshibaClient
 */
export async function getAuthenticatedClient(accountId: string): Promise<ToshibaClient> {
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
async function performAuthentication(accountId: string): Promise<ToshibaClient> {
  const supabase = await createClient()

  // Get account details
  const { data: account, error: accountError } = await supabase
    .from('home_control_accounts')
    .select('id, service')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    throw new ToshibaAuthError('Account not found')
  }

  if (account.service !== 'toshiba') {
    throw new ToshibaAuthError('Not a Toshiba account')
  }

  const client = new ToshibaClient({
    debug: process.env.NODE_ENV === 'development',
  })

  // Try to use cached tokens
  const { data: cachedTokens } = await supabase.rpc('get_toshiba_tokens', {
    p_account_id: accountId,
  })

  if (cachedTokens && !cachedTokens.isExpired && cachedTokens.sasToken) {
    // Use cached access token (only if SAS token is available for AMQP)
    client.loginWithToken(
      cachedTokens.accessToken,
      cachedTokens.consumerId,
      cachedTokens.sasToken,
      cachedTokens.deviceId,
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
    throw new ToshibaAuthError('Could not retrieve credentials')
  }

  const { username, password } = credentials as { username: string; password: string }
  await client.login(username, password)

  // Brief delay after fresh login to allow Toshiba cloud to sync device states
  // Some devices don't have ACStateData immediately available after login
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Save tokens for future use
  const tokens = client.getTokens()
  await supabase.rpc('update_toshiba_tokens', {
    p_account_id: accountId,
    p_access_token: tokens.accessToken,
    p_consumer_id: tokens.consumerId,
    p_sas_token: tokens.sasToken,
    p_device_id: tokens.deviceId,
    p_expires_in: client.getTokenExpiresIn(),
  })

  return client
}

/**
 * Clear cached tokens for an account (e.g., after auth failure).
 */
export async function clearCachedTokens(accountId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc('clear_toshiba_tokens', { p_account_id: accountId })
}
