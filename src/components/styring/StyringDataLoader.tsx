/**
 * StyringDataLoader - Server Component
 *
 * Loads the home control page. For styring, most data is fetched
 * by the individual panels (HomeControlPanel, ToshibaACPanel, MelCloudACPanel).
 * This loader primarily enables the PPR pattern for instant shell rendering.
 */

import { StyringPageContent } from './StyringPageContent'

interface StyringDataLoaderProps {
  householdId: string
  isDemo: boolean
}

export async function StyringDataLoader({ isDemo }: StyringDataLoaderProps) {
  // The child components handle their own data fetching
  // This loader enables the PPR shell pattern
  return <StyringPageContent isDemo={isDemo} />
}
