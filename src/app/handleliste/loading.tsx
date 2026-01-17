'use client'

import { ShoppingPageSkeleton } from '@/components/Skeleton'
import { SmartLoading } from '@/components/SmartLoading'
import { ShoppingPageContent } from '@/components/shopping/ShoppingPageContent'
import { transformCachedData, type CachedShoppingData } from '@/components/shopping/ShoppingDataCache'

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
        // Transform cached data to combine lists with their items
        const transformedData = transformCachedData(data)
        return (
          <ShoppingPageContent
            initialData={transformedData}
            isDemo={false}
          />
        )
      }}
    </SmartLoading>
  )
}
