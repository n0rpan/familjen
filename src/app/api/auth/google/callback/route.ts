import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { syncUserAdminStatus, createAdminClient } from '@/lib/supabase/admin'
import { LANGUAGE_COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/i18n/cookie.server'
import { isValidLanguage } from '@/lib/i18n/cookie'

interface GoogleTokenResponse {
  access_token: string
  id_token: string
  expires_in: number
  token_type: string
  scope: string
  refresh_token?: string
}

interface GoogleTokenError {
  error: string
  error_description: string
}

/**
 * Handles Google OAuth callback.
 * Exchanges code for tokens, then uses Supabase signInWithIdToken
 * to create/authenticate the user session.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const cookieStore = await cookies()
  const storedState = cookieStore.get('oauth_state')?.value
  const next = cookieStore.get('oauth_next')?.value ?? '/'

  // Clear OAuth cookies immediately
  cookieStore.delete('oauth_state')
  cookieStore.delete('oauth_next')

  // Handle Google OAuth errors
  if (error) {
    console.error('Google OAuth error:', error, searchParams.get('error_description'))
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  // Verify CSRF state
  if (!state || state !== storedState) {
    console.error('OAuth state mismatch - potential CSRF attack')
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  if (!code) {
    console.error('No authorization code received')
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('Google OAuth credentials not configured')
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  try {
    // Exchange authorization code for tokens
    const redirectUri = `${origin}/api/auth/google/callback`

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    const tokenData = await tokenResponse.json() as GoogleTokenResponse | GoogleTokenError

    if ('error' in tokenData) {
      console.error('Token exchange failed:', tokenData.error, tokenData.error_description)
      return NextResponse.redirect(`${origin}/login?error=auth_failed`)
    }

    // Sign in to Supabase with the Google ID token
    const supabase = await createClient()
    const { data, error: signInError } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: tokenData.id_token,
    })

    if (signInError || !data.user) {
      console.error('Supabase signInWithIdToken failed:', signInError?.message)
      return NextResponse.redirect(`${origin}/login?error=auth_failed`)
    }

    const user = data.user

    // Check if email is allowed / auto-add new users
    if (user.email) {
      const adminClient = createAdminClient()
      const { data: allowed } = await adminClient
        .from('allowed_emails')
        .select('id, is_admin')
        .eq('email', user.email.toLowerCase())
        .single()

      if (!allowed) {
        // Open signup: auto-add new users to allowlist
        console.log('[Auth] Auto-enrolling new user:', user.email.toLowerCase())
        await adminClient
          .from('allowed_emails')
          .insert({
            email: user.email.toLowerCase(),
            is_admin: false,
            can_create_household: true,
          })
      }

      // Sync is_admin to user's app_metadata (JWT claims)
      try {
        await syncUserAdminStatus(user.id, user.email)
      } catch (err) {
        console.error('Failed to sync admin status to JWT:', err)
      }

      // Load user's language preference and set cookie
      const { data: member } = await supabase
        .from('household_members')
        .select('language_preference')
        .eq('user_id', user.id)
        .single()

      const response = NextResponse.redirect(`${origin}${next}`)

      if (member?.language_preference && isValidLanguage(member.language_preference)) {
        response.cookies.set(LANGUAGE_COOKIE_NAME, member.language_preference, {
          path: '/',
          maxAge: COOKIE_MAX_AGE,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        })
      }

      return response
    }

    return NextResponse.redirect(`${origin}${next}`)
  } catch (err) {
    console.error('OAuth callback error:', err)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }
}
