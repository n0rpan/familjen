'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { User } from '@supabase/supabase-js'
import { useTranslation } from '@/lib/i18n/context'
import { TransitionLink } from './TransitionLink'

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

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
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

export function Header() {
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const supabase = useMemo(() => createClient(), [])
  const t = useTranslation()

  // All navigation items for desktop
  const navigation = [
    { name: t.nav.home, href: '/', icon: HomeIcon },
    { name: t.nav.weekPlan, href: '/uke', icon: CalendarIcon },
    { name: t.nav.recipes, href: '/oppskrifter', icon: BookIcon },
    { name: t.nav.rememberList, href: '/huskeliste', icon: BellIcon },
    { name: t.nav.shoppingList, href: '/handleliste', icon: ShoppingIcon },
    { name: t.nav.settings, href: '/innstillinger', icon: SettingsIcon },
  ]

  // Primary mobile nav items (shown in bottom bar)
  const primaryMobileNav = [
    { name: t.nav.home, href: '/', icon: HomeIcon },
    { name: t.nav.weekPlan, href: '/uke', icon: CalendarIcon },
    { name: t.nav.rememberList, href: '/huskeliste', icon: BellIcon },
    { name: t.nav.shoppingList, href: '/handleliste', icon: ShoppingIcon },
  ]

  // Secondary mobile nav items (shown in "More" menu)
  const secondaryMobileNav = [
    { name: t.nav.recipes, href: '/oppskrifter', icon: BookIcon },
    { name: t.nav.settings, href: '/innstillinger', icon: SettingsIcon },
  ]

  // Check if current page is a secondary nav item (not in primary nav)
  const isSecondaryActive = secondaryMobileNav.some(item => pathname === item.href) || pathname === '/admin'

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)

      // Check admin status from JWT app_metadata (set during login by syncUserAdminStatus)
      // This avoids RLS-related issues with querying allowed_emails
      setIsAdmin(user?.app_metadata?.is_admin === true)
    }
    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      // Check admin status from JWT app_metadata
      setIsAdmin(session?.user?.app_metadata?.is_admin === true)
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

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
          borderBottom: '1px solid var(--border)'
        }}
      >
        <div className="max-w-6xl mx-auto px-6 w-full">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <img
                src="/icons/icon.svg"
                alt="Familjen"
                width={36}
                height={36}
                className="rounded-xl transition-transform group-hover:scale-105"
              />
              <span className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
                Familjen
              </span>
            </Link>

            {/* Navigation */}
            <nav className="flex items-center gap-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href
                return (
                  <TransitionLink
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200"
                    style={{
                      background: isActive ? 'var(--accent)' : 'transparent',
                      color: isActive ? 'white' : 'var(--muted)',
                    }}
                  >
                    <item.icon />
                    <span>{item.name}</span>
                  </TransitionLink>
                )
              })}
            </nav>

            {/* User menu */}
            <div className="flex items-center gap-3">
              {isAdmin && (
                <Link
                  href="/admin"
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 hover:bg-[var(--sand)]"
                  style={{ color: 'var(--muted)' }}
                >
                  <ShieldIcon />
                  {t.nav.admin}
                </Link>
              )}
              {user && (
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 hover:bg-[var(--sand)]"
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
        className="lg:hidden w-full sticky top-0 z-40"
        style={{
          background: 'var(--background)',
          borderBottom: '1px solid var(--border)',
          paddingTop: 'env(safe-area-inset-top, 0px)'
        }}
      >
        <div className="flex justify-center items-center h-14 px-4">
          <Link href="/" className="flex items-center gap-2 group">
            <img
              src="/icons/icon.svg"
              alt="Familjen"
              width={32}
              height={32}
              className="rounded-xl transition-transform group-hover:scale-105"
            />
            <span className="text-lg font-semibold font-display" style={{ color: 'var(--foreground)' }}>
              Familjen
            </span>
          </Link>
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 backdrop-blur-md safe-area-pb"
        style={{
          background: 'var(--nav-bg)',
          borderTop: '1px solid var(--border)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}
      >
        <div className="flex justify-around items-center h-16 px-2">
          {primaryMobileNav.map((item) => {
            const isActive = pathname === item.href
            return (
              <TransitionLink
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-all duration-200 touch-feedback"
                style={{
                  color: isActive ? 'var(--accent)' : 'var(--muted)',
                }}
              >
                <item.icon />
                <span className="text-xs font-medium">{item.name}</span>
              </TransitionLink>
            )
          })}
          {/* More button */}
          <button
            onClick={() => setMoreMenuOpen(true)}
            className="flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-all duration-200 touch-feedback"
            style={{
              color: isSecondaryActive ? 'var(--accent)' : 'var(--muted)',
            }}
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
            className="p-2 rounded-full hover:bg-[var(--sand)] transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Menu items */}
        <div className="px-4 pb-6 space-y-1">
          {secondaryMobileNav.map((item) => {
            const isActive = pathname === item.href
            return (
              <TransitionLink
                key={item.href}
                href={item.href}
                onClick={() => setMoreMenuOpen(false)}
                className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 touch-feedback"
                style={{
                  background: isActive ? 'var(--accent)' : 'transparent',
                  color: isActive ? 'white' : 'var(--foreground)',
                }}
              >
                <item.icon />
                <span className="text-base font-medium">{item.name}</span>
              </TransitionLink>
            )
          })}

          {/* Admin link (only for admins) */}
          {isAdmin && (
            <TransitionLink
              href="/admin"
              onClick={() => setMoreMenuOpen(false)}
              className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 touch-feedback"
              style={{
                background: pathname === '/admin' ? 'var(--accent)' : 'transparent',
                color: pathname === '/admin' ? 'white' : 'var(--foreground)',
              }}
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
              className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 w-full text-left hover:bg-[var(--sand)]"
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
