import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isUserAdmin } from '@/lib/config'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session if expired
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Protected routes - redirect to login if not authenticated
  const protectedPaths = ['/uke', '/oppskrifter', '/innstillinger', '/handleliste', '/huskeliste', '/ny-husstand', '/admin']
  const isProtectedPath = protectedPaths.some(path =>
    pathname.startsWith(path)
  )

  if (!user && isProtectedPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Admin-only routes - redirect non-admin users to home
  // Uses JWT app_metadata.is_admin (set during login from allowed_emails table)
  // Note: /api/openrouter is NOT admin-only - it's used by all users for AI features
  // Those endpoints have their own auth checks and rate limiting
  const adminOnlyPaths = ['/admin']
  const isAdminPath = adminOnlyPaths.some(path =>
    pathname.startsWith(path)
  )

  if (isAdminPath && !isUserAdmin(user)) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Redirect logged-in users away from login page
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
