import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isUserAdmin } from '@/lib/config'

// Protected routes that require authentication
const PROTECTED_PATHS = ['/uke', '/oppskrifter', '/innstillinger', '/handleliste', '/ny-husstand', '/admin', '/feed', '/styring']
const ADMIN_PATHS = ['/admin']

// Paths that allow demo mode bypass (all protected paths except admin-only)
const DEMO_ALLOWED_PATHS = ['/uke', '/oppskrifter', '/innstillinger', '/handleliste', '/feed', '/styring', '/']

// Cookie name for tracking last validation time
const VALIDATION_COOKIE = 'familjen-auth-validated'

// Only validate with Supabase server every 5 minutes (instant navigation between validations)
const VALIDATION_INTERVAL_MS = 5 * 60 * 1000

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

// Check if we recently validated the session (within VALIDATION_INTERVAL_MS)
function wasRecentlyValidated(request: NextRequest): boolean {
  const validationCookie = request.cookies.get(VALIDATION_COOKIE)
  if (!validationCookie?.value) return false

  const lastValidated = parseInt(validationCookie.value, 10)
  if (isNaN(lastValidated)) return false

  return Date.now() - lastValidated < VALIDATION_INTERVAL_MS
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

  // FAST PATH: If we validated recently, trust local session (no network call!)
  // This makes menu navigation instant. Background validator catches expired sessions.
  const recentlyValidated = wasRecentlyValidated(request)

  // For non-admin routes, skip validation if we validated recently
  // Admin routes always validate for security
  if (recentlyValidated && !isAdminPath && !isLoginPage) {
    return NextResponse.next({ request })
  }

  // SLOW PATH: Need to validate/refresh the session with Supabase
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

  // Validate session with Supabase (network call)
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

  // Set validation timestamp cookie for fast path on next navigation
  if (user) {
    supabaseResponse.cookies.set(VALIDATION_COOKIE, Date.now().toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/', // Explicit path ensures cookie is accessible across all routes
      maxAge: VALIDATION_INTERVAL_MS / 1000, // Cookie expires when validation is needed
    })
  }

  return supabaseResponse
}
