import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedClient, clearCachedTokens, ToshibaAuthError } from '@/lib/integrations/toshiba'

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
    const devices = await client.getMappedDevices()

    // DEBUG: Extract raw hex state for debugging temperature byte positions
    const debugInfo = devices.map(device => {
      const rawData = device.rawData as { ACStateData?: string } | undefined
      const hexState = rawData?.ACStateData || ''
      const bytes: string[] = []
      for (let i = 0; i < Math.min(25, hexState.length / 2); i++) {
        const byte = hexState.slice(i * 2, i * 2 + 2).toLowerCase()
        const val = parseInt(byte, 16)
        const tempVal = val - 128
        bytes.push(`[${i}]=${byte}(${val}${val >= 15 && val <= 35 ? '°?' : ''}${tempVal >= -20 && tempVal <= 45 ? ` out:${tempVal}°?` : ''})`)
      }
      return {
        name: device.name,
        hexState,
        hexLength: hexState.length,
        bytes: bytes.join(' '),
        extracted: {
          currentTemperature: device.currentTemperature,
          outdoorTemperature: device.outdoorTemperature,
          targetTemperature: device.targetTemperature,
        }
      }
    })

    // Sync devices to database (preserves user customizations: custom_name, favorite, sort_order, is_hidden)
    const { data: existingDevices } = await supabase
      .from('toshiba_ac_devices')
      .select('id, ac_id')
      .eq('account_id', accountId)

    const existingByAcId = new Map(
      (existingDevices || []).map(d => [d.ac_id, d.id])
    )

    const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = []
    const toInsert: Array<Record<string, unknown>> = []
    const now = new Date().toISOString()

    for (const device of devices) {
      const existingId = existingByAcId.get(device.acId)
      const deviceData = {
        name: device.name,
        model: device.model,
        firmware_version: device.firmwareVersion,
        timezone: device.timezone,
        power_state: device.powerState,
        operation_mode: device.operationMode,
        target_temperature: device.targetTemperature,
        current_temperature: device.currentTemperature,
        outdoor_temperature: device.outdoorTemperature,
        fan_speed: device.fanSpeed,
        swing_mode: device.swingMode,
        pure_state: device.pureState,
        has_energy_consumption: device.hasEnergyConsumption,
        has_auto_clean: device.hasAutoClean,
        merit_feature: device.meritFeature,
        raw_data: device.rawData,
        last_state_update: now,
        updated_at: now,
      }

      if (existingId) {
        toUpdate.push({ id: existingId, data: deviceData })
      } else {
        toInsert.push({
          account_id: accountId,
          ac_id: device.acId,
          ...deviceData,
        })
      }
    }

    // Batch update existing devices
    if (toUpdate.length > 0) {
      const updateResults = await Promise.all(
        toUpdate.map(({ id, data }) =>
          supabase.from('toshiba_ac_devices').update(data).eq('id', id)
        )
      )
      const updateErrors = updateResults.filter(r => r.error)
      if (updateErrors.length > 0) {
        console.error('Failed to update some devices:', updateErrors.map(r => r.error))
      }
    }

    // Batch insert new devices
    if (toInsert.length > 0) {
      console.log('Inserting devices:', JSON.stringify(toInsert, null, 2))
      const { data: insertedData, error: insertError } = await supabase
        .from('toshiba_ac_devices')
        .insert(toInsert)
        .select()

      if (insertError) {
        console.error('Failed to insert devices:', insertError)
        throw new Error(`Failed to insert devices: ${insertError.message}`)
      }
      console.log('Inserted devices:', insertedData)
    }

    // Update sync status
    await supabase.rpc('update_home_control_sync_status', {
      p_account_id: accountId,
      p_status: 'ok',
    })

    // Get devices from database (with user customizations)
    const { data: dbDevices } = await supabase
      .from('toshiba_ac_devices')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_hidden', false)
      .order('sort_order')
      .order('name')

    return NextResponse.json({
      success: true,
      devices: dbDevices || [],
      // DEBUG: Remove after fixing temperature parsing
      _debug: debugInfo,
    })
  } catch (error) {
    console.error('Toshiba devices error:', error)

    if (error instanceof ToshibaAuthError) {
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

// Refresh devices from Toshiba
export async function POST(request: NextRequest) {
  return GET(request)
}
