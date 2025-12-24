import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedClient, clearCachedTokens, SomfyAuthError } from '@/lib/integrations/somfy'

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

    const body = await request.json() as ControlRequest | MultiControlRequest

    // Handle single device control
    if ('deviceUrl' in body) {
      return handleSingleDevice(body)
    }

    // Handle multi-device control
    if ('devices' in body && Array.isArray(body.devices)) {
      return handleMultiDevice(body)
    }

    return NextResponse.json(
      { success: false, error: 'Invalid request format' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Somfy control error:', error)

    if (error instanceof SomfyAuthError) {
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

async function handleSingleDevice(body: ControlRequest) {
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

  if (command === 'setPosition' && (position === undefined || position < 0 || position > 100)) {
    return NextResponse.json(
      { success: false, error: 'Position must be between 0 and 100' },
      { status: 400 }
    )
  }

  // Get authenticated client (uses cached tokens when available)
  const client = await getAuthenticatedClient(accountId)
  const supabase = await createClient()

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

async function handleMultiDevice(body: MultiControlRequest) {
  const { accountId, devices } = body

  if (!accountId || !devices || devices.length === 0) {
    return NextResponse.json(
      { success: false, error: 'accountId and devices are required' },
      { status: 400 }
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
        parameters = [device.position ?? 50]
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
