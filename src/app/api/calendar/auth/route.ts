import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthUrl } from '@/lib/google-calendar'
import { isUserAdmin } from '@/lib/config'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

// GET /api/calendar/auth - Start OAuth flow
export async function GET() {
  try {
    // Check if user is admin via JWT claims
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || !isUserAdmin(user)) {
      return ApiErrors.adminRequired()
    }

    // Generate OAuth URL and redirect
    const authUrl = getAuthUrl()
    return NextResponse.redirect(authUrl)
  } catch (error) {
    return handleApiError(error, 'calendar auth')
  }
}
