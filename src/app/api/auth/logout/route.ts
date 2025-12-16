import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET is intentionally not supported to prevent CSRF attacks
// Logout must be triggered via POST or client-side supabase.auth.signOut()
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST for logout.' },
    { status: 405 }
  )
}

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const { origin } = new URL(request.url)
  return NextResponse.redirect(`${origin}/login`)
}
