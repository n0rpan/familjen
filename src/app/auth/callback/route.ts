import { createClient } from '@/lib/supabase/server'
import { syncUserMetadata, createAdminClient } from '@/lib/supabase/admin'
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
        // Use admin client to bypass RLS for allowlist check
        const adminClient = createAdminClient()
        const { data: allowed } = await adminClient
          .from('allowed_emails')
          .select('id, is_admin')
          .eq('email', user.email.toLowerCase())
          .single()

        if (!allowed) {
          // Open signup: auto-add new users to allowlist
          // They can create their own household
          await adminClient
            .from('allowed_emails')
            .insert({
              email: user.email.toLowerCase(),
              is_admin: false,
              can_create_household: true,
            })
        }

        // Load user's membership info (household_id + language preference)
        // This data is cached in JWT to avoid DB lookups on every page load
        const { data: member } = await adminClient
          .from('household_members')
          .select('household_id, language_preference')
          .eq('user_id', user.id)
          .single()

        // Sync is_admin and household_id to user's app_metadata (JWT claims)
        // This allows pages to access household without DB lookup
        try {
          await syncUserMetadata(user.id, user.email, member?.household_id || null)
        } catch (err) {
          // Non-fatal: will fall back to DB lookup
          console.error('Failed to sync user metadata to JWT:', err)
        }

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
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
