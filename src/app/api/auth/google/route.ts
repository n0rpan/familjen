import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

/**
 * Initiates Google OAuth flow with familjen.eu as the redirect URI.
 * This replaces Supabase's built-in OAuth to avoid showing the
 * scary Supabase URL during Google login.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  // Only allow same-origin relative paths to prevent open-redirect / protocol-relative
  // (`//evil.com`) abuse via the `next` parameter (stored in oauth_next, consumed on callback).
  const rawNext = searchParams.get('next') ?? '/'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    console.error('GOOGLE_CLIENT_ID not configured')
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  // Generate CSRF state token
  const state = crypto.randomUUID()

  // Store state and next URL in cookies for verification
  const cookieStore = await cookies()
  cookieStore.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })
  cookieStore.set('oauth_next', next, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  // Build Google OAuth URL
  const redirectUri = `${origin}/api/auth/google/callback`

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  googleAuthUrl.searchParams.set('client_id', clientId)
  googleAuthUrl.searchParams.set('redirect_uri', redirectUri)
  googleAuthUrl.searchParams.set('response_type', 'code')
  googleAuthUrl.searchParams.set('scope', 'openid email profile')
  googleAuthUrl.searchParams.set('state', state)
  googleAuthUrl.searchParams.set('access_type', 'online')
  googleAuthUrl.searchParams.set('prompt', 'select_account')

  return NextResponse.redirect(googleAuthUrl.toString())
}
