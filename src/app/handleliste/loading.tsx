'use client'

import { ShoppingPageSkeleton } from '@/components/Skeleton'
import { SmartLoading } from '@/components/SmartLoading'
import { ShoppingPageContent } from '@/components/shopping/ShoppingPageContent'
import type { CachedShoppingData } from '@/components/shopping/ShoppingDataCache'

/**
 * Shopping page loading state
 *
 * Uses SmartLoading to show cached data instead of skeleton during navigation.
 * Falls back to skeleton only when no cache is available.
 */
export default function ShoppingLoading() {
  return (
    <SmartLoading page="shopping" skeleton={<ShoppingPageSkeleton />}>
      {(rawData) => {
        const data = rawData as CachedShoppingData
        return (
          <ShoppingPageContent
            initialData={data}
            isDemo={false}
          />
        )
      }}
    </SmartLoading>
  )
}
