import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedClient, clearCachedTokens, SomfyAuthError } from '@/lib/integrations/somfy'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const accountId = request.nextUrl.searchParams.get('accountId')
    if (!accountId) {
      return NextResponse.json(
        { success: false, error: 'Account ID is required' },
        { status: 400 }
      )
    }

    // Get authenticated client (uses cached tokens when available)
    const client = await getAuthenticatedClient(accountId)
    const devices = await client.getSupportedDevices()

    // Sync devices to database
    for (const device of devices) {
      await supabase
        .from('home_control_devices')
        .upsert({
          account_id: accountId,
          device_url: device.deviceUrl,
          label: device.label,
          ui_class: device.uiClass,
          controllable_name: device.controllableName,
          available: device.available,
          position: device.position,
          commands: device.commands,
          raw_data: device.rawData,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'account_id,device_url',
        })
    }

    // Update sync status
    await supabase.rpc('update_home_control_sync_status', {
      p_account_id: accountId,
      p_status: 'ok',
    })

    // Get devices from database (with user customizations)
    const { data: dbDevices } = await supabase
      .from('home_control_devices')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_hidden', false)
      .order('sort_order')
      .order('label')

    return NextResponse.json({
      success: true,
      devices: dbDevices || [],
    })
  } catch (error) {
    console.error('Somfy devices error:', error)

    if (error instanceof SomfyAuthError) {
      // Update sync status to auth_failed and clear cached tokens
      const supabase = await createClient()
      const accountId = new URL(request.url).searchParams.get('accountId')
      if (accountId) {
        await Promise.all([
          supabase.rpc('update_home_control_sync_status', {
            p_account_id: accountId,
            p_status: 'auth_failed',
            p_error: 'Authentication failed',
          }),
          clearCachedTokens(accountId),
        ])
      }

      return NextResponse.json(
        { success: false, error: 'Authentication failed' },
        { status: 401 }
      )
    }

    const message = error instanceof Error ? error.message : 'Failed to fetch devices'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// Refresh devices from Somfy
export async function POST(request: NextRequest) {
  return GET(request)
}
