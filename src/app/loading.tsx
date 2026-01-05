'use client'

import { HomePageSkeleton } from '@/components/Skeleton'
import { SmartLoading } from '@/components/SmartLoading'
import { HomePageContent } from '@/components/home/HomePageContent'
import { computeHomePropsFromCache, type CachedHomeData } from '@/components/home/HomeDataCache'

/**
 * Home page loading state
 *
 * Uses SmartLoading to show cached data instead of skeleton during navigation.
 * Falls back to skeleton only when no cache is available.
 */
export default function HomeLoading() {
  return (
    <SmartLoading page="home" skeleton={<HomePageSkeleton />}>
      {(rawData) => {
        const data = rawData as CachedHomeData
        const props = computeHomePropsFromCache(data, data.household?.id || '')
        return <HomePageContent {...props} />
      }}
    </SmartLoading>
  )
}
