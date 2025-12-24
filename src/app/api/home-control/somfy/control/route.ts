import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SupabaseClient } from '@supabase/supabase-js'
import { getAuthenticatedClient, clearCachedTokens, SomfyAuthError } from '@/lib/integrations/somfy'
import { SOMFY_API, POSITION } from '@/lib/integrations/somfy/constants'

type ControlCommand = 'open' | 'close' | 'stop' | 'my' | 'setPosition'

interface ControlRequest {
  accountId: string
  deviceUrl: string
  command: ControlCommand
  position?: number
}

interface MultiControlRequest {
  accountId: string
  devices: Array<{
    deviceUrl: string
    command: ControlCommand
    position?: number
  }>
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Parse body once at the start to avoid double-consumption issues
  let body: ControlRequest | MultiControlRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  // Extract accountId for potential token clearing on auth errors
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

    // Handle single device control
    if ('deviceUrl' in body) {
      return handleSingleDevice(body, supabase)
    }

    // Handle multi-device control
    if ('devices' in body && Array.isArray(body.devices)) {
      return handleMultiDevice(body, supabase)
    }

    return NextResponse.json(
      { success: false, error: 'Invalid request format' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Somfy control error:', error)

    if (error instanceof SomfyAuthError) {
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

async function handleSingleDevice(body: ControlRequest, supabase: SupabaseClient) {
  const { accountId, deviceUrl, command, position } = body

  if (!accountId || !deviceUrl || !command) {
    return NextResponse.json(
      { success: false, error: 'accountId, deviceUrl, and command are required' },
      { status: 400 }
    )
  }

  // Validate command
  const validCommands: ControlCommand[] = ['open', 'close', 'stop', 'my', 'setPosition']
  if (!validCommands.includes(command)) {
    return NextResponse.json(
      { success: false, error: `Invalid command. Valid commands: ${validCommands.join(', ')}` },
      { status: 400 }
    )
  }

  if (command === 'setPosition' && (position === undefined || position < POSITION.MIN || position > POSITION.MAX)) {
    return NextResponse.json(
      { success: false, error: 'Position must be between 0 and 100' },
      { status: 400 }
    )
  }

  // SECURITY: Verify device belongs to this account (prevents controlling other households' devices)
  const { data: device, error: deviceError } = await supabase
    .from('home_control_devices')
    .select('id')
    .eq('account_id', accountId)
    .eq('device_url', deviceUrl)
    .single()

  if (deviceError || !device) {
    return NextResponse.json(
      { success: false, error: 'Device not found or access denied' },
      { status: 403 }
    )
  }

  // Get authenticated client (uses cached tokens when available)
  const client = await getAuthenticatedClient(accountId)

  let execId: string
  switch (command) {
    case 'open':
      execId = await client.open(deviceUrl)
      break
    case 'close':
      execId = await client.close(deviceUrl)
      break
    case 'stop':
      execId = await client.stop(deviceUrl)
      break
    case 'my':
      execId = await client.goToFavorite(deviceUrl)
      break
    case 'setPosition':
      execId = await client.setPosition(deviceUrl, position!)
      break
  }

  // Update device position in database (optimistic update)
  if (command === 'setPosition' && position !== undefined) {
    await supabase
      .from('home_control_devices')
      .update({
        position,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('device_url', deviceUrl)
  } else if (command === 'open') {
    await supabase
      .from('home_control_devices')
      .update({
        position: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('device_url', deviceUrl)
  } else if (command === 'close') {
    await supabase
      .from('home_control_devices')
      .update({
        position: 100,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('device_url', deviceUrl)
  }

  return NextResponse.json({
    success: true,
    execId,
    command,
    deviceUrl,
  })
}

async function handleMultiDevice(body: MultiControlRequest, supabase: SupabaseClient) {
  const { accountId, devices } = body

  if (!accountId || !devices || devices.length === 0) {
    return NextResponse.json(
      { success: false, error: 'accountId and devices are required' },
      { status: 400 }
    )
  }

  // Limit batch size to prevent API abuse
  if (devices.length > SOMFY_API.MAX_BATCH_DEVICES) {
    return NextResponse.json(
      { success: false, error: `Maximum ${SOMFY_API.MAX_BATCH_DEVICES} devices per batch` },
      { status: 400 }
    )
  }

  // Validate position for setPosition commands
  const validCommands = ['open', 'close', 'stop', 'my', 'setPosition']
  for (const device of devices) {
    if (!validCommands.includes(device.command)) {
      return NextResponse.json(
        { success: false, error: `Invalid command: ${device.command}` },
        { status: 400 }
      )
    }
    if (device.command === 'setPosition') {
      if (device.position === undefined || device.position < POSITION.MIN || device.position > POSITION.MAX) {
        return NextResponse.json(
          { success: false, error: `Position must be between ${POSITION.MIN} and ${POSITION.MAX} for setPosition command` },
          { status: 400 }
        )
      }
    }
  }

  // SECURITY: Verify all devices belong to this account
  const deviceUrls = devices.map(d => d.deviceUrl)
  const { data: validDevices, error: deviceError } = await supabase
    .from('home_control_devices')
    .select('device_url')
    .eq('account_id', accountId)
    .in('device_url', deviceUrls)

  if (deviceError) {
    return NextResponse.json(
      { success: false, error: 'Failed to validate devices' },
      { status: 500 }
    )
  }

  const validDeviceUrls = new Set(validDevices?.map(d => d.device_url) || [])
  const invalidDevices = deviceUrls.filter(url => !validDeviceUrls.has(url))

  if (invalidDevices.length > 0) {
    return NextResponse.json(
      { success: false, error: 'One or more devices not found or access denied' },
      { status: 403 }
    )
  }

  // Get authenticated client (uses cached tokens when available)
  const client = await getAuthenticatedClient(accountId)

  // Build actions for all devices
  const actions = devices.map(device => {
    let commandName: string
    let parameters: number[] | undefined

    switch (device.command) {
      case 'open':
        commandName = 'open'
        break
      case 'close':
        commandName = 'close'
        break
      case 'stop':
        commandName = 'stop'
        break
      case 'my':
        commandName = 'my'
        break
      case 'setPosition':
        commandName = 'setClosure'
        parameters = [device.position!] // Already validated above
        break
      default:
        commandName = device.command
    }

    return {
      deviceUrl: device.deviceUrl,
      command: commandName,
      parameters,
    }
  })

  const execId = await client.executeMultiple(actions)

  return NextResponse.json({
    success: true,
    execId,
    deviceCount: devices.length,
  })
}
