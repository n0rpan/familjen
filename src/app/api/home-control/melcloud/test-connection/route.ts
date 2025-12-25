import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { MelCloudClient, MelCloudAuthError } from '@/lib/integrations/melcloud'

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
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Test connection with MELCloud
    const client = new MelCloudClient({
      debug: process.env.NODE_ENV === 'development',
    })

    await client.login(email, password)

    // Get devices to show in the response
    const devices = await client.getMappedDevices()

    return NextResponse.json({
      success: true,
      deviceCount: devices.length,
      devices: devices.map(d => ({
        name: d.name,
        buildingName: d.buildingName,
        powerState: d.powerState,
        operationMode: d.operationMode,
        targetTemperature: d.targetTemperature,
        currentTemperature: d.currentTemperature,
        outdoorTemperature: d.outdoorTemperature,
      })),
    })
  } catch (error) {
    console.error('MELCloud test-connection error:', error)

    if (error instanceof MelCloudAuthError) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
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
