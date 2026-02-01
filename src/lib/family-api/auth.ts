/**
 * API Key Authentication
 *
 * Validates API keys from the Authorization header and returns
 * the associated household_id and scopes.
 */

import { createClient } from '@supabase/supabase-js'
import type { ApiKeyScope } from '@/lib/types'

// Create a service role client for API key validation
// This bypasses RLS since we need to validate before knowing the household
function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration for API key validation')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

export interface ApiKeyValidation {
  valid: true
  householdId: string
  keyId: string           // For per-key rate limiting
  scopes: ApiKeyScope[]
}

export interface ApiKeyInvalid {
  valid: false
  error: string
}

export type ApiKeyResult = ApiKeyValidation | ApiKeyInvalid

/**
 * Extract API key from Authorization header
 */
function extractApiKey(request: Request): string | null {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null

  // Support both "Bearer fam_xxx" and just "fam_xxx"
  const parts = authHeader.split(' ')
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1]
  }
  if (parts.length === 1 && parts[0].startsWith('fam_')) {
    return parts[0]
  }

  return null
}

/**
 * Validate an API key and return the associated household
 *
 * @param request - The incoming request with Authorization header
 * @returns Validation result with household_id and scopes if valid
 */
export async function validateApiKey(request: Request): Promise<ApiKeyResult> {
  const apiKey = extractApiKey(request)

  if (!apiKey) {
    return {
      valid: false,
      error: 'Missing API key. Use Authorization: Bearer fam_xxx',
    }
  }

  if (!apiKey.startsWith('fam_')) {
    return {
      valid: false,
      error: 'Invalid API key format. Keys must start with "fam_"',
    }
  }

  try {
    const supabase = getServiceClient()

    // Call the database function to validate and update last_used_at
    const { data, error } = await supabase.rpc('validate_api_key', {
      p_key: apiKey,
    })

    if (error) {
      console.error('API key validation error:', error)
      return {
        valid: false,
        error: 'Failed to validate API key',
      }
    }

    // The function returns an array with one row if valid, empty if invalid
    if (!data || data.length === 0) {
      return {
        valid: false,
        error: 'Invalid or revoked API key',
      }
    }

    const result = data[0]
    return {
      valid: true,
      householdId: result.household_id,
      keyId: result.key_id,
      scopes: result.scopes as ApiKeyScope[],
    }
  } catch (err) {
    console.error('API key validation exception:', err)
    return {
      valid: false,
      error: 'Internal error validating API key',
    }
  }
}

/**
 * Check if the validated API key has a specific scope
 *
 * SECURITY: Empty scopes array means NO access (fail-closed).
 * API keys must explicitly specify their allowed scopes.
 *
 * @param validation - The validation result from validateApiKey
 * @param scope - The scope to check for
 * @returns true if the key has the scope
 */
export function hasScope(
  validation: ApiKeyValidation,
  scope: ApiKeyScope
): boolean {
  // SECURITY: Empty scopes = no access (fail-closed, not fail-open)
  if (!validation.scopes || validation.scopes.length === 0) {
    return false
  }

  return validation.scopes.includes(scope)
}

/**
 * Require a specific scope, throwing if not present
 *
 * @param validation - The validation result from validateApiKey
 * @param scope - The required scope
 * @throws Error if scope is missing
 */
export function requireScope(
  validation: ApiKeyValidation,
  scope: ApiKeyScope
): void {
  if (!hasScope(validation, scope)) {
    throw new Error(`Missing required scope: ${scope}`)
  }
}
