import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ToshibaClient, ToshibaAuthError } from '@/lib/integrations/toshiba'

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

    // Verify user belongs to a household (prevents unauthorized credential testing)
    const { data: member } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!member) {
      return NextResponse.json(
        { success: false, error: 'No household membership' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Username and password are required' },
        { status: 400 }
      )
    }

    // Test connection with Toshiba Home AC Control
    const client = new ToshibaClient({
      debug: process.env.NODE_ENV === 'development',
    })

    await client.login(username, password)

    // Get devices to show in the response
    const devices = await client.getMappedDevices()

    return NextResponse.json({
      success: true,
      deviceCount: devices.length,
      devices: devices.map(d => ({
        name: d.name,
        model: d.model,
        powerState: d.powerState,
        operationMode: d.operationMode,
        targetTemperature: d.targetTemperature,
        currentTemperature: d.currentTemperature,
      })),
    })
  } catch (error) {
    console.error('Toshiba test-connection error:', error)

    if (error instanceof ToshibaAuthError) {
      return NextResponse.json(
        { success: false, error: 'Invalid username or password' },
        { status: 401 }
      )
    }

    const message = error instanceof Error ? error.message : 'Connection failed'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
