'use client'

import { FeedPageSkeleton } from '@/components/Skeleton'
import { SmartLoading } from '@/components/SmartLoading'
import { FeedPageContent } from '@/components/feed/FeedPageContent'
import type { CachedFeedData } from '@/components/feed/FeedDataCache'

/**
 * Feed page loading state
 *
 * Uses SmartLoading to show cached data instead of skeleton during navigation.
 * Falls back to skeleton only when no cache is available.
 */
export default function FeedLoading() {
  return (
    <SmartLoading page="feed" skeleton={<FeedPageSkeleton />}>
      {(rawData) => {
        const data = rawData as CachedFeedData
        return (
          <FeedPageContent
            messages={data.messages as never[]}
            photos={data.photos as never[]}
            reminders={[]}
            notifications={data.notifications as never[]}
            integrationChildren={data.integrationChildren as never[]}
            integrationStatuses={data.integrations.map(i => ({
              id: i.id,
              service: i.service as 'spond' | 'kidplan' | 'iskole' | 'mykid',
              displayName: i.display_name,
              lastSyncStatus: i.last_sync_status,
              lastSyncError: i.last_sync_error,
              lastSyncAt: i.last_sync_at,
            }))}
            duplicateSuggestions={data.duplicateSuggestions as never[]}
            mergedDuplicates={data.mergedDuplicates as never[]}
            isDemo={false}
          />
        )
      }}
    </SmartLoading>
  )
}
