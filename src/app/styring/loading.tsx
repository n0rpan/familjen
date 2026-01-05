'use client'

import { StyringPageSkeleton } from '@/components/Skeleton'
import { SmartLoading } from '@/components/SmartLoading'
import { StyringPageContent } from '@/components/styring/StyringPageContent'
import type { CachedStyringData } from '@/components/styring/StyringDataCache'

/**
 * Styring (home control) page loading state
 *
 * Uses SmartLoading to show cached data instead of skeleton during navigation.
 * Falls back to skeleton only when no cache is available.
 */
export default function StyringLoading() {
  return (
    <SmartLoading page="styring" skeleton={<StyringPageSkeleton />}>
      {(rawData) => {
        const data = rawData as CachedStyringData
        return (
          <StyringPageContent
            initialData={data}
            isDemo={false}
          />
        )
      }}
    </SmartLoading>
  )
}
