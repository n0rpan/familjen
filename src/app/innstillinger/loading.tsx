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
 *
 * Design decisions:
 * - `user: null`: The Supabase User object is not cached because it contains
 *   sensitive session data and is always available from the server. Settings
 *   that need user.email fall back gracefully until server data arrives.
 * - `myProfile`: We use the first member as a fallback for the current user's
 *   profile. The server will provide the correct profile shortly.
 */
export default function SettingsLoading() {
  return (
    <SmartLoading page="settings" skeleton={<SettingsPageSkeleton />}>
      {(rawData) => {
        const data = rawData as CachedSettingsData
        // Use first member as fallback for current user's profile
        // Server data will replace this with the correct profile
        const myProfile = data.members[0] || null

        return (
          <SettingsPageContent
            initialData={{
              household: data.household,
              members: data.members,
              children: data.children,
              myProfile,
              connectedCalendarEmail: data.connectedCalendarEmail,
              // User object not cached - contains sensitive session data
              // Server provides this; features requiring user.email are disabled until then
              user: null,
            }}
            isDemo={false}
          />
        )
      }}
    </SmartLoading>
  )
}
