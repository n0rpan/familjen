import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SupabaseClient } from '@supabase/supabase-js'
import {
  getAuthenticatedClient,
  clearCachedTokens,
  ToshibaAuthError,
  type ToshibaOperationMode,
  type ToshibaFanSpeed,
  type ToshibaSwingMode,
  type ToshibaPowerState,
  TEMPERATURE_LIMITS,
} from '@/lib/integrations/toshiba'

type ControlCommand =
  | 'power'
  | 'temperature'
  | 'mode'
  | 'fanSpeed'
  | 'swing'
  | 'pure'
  | 'turnOn'
  | 'turnOff'

interface ControlRequest {
  accountId: string
  acId: string
  command: ControlCommand
  value?: string | number
  // For turnOn with settings
  mode?: ToshibaOperationMode
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
    console.error('Toshiba control error:', error)

    if (error instanceof ToshibaAuthError) {
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
  const { accountId, acId, command, value, mode, temperature } = body

  if (!accountId || !acId || !command) {
    return NextResponse.json(
      { success: false, error: 'accountId, acId, and command are required' },
      { status: 400 }
    )
  }

  // Validate command
  const validCommands: ControlCommand[] = ['power', 'temperature', 'mode', 'fanSpeed', 'swing', 'pure', 'turnOn', 'turnOff']
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

  if (command === 'power' && value !== 'ON' && value !== 'OFF') {
    return NextResponse.json(
      { success: false, error: 'Power value must be ON or OFF' },
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
    const validSpeeds = ['AUTO', 'QUIET', 'LOW', 'MEDIUM_LOW', 'MEDIUM', 'MEDIUM_HIGH', 'HIGH']
    if (!validSpeeds.includes(value as string)) {
      return NextResponse.json(
        { success: false, error: `Invalid fan speed. Valid speeds: ${validSpeeds.join(', ')}` },
        { status: 400 }
      )
    }
  }

  if (command === 'swing') {
    const validSwings = ['OFF', 'ON', 'VERTICAL', 'HORIZONTAL']
    if (!validSwings.includes(value as string)) {
      return NextResponse.json(
        { success: false, error: `Invalid swing mode. Valid modes: ${validSwings.join(', ')}` },
        { status: 400 }
      )
    }
  }

  if (command === 'pure' && value !== 'ON' && value !== 'OFF') {
    return NextResponse.json(
      { success: false, error: 'Pure value must be ON or OFF' },
      { status: 400 }
    )
  }

  // SECURITY: Verify device belongs to this account
  const { data: device, error: deviceError } = await supabase
    .from('toshiba_ac_devices')
    .select('id, target_temperature')
    .eq('account_id', accountId)
    .eq('ac_id', acId)
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
    case 'power':
      await client.setPowerState(acId, value as ToshibaPowerState)
      await supabase.rpc('update_toshiba_device_state', {
        p_device_id: device.id,
        p_power_state: value,
      })
      break

    case 'temperature':
      // Pass current temperature so client can detect 8°C mode
      await client.setTemperature(acId, Number(value), device.target_temperature ?? undefined)
      await supabase.rpc('update_toshiba_device_state', {
        p_device_id: device.id,
        p_target_temperature: Number(value),
      })
      break

    case 'mode':
      await client.setOperationMode(acId, value as ToshibaOperationMode)
      await supabase.rpc('update_toshiba_device_state', {
        p_device_id: device.id,
        p_operation_mode: value,
      })
      break

    case 'fanSpeed':
      await client.setFanSpeed(acId, value as ToshibaFanSpeed)
      await supabase.rpc('update_toshiba_device_state', {
        p_device_id: device.id,
        p_fan_speed: value,
      })
      break

    case 'swing':
      await client.setSwingMode(acId, value as ToshibaSwingMode)
      await supabase.rpc('update_toshiba_device_state', {
        p_device_id: device.id,
        p_swing_mode: value,
      })
      break

    case 'pure':
      await client.setPureState(acId, value as 'ON' | 'OFF')
      await supabase.rpc('update_toshiba_device_state', {
        p_device_id: device.id,
        p_pure_state: value,
      })
      break

    case 'turnOn':
      await client.turnOn(acId, mode, temperature)
      await supabase.rpc('update_toshiba_device_state', {
        p_device_id: device.id,
        p_power_state: 'ON',
        p_operation_mode: mode ?? null,
        p_target_temperature: temperature ?? null,
      })
      break

    case 'turnOff':
      await client.turnOff(acId)
      await supabase.rpc('update_toshiba_device_state', {
        p_device_id: device.id,
        p_power_state: 'OFF',
      })
      break
  }

  return NextResponse.json({
    success: true,
    command,
    acId,
    value: value ?? (command === 'turnOn' ? { mode, temperature } : undefined),
  })
}
