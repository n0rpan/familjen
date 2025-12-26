/**
 * Credential decryption helper for external integrations.
 * Centralizes the pattern of decrypting and parsing integration credentials.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Credential types for different services
 */
export interface SpondCredentials {
  email: string
  password: string
}

export interface KidplanCredentials {
  email: string
  password: string
  kindergartenId?: number
}

export interface ISkoleCredentials {
  username: string
  password: string
}

export interface MyKidCredentials {
  phone: string
  password: string
}

export type IntegrationCredentials =
  | SpondCredentials
  | KidplanCredentials
  | ISkoleCredentials
  | MyKidCredentials

/**
 * Result of credential decryption
 */
export type DecryptResult<T> =
  | { success: true; credentials: T }
  | { success: false; error: string }

/**
 * Decrypt and parse integration credentials.
 *
 * @param supabase - Supabase client (usually service role)
 * @param encryptedCredentials - The encrypted credentials string from DB
 * @returns Decrypted and parsed credentials or an error
 *
 * @example
 * ```typescript
 * const result = await decryptCredentials<SpondCredentials>(supabase, integration.credentials_encrypted)
 * if (!result.success) {
 *   return ApiErrors.internalError()
 * }
 * const { email, password } = result.credentials
 * ```
 */
export async function decryptCredentials<T extends IntegrationCredentials>(
  supabase: SupabaseClient<any, any, any>,
  encryptedCredentials: string
): Promise<DecryptResult<T>> {
  try {
    const { data, error } = await supabase.rpc('decrypt_token', {
      ciphertext: encryptedCredentials,
    })

    if (error) {
      console.error('[Credentials] Decryption RPC error:', error.message)
      return { success: false, error: 'Failed to decrypt credentials' }
    }

    if (!data) {
      return { success: false, error: 'No credentials returned' }
    }

    try {
      const credentials = JSON.parse(data) as T
      return { success: true, credentials }
    } catch (parseError) {
      console.error('[Credentials] JSON parse error:', parseError)
      return { success: false, error: 'Invalid credentials format' }
    }
  } catch (error) {
    console.error('[Credentials] Unexpected error:', error)
    return { success: false, error: 'Credential decryption failed' }
  }
}

/**
 * Validate that Spond credentials have required fields
 */
export function isSpondCredentials(creds: unknown): creds is SpondCredentials {
  return (
    typeof creds === 'object' &&
    creds !== null &&
    'email' in creds &&
    'password' in creds &&
    typeof (creds as SpondCredentials).email === 'string' &&
    typeof (creds as SpondCredentials).password === 'string'
  )
}

/**
 * Validate that Kidplan credentials have required fields
 */
export function isKidplanCredentials(creds: unknown): creds is KidplanCredentials {
  return (
    typeof creds === 'object' &&
    creds !== null &&
    'email' in creds &&
    'password' in creds &&
    typeof (creds as KidplanCredentials).email === 'string' &&
    typeof (creds as KidplanCredentials).password === 'string'
  )
}

/**
 * Validate that iSkole credentials have required fields
 */
export function isISkoleCredentials(creds: unknown): creds is ISkoleCredentials {
  return (
    typeof creds === 'object' &&
    creds !== null &&
    'username' in creds &&
    'password' in creds &&
    typeof (creds as ISkoleCredentials).username === 'string' &&
    typeof (creds as ISkoleCredentials).password === 'string'
  )
}

/**
 * Validate that MyKid credentials have required fields
 */
export function isMyKidCredentials(creds: unknown): creds is MyKidCredentials {
  return (
    typeof creds === 'object' &&
    creds !== null &&
    'phone' in creds &&
    'password' in creds &&
    typeof (creds as MyKidCredentials).phone === 'string' &&
    typeof (creds as MyKidCredentials).password === 'string'
  )
}
