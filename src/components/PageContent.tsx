'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import { useNavigation } from '@/lib/navigation'

interface PageContentProps {
  children: ReactNode
}

/**
 * PageContent wraps the main content area. The TransitionLink adds
 * `.navigating` class directly to DOM for instant feedback, and this
 * component removes it when navigation completes.
 */
export function PageContent({ children }: PageContentProps) {
  const { isNavigating } = useNavigation()
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Remove .navigating class when navigation ends
  useEffect(() => {
    if (!isNavigating && wrapperRef.current) {
      wrapperRef.current.classList.remove('navigating')
    }
  }, [isNavigating])

  return (
    <div ref={wrapperRef} className="page-content-wrapper">
      {children}
    </div>
  )
}
