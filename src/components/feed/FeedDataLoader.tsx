/**
 * FeedDataLoader - Server Component
 *
 * Fetches all feed page data on the server and passes to FeedPageWrapper.
 * Works for both production (Supabase) and demo mode (generated data).
 *
 * This is the key component for PPR - it runs on the server and streams
 * the rendered content to the client.
 */

import { fetchFeedPageData, getDemoFeedPageData } from '@/lib/data/server'
import { FeedPageWrapper } from './FeedPageWrapper'
import { FeedDataCacher } from './FeedDataCache'

interface FeedDataLoaderProps {
  householdId: string
  isDemo: boolean
  serviceFilter?: string
  typeFilter?: string
}

export async function FeedDataLoader({
  householdId,
  isDemo,
  serviceFilter,
  typeFilter,
}: FeedDataLoaderProps) {
  // Fetch data - same structure for demo and production
  const data = isDemo
    ? getDemoFeedPageData()
    : await fetchFeedPageData(householdId)

  return (
    <>
      <FeedPageWrapper
        initialData={data}
        householdId={householdId}
        isDemo={isDemo}
        serviceFilter={serviceFilter}
        typeFilter={typeFilter}
      />
      {/* Cache data for instant loads on repeat visits */}
      {!isDemo && <FeedDataCacher householdId={householdId} data={data} />}
    </>
  )
}
