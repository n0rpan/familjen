'use client'

/**
 * Demo Wrapper
 *
 * Wraps the app with DemoDataProvider and shows DemoBanner when in demo mode.
 * Must be used within a Suspense boundary since it uses useSearchParams.
 */

import { DemoDataProvider } from '@/lib/demo/context'
import { DemoBanner } from './DemoBanner'
import type { ReactNode } from 'react'

interface DemoWrapperProps {
  children: ReactNode
}

export function DemoWrapper({ children }: DemoWrapperProps) {
  return (
    <DemoDataProvider>
      <DemoBanner />
      {children}
    </DemoDataProvider>
  )
}
