import { createClient } from '@/lib/supabase/server'
import { syncUserAdminStatus } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { LANGUAGE_COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/i18n/cookie.server'
import { isValidLanguage } from '@/lib/i18n/cookie'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Check if email is allowed
      const { data: { user } } = await supabase.auth.getUser()

      if (user?.email) {
        const { data: allowed } = await supabase
          .from('allowed_emails')
          .select('id, is_admin')
          .eq('email', user.email.toLowerCase())
          .single()

        if (!allowed) {
          // Email not in allowlist - sign out and redirect with error
          await supabase.auth.signOut()
          return NextResponse.redirect(`${origin}/login?error=not_allowed`)
        }

        // Sync is_admin to user's app_metadata (JWT claims)
        // This allows middleware to check admin status without DB lookup
        try {
          await syncUserAdminStatus(user.id, user.email)
        } catch (err) {
          // Non-fatal: admin status will be checked via DB as fallback
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
          })
        }

        return response
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
