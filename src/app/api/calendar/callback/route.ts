import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTokensFromCode, getOAuth2Client } from '@/lib/google-calendar'
import { isUserAdmin } from '@/lib/config'
import { google } from 'googleapis'

// GET /api/calendar/callback - OAuth callback from Google
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error) {
      console.error('OAuth error:', error)
      return NextResponse.redirect(new URL('/admin?calendar_error=' + error, request.url))
    }

    if (!code) {
      return NextResponse.redirect(new URL('/admin?calendar_error=no_code', request.url))
    }

    // Check if user is admin via JWT claims
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || !isUserAdmin(user)) {
      return NextResponse.redirect(new URL('/admin?calendar_error=unauthorized', request.url))
    }

    // Exchange code for tokens
    const tokens = await getTokensFromCode(code)

    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('Missing tokens - access_token:', !!tokens.access_token, 'refresh_token:', !!tokens.refresh_token)
      return NextResponse.redirect(new URL('/admin?calendar_error=missing_tokens', request.url))
    }

    // Get the email of the Google account
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const userInfo = await oauth2.userinfo.get()
    const googleEmail = userInfo.data.email

    if (!googleEmail) {
      return NextResponse.redirect(new URL('/admin?calendar_error=no_email', request.url))
    }

    // Store tokens in database using encrypted upsert function
    const { error: dbError } = await supabase.rpc('upsert_calendar_token', {
      p_email: googleEmail,
      p_access_token: tokens.access_token,
      p_refresh_token: tokens.refresh_token,
      p_token_type: tokens.token_type || 'Bearer',
      p_expiry_date: tokens.expiry_date,
    })

    if (dbError) {
      console.error('Database error:', dbError)
      return NextResponse.redirect(new URL('/admin?calendar_error=db_error', request.url))
    }

    // Success - redirect to admin with success message
    return NextResponse.redirect(new URL('/admin?calendar_connected=' + googleEmail, request.url))
  } catch (error) {
    console.error('Calendar callback error:', error)
    return NextResponse.redirect(new URL('/admin?calendar_error=unknown', request.url))
  }
}
