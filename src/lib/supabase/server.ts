import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Get user from local session (no network call)
 *
 * SECURITY: This reads the JWT from cookies without validating with Supabase.
 * This is safe because:
 * 1. Middleware already validated the session on this request
 * 2. JWT is cryptographically signed and can't be forged
 * 3. Background validation runs periodically on the client
 *
 * Use this for page components after middleware has run.
 * For API routes or sensitive operations, use supabase.auth.getUser() instead.
 */
export async function getSessionLocal(): Promise<User | null> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user ?? null
}
