import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthUrl } from '@/lib/google-calendar'
import { isUserAdmin } from '@/lib/config'

// GET /api/calendar/auth - Start OAuth flow
export async function GET() {
  try {
    // Check if user is admin via JWT claims
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || !isUserAdmin(user)) {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      )
    }

    // Generate OAuth URL and redirect
    const authUrl = getAuthUrl()
    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('Calendar auth error:', error)
    return NextResponse.json(
      { error: 'Failed to start OAuth flow' },
      { status: 500 }
    )
  }
}
