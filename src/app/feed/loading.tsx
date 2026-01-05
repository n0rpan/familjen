'use client'

import { FeedPageSkeleton } from '@/components/Skeleton'
import { SmartLoading } from '@/components/SmartLoading'
import { FeedPageContent } from '@/components/feed/FeedPageContent'
import { computeFeedPropsFromCache, type CachedFeedData } from '@/components/feed/FeedDataCache'

/**
 * Feed page loading state
 *
 * Uses SmartLoading to show cached data instead of skeleton during navigation.
 * Falls back to skeleton only when no cache is available.
 *
 * The computeFeedPropsFromCache helper transforms cached data to FeedPageContentProps,
 * handling the integration status format conversion consistently.
 */
export default function FeedLoading() {
  return (
    <SmartLoading page="feed" skeleton={<FeedPageSkeleton />}>
      {(rawData) => {
        const data = rawData as CachedFeedData
        const props = computeFeedPropsFromCache(data)
        return <FeedPageContent {...props} />
      }}
    </SmartLoading>
  )
}
