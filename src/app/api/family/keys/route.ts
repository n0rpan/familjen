/**
 * Family API: API Key Management
 *
 * GET    /api/family/keys - List API keys (authenticated users)
 * POST   /api/family/keys - Create new API key (household admins)
 * DELETE /api/family/keys - Revoke an API key (household admins)
 *
 * Authentication: Session-based (not API key)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateApiScopes, validateUUID } from '@/lib/family-api'
import type { HouseholdApiKey, ApiKeyScope } from '@/lib/types'

/**
 * GET /api/family/keys
 *
 * Returns: Array of API keys (without the actual key, only prefix)
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Get user's household
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json(
        { error: 'No household found' },
        { status: 404 }
      )
    }

    // Fetch API keys for the household
    const { data: keys, error } = await supabase
      .from('household_api_keys')
      .select('id, key_prefix, name, scopes, created_at, last_used_at, revoked_at')
      .eq('household_id', membership.household_id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch API keys:', error)
      return NextResponse.json(
        { error: 'Failed to fetch API keys' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data: keys })
  } catch (error) {
    console.error('API keys GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/family/keys
 *
 * Body:
 * - name: User-friendly name for the key (required, max 100 chars)
 * - scopes: Array of scopes (required, at least one scope)
 *
 * Returns: Created API key (key shown only once!)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Parse body
    let body: { name?: string; scopes?: ApiKeyScope[] }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    if (!body.name || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      )
    }

    // Validate scopes - at least one required, all must be valid
    const scopesError = validateApiScopes(body.scopes || [])
    if (scopesError) {
      return NextResponse.json(
        { error: scopesError },
        { status: 400 }
      )
    }

    // Create API key via RPC (handles admin check internally)
    const { data, error } = await supabase.rpc('create_api_key', {
      p_name: body.name.trim(),
      p_scopes: body.scopes || [],
    })

    if (error) {
      console.error('Failed to create API key:', error)
      if (error.message.includes('household admin')) {
        return NextResponse.json(
          { error: 'Only household admins can create API keys' },
          { status: 403 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to create API key' },
        { status: 500 }
      )
    }

    // Return the key (this is the only time it's shown!)
    return NextResponse.json({
      data: {
        id: data.id,
        key: data.key,  // Full key - show once!
        prefix: data.prefix,
        name: data.name,
        scopes: data.scopes,
      },
      warning: 'Save this key now - it will not be shown again!',
    })
  } catch (error) {
    console.error('API keys POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/family/keys
 *
 * Query params:
 * - id: UUID of the API key to revoke
 *
 * Returns: Success status
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Get key ID from query
    const { searchParams } = new URL(request.url)
    const keyId = searchParams.get('id')

    const uuidError = validateUUID(keyId, 'id')
    if (uuidError) {
      return NextResponse.json(
        { error: uuidError },
        { status: 400 }
      )
    }

    // Revoke API key via RPC (handles admin check internally)
    const { data, error } = await supabase.rpc('revoke_api_key', {
      p_key_id: keyId,
    })

    if (error) {
      console.error('Failed to revoke API key:', error)
      if (error.message.includes('household admin')) {
        return NextResponse.json(
          { error: 'Only household admins can revoke API keys' },
          { status: 403 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to revoke API key' },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json(
        { error: 'API key not found or already revoked' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: { revoked: true } })
  } catch (error) {
    console.error('API keys DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
