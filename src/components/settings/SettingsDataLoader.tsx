/**
 * SettingsDataLoader - Server Component
 *
 * Fetches all settings page data on the server and passes to SettingsPageContent.
 * Works for both production (Supabase) and demo mode (generated data).
 *
 * This is the key component for PPR - it runs on the server and streams
 * the rendered content to the client.
 */

import { fetchSettingsPageData, getDemoSettingsPageData, getCurrentUser } from '@/lib/data/server'
import { SettingsPageContent } from './SettingsPageContent'
import { SettingsDataCacher } from './SettingsDataCache'

interface SettingsDataLoaderProps {
  householdId: string
  isDemo: boolean
}

export async function SettingsDataLoader({ householdId, isDemo }: SettingsDataLoaderProps) {
  // Fetch data - same structure for demo and production
  const data = isDemo
    ? getDemoSettingsPageData()
    : await fetchSettingsPageData(householdId)

  // Get current user for production mode (needed for profile identification)
  const user = isDemo ? null : await getCurrentUser()

  // Find the current user's profile
  const myProfile = user
    ? data.members.find(m => m.user_id === user.id) || null
    : data.members[0] || null // Demo: first member is "logged in"

  return (
    <>
      <SettingsPageContent
        initialData={{
          household: data.household,
          members: data.members,
          children: data.children,
          myProfile,
          connectedCalendarEmail: data.connectedCalendarEmail,
          user,
        }}
        isDemo={isDemo}
      />
      {/* Cache data for instant loads on repeat visits */}
      {!isDemo && <SettingsDataCacher householdId={householdId} data={data} />}
    </>
  )
}
