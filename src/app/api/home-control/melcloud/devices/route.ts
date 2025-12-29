import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedClient, clearCachedTokens, MelCloudAuthError } from '@/lib/integrations/melcloud'

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

    // Sync devices to database (preserves user customizations: custom_name, favorite, sort_order, is_hidden)
    const { data: existingDevices } = await supabase
      .from('melcloud_devices')
      .select('id, device_id')
      .eq('account_id', accountId)

    const existingByDeviceId = new Map(
      (existingDevices || []).map(d => [d.device_id, d.id])
    )

    const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = []
    const toInsert: Array<Record<string, unknown>> = []
    const now = new Date().toISOString()

    for (const device of devices) {
      const existingId = existingByDeviceId.get(device.deviceId)
      const deviceData = {
        name: device.name,
        building_id: device.buildingId,
        building_name: device.buildingName,
        floor_name: device.floorName,
        area_name: device.areaName,
        model: device.model,
        power_state: device.powerState,
        operation_mode: device.operationMode,
        target_temperature: device.targetTemperature,
        current_temperature: device.currentTemperature,
        outdoor_temperature: device.outdoorTemperature,
        fan_speed: device.fanSpeed,
        vane_vertical: device.vaneVertical,
        vane_horizontal: device.vaneHorizontal,
        number_of_fan_speeds: device.numberOfFanSpeeds,
        can_cool: device.canCool,
        can_heat: device.canHeat,
        can_dry: device.canDry,
        has_vane_vertical: device.hasVaneVertical,
        has_vane_horizontal: device.hasVaneHorizontal,
        has_swing: device.hasSwing,
        has_wide_vane: device.hasWideVane,
        offline: device.offline,
        has_error: device.hasError,
        error_code: device.errorCode,
        wifi_signal_strength: device.wifiSignalStrength,
        raw_data: device.rawData,
        last_state_update: now,
        updated_at: now,
      }

      if (existingId) {
        toUpdate.push({ id: existingId, data: deviceData })
      } else {
        toInsert.push({
          account_id: accountId,
          device_id: device.deviceId,
          ...deviceData,
        })
      }
    }

    // Batch update existing devices
    if (toUpdate.length > 0) {
      const updateResults = await Promise.all(
        toUpdate.map(({ id, data }) =>
          supabase.from('melcloud_devices').update(data).eq('id', id)
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
        .from('melcloud_devices')
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
      .from('melcloud_devices')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_hidden', false)
      .order('sort_order')
      .order('name')

    return NextResponse.json({
      success: true,
      devices: dbDevices || [],
    })
  } catch (error) {
    console.error('MELCloud devices error:', error)

    if (error instanceof MelCloudAuthError) {
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

// Refresh devices from MELCloud
export async function POST(request: NextRequest) {
  return GET(request)
}
