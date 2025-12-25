import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SupabaseClient } from '@supabase/supabase-js'
import {
  getAuthenticatedClient,
  clearCachedTokens,
  MelCloudAuthError,
  type MelCloudOperationMode,
  type MelCloudFanSpeed,
  type MelCloudVaneVertical,
  type MelCloudVaneHorizontal,
  TEMPERATURE_LIMITS,
} from '@/lib/integrations/melcloud'

type ControlCommand =
  | 'power'
  | 'temperature'
  | 'mode'
  | 'fanSpeed'
  | 'vaneVertical'
  | 'vaneHorizontal'
  | 'turnOn'
  | 'turnOff'

interface ControlRequest {
  accountId: string
  deviceId: number
  buildingId: number
  command: ControlCommand
  value?: string | number | boolean
  // For turnOn with settings
  mode?: MelCloudOperationMode
  temperature?: number
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Parse body once at the start
  let body: ControlRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const accountId = body?.accountId

  try {
    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      )
    }

    return handleControl(body, supabase)
  } catch (error) {
    console.error('MELCloud control error:', error)

    if (error instanceof MelCloudAuthError) {
      // Clear cached tokens for this account
      if (accountId) {
        try {
          await clearCachedTokens(accountId)
        } catch {
          // Ignore errors when clearing tokens
        }
      }

      return NextResponse.json(
        { success: false, error: 'Authentication failed' },
        { status: 401 }
      )
    }

    const message = error instanceof Error ? error.message : 'Command failed'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

async function handleControl(body: ControlRequest, supabase: SupabaseClient) {
  const { accountId, deviceId, buildingId, command, value, mode, temperature } = body

  if (!accountId || deviceId === undefined || buildingId === undefined || !command) {
    return NextResponse.json(
      { success: false, error: 'accountId, deviceId, buildingId, and command are required' },
      { status: 400 }
    )
  }

  // Validate command
  const validCommands: ControlCommand[] = ['power', 'temperature', 'mode', 'fanSpeed', 'vaneVertical', 'vaneHorizontal', 'turnOn', 'turnOff']
  if (!validCommands.includes(command)) {
    return NextResponse.json(
      { success: false, error: `Invalid command. Valid commands: ${validCommands.join(', ')}` },
      { status: 400 }
    )
  }

  // Validate value based on command
  if (command === 'temperature') {
    const temp = Number(value)
    if (isNaN(temp) || temp < TEMPERATURE_LIMITS.MIN || temp > TEMPERATURE_LIMITS.MAX) {
      return NextResponse.json(
        { success: false, error: `Temperature must be between ${TEMPERATURE_LIMITS.MIN} and ${TEMPERATURE_LIMITS.MAX}` },
        { status: 400 }
      )
    }
  }

  if (command === 'power' && value !== true && value !== false && value !== 'ON' && value !== 'OFF') {
    return NextResponse.json(
      { success: false, error: 'Power value must be ON, OFF, true, or false' },
      { status: 400 }
    )
  }

  if (command === 'mode') {
    const validModes = ['AUTO', 'COOL', 'HEAT', 'DRY', 'FAN']
    if (!validModes.includes(value as string)) {
      return NextResponse.json(
        { success: false, error: `Invalid mode. Valid modes: ${validModes.join(', ')}` },
        { status: 400 }
      )
    }
  }

  if (command === 'fanSpeed') {
    const validSpeeds = ['AUTO', 'SPEED_1', 'SPEED_2', 'SPEED_3', 'SPEED_4', 'SPEED_5']
    if (!validSpeeds.includes(value as string)) {
      return NextResponse.json(
        { success: false, error: `Invalid fan speed. Valid speeds: ${validSpeeds.join(', ')}` },
        { status: 400 }
      )
    }
  }

  if (command === 'vaneVertical') {
    const validPositions = ['AUTO', 'POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5', 'SWING']
    if (!validPositions.includes(value as string)) {
      return NextResponse.json(
        { success: false, error: `Invalid vane position. Valid positions: ${validPositions.join(', ')}` },
        { status: 400 }
      )
    }
  }

  if (command === 'vaneHorizontal') {
    const validPositions = ['AUTO', 'POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5', 'SPLIT', 'SWING']
    if (!validPositions.includes(value as string)) {
      return NextResponse.json(
        { success: false, error: `Invalid vane position. Valid positions: ${validPositions.join(', ')}` },
        { status: 400 }
      )
    }
  }

  // SECURITY: Verify device belongs to this account
  const { data: device, error: deviceError } = await supabase
    .from('melcloud_devices')
    .select('id')
    .eq('account_id', accountId)
    .eq('device_id', deviceId)
    .single()

  if (deviceError || !device) {
    return NextResponse.json(
      { success: false, error: 'Device not found or access denied' },
      { status: 403 }
    )
  }

  // Get authenticated client
  const client = await getAuthenticatedClient(accountId)

  // Execute command
  switch (command) {
    case 'power': {
      const powerOn = value === true || value === 'ON'
      if (powerOn) {
        await client.turnOn(deviceId, buildingId)
      } else {
        await client.turnOff(deviceId, buildingId)
      }
      await supabase.rpc('update_melcloud_device_state', {
        p_device_id: device.id,
        p_power_state: powerOn ? 'ON' : 'OFF',
      })
      break
    }

    case 'temperature':
      await client.setTemperature(deviceId, buildingId, Number(value))
      await supabase.rpc('update_melcloud_device_state', {
        p_device_id: device.id,
        p_target_temperature: Number(value),
      })
      break

    case 'mode':
      await client.setOperationMode(deviceId, buildingId, value as MelCloudOperationMode)
      await supabase.rpc('update_melcloud_device_state', {
        p_device_id: device.id,
        p_operation_mode: value,
      })
      break

    case 'fanSpeed':
      await client.setFanSpeed(deviceId, buildingId, value as MelCloudFanSpeed)
      await supabase.rpc('update_melcloud_device_state', {
        p_device_id: device.id,
        p_fan_speed: value,
      })
      break

    case 'vaneVertical':
      await client.setVaneVertical(deviceId, buildingId, value as MelCloudVaneVertical)
      await supabase.rpc('update_melcloud_device_state', {
        p_device_id: device.id,
        p_vane_vertical: value,
      })
      break

    case 'vaneHorizontal':
      await client.setVaneHorizontal(deviceId, buildingId, value as MelCloudVaneHorizontal)
      await supabase.rpc('update_melcloud_device_state', {
        p_device_id: device.id,
        p_vane_horizontal: value,
      })
      break

    case 'turnOn':
      await client.turnOn(deviceId, buildingId, mode, temperature)
      await supabase.rpc('update_melcloud_device_state', {
        p_device_id: device.id,
        p_power_state: 'ON',
        p_operation_mode: mode ?? null,
        p_target_temperature: temperature ?? null,
      })
      break

    case 'turnOff':
      await client.turnOff(deviceId, buildingId)
      await supabase.rpc('update_melcloud_device_state', {
        p_device_id: device.id,
        p_power_state: 'OFF',
      })
      break
  }

  return NextResponse.json({
    success: true,
    command,
    deviceId,
    value: value ?? (command === 'turnOn' ? { mode, temperature } : undefined),
  })
}
