'use client'

/**
 * ShoppingPageWrapper - Client Component
 *
 * Simple wrapper that passes initial data from server to ShoppingPageContent.
 * The existing ShoppingPageContent handles all the complex state management.
 */

import { ShoppingPageContent } from './ShoppingPageContent'
import type { ShoppingPageData } from '@/lib/data/server'

interface ShoppingPageWrapperProps {
  initialData: ShoppingPageData
  isDemo: boolean
}

export function ShoppingPageWrapper({ initialData, isDemo }: ShoppingPageWrapperProps) {
  // For now, simply render ShoppingPageContent
  // The component already handles its own data fetching with caching
  // This wrapper enables the PPR pattern - server fetches data, client hydrates
  return <ShoppingPageContent initialData={initialData} isDemo={isDemo} />
}
