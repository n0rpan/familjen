/**
 * ShoppingDataLoader - Server Component
 *
 * Fetches all shopping page data on the server and passes to ShoppingPageWrapper.
 * Works for both production (Supabase) and demo mode (generated data).
 */

import { fetchShoppingPageData, getDemoShoppingPageData } from '@/lib/data/server'
import { ShoppingPageWrapper } from './ShoppingPageWrapper'

interface ShoppingDataLoaderProps {
  householdId: string
  isDemo: boolean
}

export async function ShoppingDataLoader({ householdId, isDemo }: ShoppingDataLoaderProps) {
  const data = isDemo
    ? getDemoShoppingPageData()
    : await fetchShoppingPageData(householdId)

  return (
    <ShoppingPageWrapper
      initialData={data}
      householdId={householdId}
      isDemo={isDemo}
    />
  )
}
