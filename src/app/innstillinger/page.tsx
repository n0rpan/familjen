/**
 * Settings Page - Server Component with PPR
 *
 * AUTH: This route is protected by src/proxy.ts (Next.js 16 middleware).
 * See PROTECTED_PATHS in src/lib/supabase/middleware.ts.
 * Unauthenticated users are redirected to /login at the middleware level.
 *
 * Uses PPR pattern for instant navigation:
 * - Server component fetches data with unstable_cache
 * - Suspense shows skeleton while streaming
 * - SettingsDataLoader passes data to SettingsPageContent
 */

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { SettingsDataLoader } from '@/components/settings/SettingsDataLoader'
import { SettingsCacheFallback } from '@/components/settings/SettingsDataCache'
import { SettingsPageSkeleton } from '@/components/Skeleton'
import { getHouseholdIdFromSession } from '@/lib/data/server'

interface PageProps {
  searchParams: Promise<{ demo?: string }>
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const isDemo = params.demo === 'true'

  // Get household ID from session
  const householdId = isDemo ? 'demo' : await getHouseholdIdFromSession()

  // Redirect if not authenticated and not demo mode
  if (!householdId && !isDemo) {
    redirect('/login')
  }

  // Use cache fallback for production, skeleton for demo
  const effectiveHouseholdId = householdId || 'demo'

  return (
    <div className="page-container">
      <Suspense fallback={isDemo ? <SettingsPageSkeleton /> : <SettingsCacheFallback householdId={effectiveHouseholdId} />}>
        <SettingsDataLoader
          householdId={effectiveHouseholdId}
          isDemo={isDemo}
        />
      </Suspense>
    </div>
  )
}
