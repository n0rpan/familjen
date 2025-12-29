/**
 * Somfy Authentication Helpers
 *
 * Handles token caching and authentication for Somfy API calls.
 */

import { createClient } from '@/lib/supabase/server'
import { SomfyClient, SomfyAuthError } from './index'
import type { OverkizServer } from './types'

/**
 * In-flight authentication promises to prevent race conditions.
 * When multiple concurrent requests need auth for the same account,
 * they will share the same Promise instead of triggering parallel refreshes.
 */
const authInFlight = new Map<string, Promise<SomfyClient>>()

interface CachedTokens {
  accessToken: string
  refreshToken: string | null
  expiry: string
  isExpired: boolean
}

/**
 * Get an authenticated Somfy client for an account.
 *
 * This function handles token caching:
 * 1. First tries to use cached tokens from the database
 * 2. If tokens are expired, tries to refresh them
 * 3. If refresh fails or no cached tokens, does a full login
 * 4. Saves new tokens to the database after successful auth
 *
 * Uses mutex pattern to prevent race conditions when multiple
 * concurrent requests need authentication for the same account.
 *
 * @param accountId - The home_control_accounts ID
 * @returns An authenticated SomfyClient
 */
export async function getAuthenticatedClient(accountId: string): Promise<SomfyClient> {
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
async function performAuthentication(accountId: string): Promise<SomfyClient> {
  const supabase = await createClient()

  // Get account details
  const { data: account, error: accountError } = await supabase
    .from('home_control_accounts')
    .select('id, server')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    throw new SomfyAuthError('Account not found')
  }

  const server = (account.server || 'somfy_europe') as OverkizServer
  const client = new SomfyClient({
    server,
    debug: process.env.NODE_ENV === 'development',
  })

  // Try to use cached tokens
  const { data: cachedTokens } = await supabase.rpc('get_home_control_tokens', {
    p_account_id: accountId,
  })

  if (cachedTokens && !cachedTokens.isExpired) {
    // Use cached access token
    client.loginWithToken(
      cachedTokens.accessToken,
      cachedTokens.refreshToken,
      new Date(cachedTokens.expiry).getTime()
    )
    return client
  }

  // Try to refresh if we have a refresh token
  if (cachedTokens?.refreshToken) {
    try {
      client.loginWithToken(
        cachedTokens.accessToken,
        cachedTokens.refreshToken,
        0 // Force refresh
      )
      await client.refreshAccessToken()

      // Save new tokens
      const tokens = client.getTokens()
      await supabase.rpc('update_home_control_tokens', {
        p_account_id: accountId,
        p_access_token: tokens.accessToken,
        p_refresh_token: tokens.refreshToken,
        p_expires_in: client.getTokenExpiresIn(),
      })

      return client
    } catch (refreshError) {
      console.log('[SomfyAuth] Token refresh failed, falling back to full login')
      // Clear invalid tokens
      await supabase.rpc('clear_home_control_tokens', { p_account_id: accountId })
    }
  }

  // Fall back to full login with credentials
  const { data: credentials, error: credError } = await supabase.rpc(
    'get_home_control_credentials',
    { p_account_id: accountId }
  )

  if (credError || !credentials) {
    throw new SomfyAuthError('Could not retrieve credentials')
  }

  const { email, password } = credentials as { email: string; password: string }
  await client.login(email, password)

  // Save tokens for future use
  const tokens = client.getTokens()
  await supabase.rpc('update_home_control_tokens', {
    p_account_id: accountId,
    p_access_token: tokens.accessToken,
    p_refresh_token: tokens.refreshToken,
    p_expires_in: client.getTokenExpiresIn(),
  })

  return client
}

/**
 * Clear cached tokens for an account (e.g., after auth failure).
 */
export async function clearCachedTokens(accountId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc('clear_home_control_tokens', { p_account_id: accountId })
}
