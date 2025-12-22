'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState, type ComponentProps, type MouseEvent } from 'react'
import { useNavigationOptional } from '@/lib/navigation'

type TransitionLinkProps = ComponentProps<typeof Link> & {
  viewTransition?: boolean
}

// Check if View Transitions API is supported
const supportsViewTransitions = typeof document !== 'undefined' && 'startViewTransition' in document

// Navigation history helpers
const NAV_STACK_KEY = 'familjen-nav-stack'
const MAX_STACK_SIZE = 20

function getNavStack(): string[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    return JSON.parse(sessionStorage.getItem(NAV_STACK_KEY) || '[]')
  } catch {
    return []
  }
}

function pushToNavStack(path: string): void {
  if (typeof sessionStorage === 'undefined') return
  const stack = getNavStack()
  // Remove if already exists (we're revisiting)
  const existingIndex = stack.lastIndexOf(path)
  if (existingIndex !== -1) {
    stack.splice(existingIndex)
  }
  stack.push(path)
  // Keep stack bounded
  while (stack.length > MAX_STACK_SIZE) {
    stack.shift()
  }
  sessionStorage.setItem(NAV_STACK_KEY, JSON.stringify(stack))
}

function isBackNavigation(targetPath: string): boolean {
  const stack = getNavStack()
  if (stack.length < 2) return false
  // If the target is the previous page in our stack, it's a back navigation
  const currentIndex = stack.length - 1
  const targetIndex = stack.lastIndexOf(targetPath)
  return targetIndex !== -1 && targetIndex < currentIndex
}

function setTransitionDirection(direction: 'forward' | 'back'): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.transitionDirection = direction
  }
}

function clearTransitionDirection(): void {
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset.transitionDirection
  }
}

export function TransitionLink({
  href,
  children,
  viewTransition = true,
  onClick,
  onMouseEnter,
  ...props
}: TransitionLinkProps) {
  const router = useRouter()
  const navigation = useNavigationOptional()
  const [prefetched, setPrefetched] = useState(false)

  // Prefetch on hover for faster navigation
  const handleMouseEnter = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      if (!prefetched && typeof href === 'string') {
        router.prefetch(href)
        setPrefetched(true)
      }
      onMouseEnter?.(e)
    },
    [router, href, prefetched, onMouseEnter]
  )

  // Handle click with view transition
  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      // Let the default onClick run first
      onClick?.(e)

      // If default was prevented, skip
      if (e.defaultPrevented) {
        return
      }

      // Only handle internal navigation
      if (typeof href !== 'string' || href.startsWith('http')) {
        return
      }

      e.preventDefault()

      // Determine navigation direction
      const targetPath = href.split('?')[0] // Normalize path without query
      const isBack = isBackNavigation(targetPath)
      setTransitionDirection(isBack ? 'back' : 'forward')

      // INSTANT FEEDBACK: Add class directly to DOM (no React state delay)
      // This gives immediate visual response before any async work
      const pageContent = document.querySelector('.page-content-wrapper')
      if (pageContent) {
        pageContent.classList.add('navigating')
      }

      // Signal navigation for any React-based tracking
      navigation?.startNavigation(targetPath)

      // Navigation function
      const navigate = () => {
        router.push(href)
        pushToNavStack(targetPath)
      }

      // If view transitions not supported, navigate directly
      if (!viewTransition || !supportsViewTransitions) {
        navigate()
        clearTransitionDirection()
        return
      }

      // Start view transition immediately (instant feedback already applied via class)
      try {
        const transition = (document as Document & { startViewTransition?: (callback: () => void) => { finished: Promise<void> } }).startViewTransition?.(navigate)

        if (!transition) {
          navigate()
          clearTransitionDirection()
          return
        }

        transition.finished
          .then(() => {
            clearTransitionDirection()
          })
          .catch(() => {
            clearTransitionDirection()
          })
      } catch {
        navigate()
        clearTransitionDirection()
      }
    },
    [router, href, viewTransition, onClick, navigation]
  )

  return (
    <Link
      href={href}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      {...props}
    >
      {children}
    </Link>
  )
}

// Export for use in AppShell popstate handler
export { setTransitionDirection, clearTransitionDirection }
