/**
 * StyringDataLoader - Server Component
 *
 * Loads the home control page. For styring, most data is fetched
 * by the individual panels (HomeControlPanel, ToshibaACPanel, MelCloudACPanel).
 * This loader primarily enables the PPR pattern for instant shell rendering.
 *
 * In demo mode, shows a "view only" message since home control requires
 * real smart home devices to be connected.
 */

import { fetchStyringPageData, getDemoStyringPageData } from '@/lib/data/server'
import { StyringPageContent } from './StyringPageContent'
import { StyringDataCacher } from './StyringDataCache'

interface StyringDataLoaderProps {
  householdId: string
  isDemo: boolean
}

export async function StyringDataLoader({ householdId, isDemo }: StyringDataLoaderProps) {
  // Fetch initial data for PPR
  const data = isDemo
    ? getDemoStyringPageData()
    : await fetchStyringPageData(householdId)

  return (
    <>
      <StyringPageContent initialData={data} isDemo={isDemo} />
      {/* Cache data for instant loads on repeat visits */}
      {!isDemo && <StyringDataCacher householdId={householdId} data={data} />}
    </>
  )
}
