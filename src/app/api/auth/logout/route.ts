import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { validateOrigin } from '@/lib/config'
import { ApiErrors } from '@/lib/api-errors'

// GET is intentionally not supported to prevent CSRF attacks
// Logout must be triggered via POST or client-side supabase.auth.signOut()
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST for logout.' },
    { status: 405 }
  )
}

export async function POST(request: Request) {
  // CSRF protection
  if (!validateOrigin(request)) {
    return ApiErrors.invalidOrigin()
  }

  const supabase = await createClient()
  await supabase.auth.signOut()

  const { origin } = new URL(request.url)
  const response = NextResponse.redirect(`${origin}/login`)
  // Clear the httpOnly middleware fast-path validation cookie. supabase.auth.signOut()
  // clears the sb-* auth cookies, but not this one, and the client cannot delete it
  // (httpOnly), so it must be cleared here to avoid leaving a "recently validated"
  // marker behind on a shared device after logout.
  response.cookies.delete('familjen-auth-validated')
  return response
}
