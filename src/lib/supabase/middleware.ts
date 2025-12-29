import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isUserAdmin } from '@/lib/config'

// Protected routes that require authentication
const PROTECTED_PATHS = ['/uke', '/oppskrifter', '/innstillinger', '/handleliste', '/ny-husstand', '/admin', '/feed']
const ADMIN_PATHS = ['/admin']

// Paths that allow demo mode bypass (all protected paths except admin-only)
const DEMO_ALLOWED_PATHS = ['/uke', '/oppskrifter', '/innstillinger', '/handleliste', '/feed', '/']

// Check if request has a Supabase auth cookie (quick check without calling auth API)
function hasAuthCookie(request: NextRequest): boolean {
  const cookies = request.cookies.getAll()
  // Supabase auth cookies are named like: sb-<project-ref>-auth-token
  return cookies.some(cookie => cookie.name.includes('-auth-token'))
}

// Check if request is in demo mode
function isDemoMode(request: NextRequest): boolean {
  return request.nextUrl.searchParams.get('demo') === 'true'
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isProtectedPath = PROTECTED_PATHS.some(path => pathname.startsWith(path))
  const isAdminPath = ADMIN_PATHS.some(path => pathname.startsWith(path))
  const isLoginPage = pathname === '/login'
  const isDemoAllowed = DEMO_ALLOWED_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'))

  // Demo mode bypass: Allow unauthenticated access to demo-allowed paths
  // NOTE: Admin paths are NOT in demo-allowed - they require real auth
  if (isDemoMode(request) && isDemoAllowed && !isAdminPath) {
    return NextResponse.next({ request })
  }

  // Quick check: if no auth cookie exists, we can skip the expensive getUser() call
  if (!hasAuthCookie(request)) {
    // No session cookie - redirect protected routes to login immediately
    if (isProtectedPath) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    // Non-protected route with no session - just pass through (no auth call needed)
    return NextResponse.next({ request })
  }

  // Auth cookie exists - need to validate/refresh the session
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

  // Refresh session if expired (this is the expensive call we're optimizing)
  const { data: { user } } = await supabase.auth.getUser()

  // Protected routes - redirect to login if session is invalid/expired
  if (!user && isProtectedPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Admin-only routes - redirect non-admin users to home
  if (isAdminPath && !isUserAdmin(user)) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Redirect logged-in users away from login page
  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
