'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import { useNavigation } from '@/lib/navigation'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/lib/i18n/context'

interface PageContentProps {
  children: ReactNode
}

/**
 * PageContent wraps the main content area. The TransitionLink adds
 * `.navigating` class directly to DOM for instant feedback, and this
 * component removes it when navigation completes.
 *
 * A11y features:
 * - Sets aria-busy during navigation for screen readers
 * - Manages focus after route changes for keyboard/AT users
 */
export function PageContent({ children }: PageContentProps) {
  const { isNavigating } = useNavigation()
  const { t } = useLanguage()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const previousPathRef = useRef(pathname)
  const announcementRef = useRef<HTMLDivElement | null>(null)
  const announcementTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  // Handle navigation state changes
  useEffect(() => {
    if (!wrapperRef.current) return

    if (isNavigating) {
      // Add navigating state for CSS and aria-busy for AT
      wrapperRef.current.setAttribute('aria-busy', 'true')
    } else {
      // Remove navigating state
      wrapperRef.current.classList.remove('navigating')
      wrapperRef.current.setAttribute('aria-busy', 'false')
    }
  }, [isNavigating])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (announcementTimeoutRef.current) {
        clearTimeout(announcementTimeoutRef.current)
      }
      if (announcementRef.current) {
        announcementRef.current.remove()
      }
    }
  }, [])

  // Focus management after route changes
  useEffect(() => {
    // Skip on initial mount
    if (previousPathRef.current === pathname) return
    previousPathRef.current = pathname

    // Clean up any pending announcement
    if (announcementTimeoutRef.current) {
      clearTimeout(announcementTimeoutRef.current)
    }
    if (announcementRef.current) {
      announcementRef.current.remove()
      announcementRef.current = null
    }

    // After navigation, move focus to main content for keyboard/AT users
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      // Guard against unmount during RAF delay
      if (!isMountedRef.current) return
      const wrapper = wrapperRef.current
      if (!wrapper) return

      // Make wrapper focusable if not already, then focus it
      if (!wrapper.hasAttribute('tabindex')) {
        wrapper.setAttribute('tabindex', '-1')
      }
      wrapper.focus({ preventScroll: true })

      // Announce route change to screen readers
      const heading = wrapper.querySelector('h1')
      if (heading) {
        // Create a live region announcement
        const announcement = document.createElement('div')
        announcement.setAttribute('role', 'status')
        announcement.setAttribute('aria-live', 'polite')
        announcement.setAttribute('aria-atomic', 'true')
        announcement.className = 'sr-only'
        announcement.textContent = `${t.common.navigatedTo} ${heading.textContent}`
        document.body.appendChild(announcement)
        announcementRef.current = announcement

        // Remove after announcement
        announcementTimeoutRef.current = setTimeout(() => {
          announcement.remove()
          announcementRef.current = null
          announcementTimeoutRef.current = null
        }, 1000)
      }
    })
  }, [pathname, t.common.navigatedTo])

  return (
    <div
      ref={wrapperRef}
      className="page-content-wrapper"
      aria-busy="false"
    >
      {children}
    </div>
  )
}
