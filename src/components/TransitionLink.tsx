'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState, type ComponentProps, type MouseEvent } from 'react'

type TransitionLinkProps = ComponentProps<typeof Link> & {
  viewTransition?: boolean
}

// Check if View Transitions API is supported
const supportsViewTransitions = typeof document !== 'undefined' && 'startViewTransition' in document

export function TransitionLink({
  href,
  children,
  viewTransition = true,
  onClick,
  onMouseEnter,
  ...props
}: TransitionLinkProps) {
  const router = useRouter()
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

      // If default was prevented or view transitions not supported, skip
      if (e.defaultPrevented || !viewTransition || !supportsViewTransitions) {
        return
      }

      // Only handle internal navigation
      if (typeof href !== 'string' || href.startsWith('http')) {
        return
      }

      e.preventDefault()

      // Start view transition
      const transition = (document as Document & { startViewTransition?: (callback: () => void) => void }).startViewTransition?.(() => {
        router.push(href)
      })

      // Optional: wait for transition to complete
      transition?.finished?.catch(() => {
        // View transition was skipped, navigation still happened
      })
    },
    [router, href, viewTransition, onClick]
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
