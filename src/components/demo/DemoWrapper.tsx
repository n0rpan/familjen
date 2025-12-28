'use client'

/**
 * Demo Wrapper
 *
 * Wraps the app with DemoDataProvider for demo mode support.
 * Must be used within a Suspense boundary since it uses useSearchParams.
 */

import { DemoDataProvider } from '@/lib/demo/context'
import type { ReactNode } from 'react'

interface DemoWrapperProps {
  children: ReactNode
}

export function DemoWrapper({ children }: DemoWrapperProps) {
  return <DemoDataProvider>{children}</DemoDataProvider>
}
