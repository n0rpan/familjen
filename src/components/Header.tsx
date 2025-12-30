'use client'

import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { User } from '@supabase/supabase-js'
import { useTranslation } from '@/lib/i18n/context'
import { TransitionLink } from './TransitionLink'
import { usePrefetchRoutes, KEY_ROUTES, SECONDARY_ROUTES } from '@/hooks/usePrefetchRoutes'
import { useIsDemo } from '@/lib/demo/context'
import { clearAllCache } from '@/lib/cache'
import { clearAllChanges } from '@/lib/offline-queue'

// Notification badge component
function NotificationBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span
      className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-xs font-bold rounded-full px-1"
      style={{ background: 'var(--color-coral)', color: 'white' }}
      aria-label={`${count} unread notifications`}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9,22 9,12 15,12 15,22"/>
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

function BookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

function ShoppingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  )
}

function FeedIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1"/>
      <circle cx="12" cy="5" r="1"/>
      <circle cx="12" cy="19" r="1"/>
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

function HomeControlIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
    </svg>
  )
}

export function Header() {
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [hasHomeControl, setHasHomeControl] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [notificationCount, setNotificationCount] = useState(0)
  const supabase = useMemo(() => createClient(), [])
  const t = useTranslation()
  const isDemo = useIsDemo()

  // Helper to create demo-aware links (preserves ?demo=true in demo mode)
  const getDemoHref = useCallback((href: string) => {
    return isDemo ? `${href}?demo=true` : href
  }, [isDemo])

  // Proactively prefetch key routes for instant navigation
  // Primary routes (/, /uke, /feed) prefetch first, then secondary
  usePrefetchRoutes([...KEY_ROUTES, ...SECONDARY_ROUTES])

  // Primary navigation items (shown in both desktop and mobile bottom bar)
  // Structure: Hjem, Uke, Feed, Handleliste + Mer menu
  const primaryNav = useMemo(() => [
    { name: t.nav.home, href: getDemoHref('/'), icon: HomeIcon },
    { name: t.nav.weekPlan, href: getDemoHref('/uke'), icon: CalendarIcon },
    { name: t.nav.feed, href: getDemoHref('/feed'), icon: FeedIcon },
    { name: t.nav.shoppingList, href: getDemoHref('/handleliste'), icon: ShoppingIcon },
  ], [t.nav, getDemoHref])

  // Secondary nav items (shown in "More" menu on both desktop and mobile)
  const secondaryNav = useMemo(() => [
    { name: t.nav.recipes, href: getDemoHref('/oppskrifter'), icon: BookIcon },
    { name: t.nav.settings, href: getDemoHref('/innstillinger'), icon: SettingsIcon },
  ], [t.nav, getDemoHref])

  // Check if current page is a secondary nav item (not in primary nav)
  const isSecondaryActive = useMemo(() =>
    secondaryNav.some(item => pathname === item.href) || pathname === '/admin' || pathname === '/styring',
    [secondaryNav, pathname]
  )

  // Fetch unread notification count
  const fetchNotificationCount = useCallback(async () => {
    const { count } = await supabase
      .from('event_change_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'unread')
    setNotificationCount(count || 0)
  }, [supabase])

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)

      // Check admin status from JWT app_metadata (set during login by syncUserAdminStatus)
      // This avoids RLS-related issues with querying allowed_emails
      setIsAdmin(user?.app_metadata?.is_admin === true)

      // Check if user has home control accounts
      if (user) {
        const { data: accounts } = await supabase
          .rpc('get_household_home_control_accounts')
        setHasHomeControl(accounts && accounts.length > 0)

        // Fetch notification count
        fetchNotificationCount()
      }
    }
    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      // Check admin status from JWT app_metadata
      setIsAdmin(session?.user?.app_metadata?.is_admin === true)

      // Refresh notification count on auth change
      if (session?.user) {
        fetchNotificationCount()
      } else {
        setNotificationCount(0)
      }
    })

    // Subscribe to notification changes for real-time updates
    const notificationChannel = supabase
      .channel('notification-count')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_change_notifications',
        },
        () => fetchNotificationCount()
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
      notificationChannel.unsubscribe()
    }
  }, [supabase, fetchNotificationCount])

  const handleLogout = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    // Clear local caches before logout (silent fail - not critical)
    await Promise.all([
      clearAllCache(),
      clearAllChanges(),
    ]).catch(() => {})
    await supabase.auth.signOut()
    window.location.href = '/login'
  }, [supabase])

  // Don't show header on login page
  if (pathname === '/login') {
    return null
  }

  return (
    <>
      {/* Desktop Header */}
      <header
        className="hidden lg:block w-full sticky top-0 z-50 backdrop-blur-md"
        style={{
          background: 'var(--header-bg)',
          borderBottom: '1px solid var(--border)',
          viewTransitionName: 'header',
        }}
      >
        <div className="max-w-6xl mx-auto px-6 w-full">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <TransitionLink href={getDemoHref('/')} className="flex items-center gap-3 group">
              <Image
                src="/icons/icon.svg"
                alt="Familjen"
                width={36}
                height={36}
                className="rounded-xl transition-transform group-hover:scale-105"
              />
              <span className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
                Familjen{isDemo && ' Demo'}
              </span>
            </TransitionLink>

            {/* Navigation */}
            <nav className="flex items-center gap-1" aria-label="Main navigation">
              {primaryNav.map((item) => {
                const isActive = pathname === item.href
                const isFeed = item.href === '/feed'
                return (
                  <TransitionLink
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:bg-[var(--sand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                    style={{
                      background: isActive ? 'var(--accent)' : 'transparent',
                      color: isActive ? 'white' : 'var(--muted)',
                    }}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="relative">
                      <item.icon />
                      {isFeed && <NotificationBadge count={notificationCount} />}
                    </span>
                    <span>{item.name}</span>
                  </TransitionLink>
                )
              })}
              {/* More dropdown button for desktop */}
              <div className="relative">
                <button
                  onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:bg-[var(--sand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  style={{
                    background: isSecondaryActive ? 'var(--accent)' : 'transparent',
                    color: isSecondaryActive ? 'white' : 'var(--muted)',
                  }}
                  aria-expanded={moreMenuOpen}
                  aria-haspopup="menu"
                >
                  <MoreIcon />
                  <span>{t.nav.more}</span>
                </button>

                {/* Desktop More Dropdown */}
                {moreMenuOpen && (
                  <>
                    {/* Backdrop */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMoreMenuOpen(false)}
                    />
                    {/* Dropdown */}
                    <div
                      className="absolute right-0 top-full mt-2 z-50 min-w-[200px] py-2 rounded-xl shadow-lg"
                      style={{
                        background: 'var(--card)',
                        border: '1px solid var(--border)'
                      }}
                      role="menu"
                    >
                      {/* Recipes */}
                      <TransitionLink
                        href={secondaryNav[0].href}
                        onClick={() => setMoreMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-[var(--sand)]"
                        style={{
                          background: pathname === secondaryNav[0].href ? 'var(--accent)' : 'transparent',
                          color: pathname === secondaryNav[0].href ? 'white' : 'var(--foreground)',
                        }}
                        role="menuitem"
                        aria-current={pathname === secondaryNav[0].href ? 'page' : undefined}
                      >
                        <BookIcon />
                        <span>{secondaryNav[0].name}</span>
                      </TransitionLink>
                      {/* Home Control (before Settings) */}
                      {hasHomeControl && (
                        <TransitionLink
                          href={getDemoHref('/styring')}
                          onClick={() => setMoreMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-[var(--sand)]"
                          style={{
                            background: pathname === '/styring' ? 'var(--accent)' : 'transparent',
                            color: pathname === '/styring' ? 'white' : 'var(--foreground)',
                          }}
                          role="menuitem"
                          aria-current={pathname === '/styring' ? 'page' : undefined}
                        >
                          <HomeControlIcon />
                          <span>{t.nav.homeControl}</span>
                        </TransitionLink>
                      )}
                      {/* Settings */}
                      <TransitionLink
                        href={secondaryNav[1].href}
                        onClick={() => setMoreMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-[var(--sand)]"
                        style={{
                          background: pathname === secondaryNav[1].href ? 'var(--accent)' : 'transparent',
                          color: pathname === secondaryNav[1].href ? 'white' : 'var(--foreground)',
                        }}
                        role="menuitem"
                        aria-current={pathname === secondaryNav[1].href ? 'page' : undefined}
                      >
                        <SettingsIcon />
                        <span>{secondaryNav[1].name}</span>
                      </TransitionLink>
                      {isAdmin && (
                        <TransitionLink
                          href="/admin"
                          onClick={() => setMoreMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-[var(--sand)]"
                          style={{
                            background: pathname === '/admin' ? 'var(--accent)' : 'transparent',
                            color: pathname === '/admin' ? 'white' : 'var(--foreground)',
                          }}
                          role="menuitem"
                          aria-current={pathname === '/admin' ? 'page' : undefined}
                        >
                          <ShieldIcon />
                          <span>{t.nav.admin}</span>
                        </TransitionLink>
                      )}
                    </div>
                  </>
                )}
              </div>
            </nav>

            {/* User menu */}
            <div className="flex items-center gap-3">
              {user && (
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 hover:bg-[var(--sand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  style={{ color: 'var(--muted)' }}
                >
                  {t.nav.logout}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Top Header */}
      <header
        className="lg:hidden w-full fixed top-0 left-0 right-0 z-40"
        style={{
          background: 'var(--background)',
          borderBottom: '1px solid var(--border)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          viewTransitionName: 'mobile-header',
        }}
      >
        <div className="flex justify-center items-center h-14 px-4">
          <TransitionLink href={getDemoHref('/')} className="flex items-center gap-2 group">
            <Image
              src="/icons/icon.svg"
              alt="Familjen"
              width={32}
              height={32}
              className="rounded-xl transition-transform group-hover:scale-105"
            />
            <span className="text-lg font-semibold font-display" style={{ color: 'var(--foreground)' }}>
              Familjen{isDemo && ' Demo'}
            </span>
          </TransitionLink>
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 backdrop-blur-md safe-area-pb"
        style={{
          background: 'var(--nav-bg)',
          borderTop: '1px solid var(--border)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          viewTransitionName: 'mobile-nav',
        }}
        aria-label="Mobile navigation"
      >
        <div className="flex justify-around items-center h-16 px-2">
          {primaryNav.map((item) => {
            const isActive = pathname === item.href
            const isFeed = item.href === '/feed'
            return (
              <TransitionLink
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-all duration-200 touch-feedback focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                style={{
                  color: isActive ? 'var(--accent)' : 'var(--muted)',
                }}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="relative">
                  <item.icon />
                  {isFeed && <NotificationBadge count={notificationCount} />}
                </span>
                <span className="text-xs font-medium">{item.name}</span>
              </TransitionLink>
            )
          })}
          {/* More button */}
          <button
            onClick={() => setMoreMenuOpen(true)}
            className="flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-all duration-200 touch-feedback focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={{
              color: isSecondaryActive ? 'var(--accent)' : 'var(--muted)',
            }}
            aria-expanded={moreMenuOpen}
            aria-haspopup="dialog"
            aria-label={t.nav.more}
          >
            <MoreIcon />
            <span className="text-xs font-medium">{t.nav.more}</span>
          </button>
        </div>
      </nav>

      {/* Mobile More Menu Overlay */}
      {moreMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
          onClick={() => setMoreMenuOpen(false)}
        />
      )}

      {/* Mobile More Menu Slide-up */}
      <div
        className={`lg:hidden fixed bottom-0 left-0 right-0 z-[70] transform transition-transform duration-300 ease-out ${
          moreMenuOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          background: 'var(--card)',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.15)'
        }}
        role="dialog"
        aria-label={t.nav.more}
        aria-hidden={!moreMenuOpen}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-[var(--muted)] opacity-40" />
        </div>

        {/* Close button */}
        <div className="flex justify-between items-center px-5 pb-2">
          <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
            {t.nav.more}
          </span>
          <button
            onClick={() => setMoreMenuOpen(false)}
            className="p-2 rounded-full hover:bg-[var(--sand)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={{ color: 'var(--muted)' }}
            aria-label={t.common.close}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Menu items */}
        <div className="px-4 pb-6 space-y-1">
          {/* Recipes */}
          <TransitionLink
            href={secondaryNav[0].href}
            onClick={() => setMoreMenuOpen(false)}
            className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 touch-feedback focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={{
              background: pathname === secondaryNav[0].href ? 'var(--accent)' : 'transparent',
              color: pathname === secondaryNav[0].href ? 'white' : 'var(--foreground)',
            }}
            aria-current={pathname === secondaryNav[0].href ? 'page' : undefined}
          >
            <BookIcon />
            <span className="text-base font-medium">{secondaryNav[0].name}</span>
          </TransitionLink>

          {/* Home Control (before Settings) */}
          {hasHomeControl && (
            <TransitionLink
              href={getDemoHref('/styring')}
              onClick={() => setMoreMenuOpen(false)}
              className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 touch-feedback focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              style={{
                background: pathname === '/styring' ? 'var(--accent)' : 'transparent',
                color: pathname === '/styring' ? 'white' : 'var(--foreground)',
              }}
              aria-current={pathname === '/styring' ? 'page' : undefined}
            >
              <HomeControlIcon />
              <span className="text-base font-medium">{t.nav.homeControl}</span>
            </TransitionLink>
          )}

          {/* Settings */}
          <TransitionLink
            href={secondaryNav[1].href}
            onClick={() => setMoreMenuOpen(false)}
            className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 touch-feedback focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={{
              background: pathname === secondaryNav[1].href ? 'var(--accent)' : 'transparent',
              color: pathname === secondaryNav[1].href ? 'white' : 'var(--foreground)',
            }}
            aria-current={pathname === secondaryNav[1].href ? 'page' : undefined}
          >
            <SettingsIcon />
            <span className="text-base font-medium">{secondaryNav[1].name}</span>
          </TransitionLink>

          {/* Admin link (only for admins) */}
          {isAdmin && (
            <TransitionLink
              href="/admin"
              onClick={() => setMoreMenuOpen(false)}
              className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 touch-feedback focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              style={{
                background: pathname === '/admin' ? 'var(--accent)' : 'transparent',
                color: pathname === '/admin' ? 'white' : 'var(--foreground)',
              }}
              aria-current={pathname === '/admin' ? 'page' : undefined}
            >
              <ShieldIcon />
              <span className="text-base font-medium">{t.nav.admin}</span>
            </TransitionLink>
          )}

          {/* Logout button */}
          {user && (
            <button
              onClick={(e) => {
                setMoreMenuOpen(false)
                handleLogout(e)
              }}
              className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 w-full text-left hover:bg-[var(--sand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              style={{ color: 'var(--muted)' }}
            >
              <LogoutIcon />
              <span className="text-base font-medium">{t.nav.logout}</span>
            </button>
          )}
        </div>
      </div>
    </>
  )
}
