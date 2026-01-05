'use client'

import { SettingsPageSkeleton } from '@/components/Skeleton'
import { SmartLoading } from '@/components/SmartLoading'
import { SettingsPageContent } from '@/components/settings/SettingsPageContent'
import type { CachedSettingsData } from '@/components/settings/SettingsDataCache'

/**
 * Settings page loading state
 *
 * Uses SmartLoading to show cached data instead of skeleton during navigation.
 * Falls back to skeleton only when no cache is available.
 */
export default function SettingsLoading() {
  return (
    <SmartLoading page="settings" skeleton={<SettingsPageSkeleton />}>
      {(rawData) => {
        const data = rawData as CachedSettingsData
        // Find first member as "myProfile" for cached view
        const myProfile = data.members[0] || null

        return (
          <SettingsPageContent
            initialData={{
              household: data.household,
              members: data.members,
              children: data.children,
              myProfile,
              connectedCalendarEmail: data.connectedCalendarEmail,
              user: null, // User not available from cache
            }}
            isDemo={false}
          />
        )
      }}
    </SmartLoading>
  )
}
