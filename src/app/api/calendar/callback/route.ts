import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTokensFromCode, getOAuth2Client } from '@/lib/google-calendar'
import { isAdminEmail } from '@/lib/config'
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

    // Check if user is admin
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || !isAdminEmail(user.email)) {
      return NextResponse.redirect(new URL('/admin?calendar_error=unauthorized', request.url))
    }

    // Exchange code for tokens
    const tokens = await getTokensFromCode(code)

    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('Missing tokens:', tokens)
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

    // Store tokens in database (upsert)
    const { error: dbError } = await supabase
      .from('google_calendar_tokens')
      .upsert(
        {
          email: googleEmail,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type || 'Bearer',
          expiry_date: tokens.expiry_date,
        },
        { onConflict: 'email' }
      )

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
