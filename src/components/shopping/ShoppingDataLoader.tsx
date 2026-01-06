/**
 * ShoppingDataLoader - Server Component
 *
 * Fetches all shopping page data on the server and passes to ShoppingPageWrapper.
 * Works for both production (Supabase) and demo mode (generated data).
 */

import { fetchShoppingPageData, getDemoShoppingPageData } from '@/lib/data/server'
import { ShoppingPageWrapper } from './ShoppingPageWrapper'
import { ShoppingDataCacher } from './ShoppingDataCache'

interface ShoppingDataLoaderProps {
  householdId: string
  isDemo: boolean
}

export async function ShoppingDataLoader({ householdId, isDemo }: ShoppingDataLoaderProps) {
  const data = isDemo
    ? getDemoShoppingPageData()
    : await fetchShoppingPageData(householdId)

  return (
    <>
      <ShoppingPageWrapper
        initialData={data}
        isDemo={isDemo}
      />
      {/* Cache data for instant loads on repeat visits */}
      {!isDemo && <ShoppingDataCacher householdId={householdId} data={data} />}
    </>
  )
}
