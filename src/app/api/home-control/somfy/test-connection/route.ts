import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SomfyClient, SomfyAuthError } from '@/lib/integrations/somfy'
import type { OverkizServer } from '@/lib/integrations/somfy'

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

    // Parse request body
    const body = await request.json()
    const { email, password, server = 'somfy_europe' } = body

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Test connection with Somfy
    const client = new SomfyClient({
      server: server as OverkizServer,
      debug: process.env.NODE_ENV === 'development',
    })

    await client.login(email, password)

    // Get gateways to show in the response
    const gateways = await client.getGateways()

    // Get device count
    const devices = await client.getSupportedDevices()

    return NextResponse.json({
      success: true,
      gateways: gateways.map(g => ({
        id: g.gatewayId,
        type: g.type,
        alive: g.alive,
        mode: g.mode,
      })),
      deviceCount: devices.length,
      devices: devices.map(d => ({
        label: d.label,
        uiClass: d.uiClass,
        available: d.available,
      })),
    })
  } catch (error) {
    console.error('Somfy test-connection error:', error)

    if (error instanceof SomfyAuthError) {
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
