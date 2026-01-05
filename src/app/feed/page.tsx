/**
 * Feed Page - Server Component with PPR
 *
 * AUTH: This route is protected by src/proxy.ts (Next.js 16 middleware).
 * See PROTECTED_PATHS in src/lib/supabase/middleware.ts - includes '/feed'.
 * Unauthenticated users are redirected to /login at the middleware level.
 *
 * Uses PPR pattern for instant navigation:
 * - Server component fetches data with unstable_cache
 * - Suspense shows skeleton while streaming
 * - FeedDataLoader passes data to FeedPageWrapper
 */

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { FeedDataLoader } from '@/components/feed/FeedDataLoader'
import { FeedCacheFallback } from '@/components/feed/FeedDataCache'
import { FeedPageSkeleton } from '@/components/Skeleton'
import { getHouseholdIdFromSession } from '@/lib/data/server'

interface PageProps {
  searchParams: Promise<{
    demo?: string
    service?: string
    type?: string
  }>
}

export default async function FeedPage({ searchParams }: PageProps) {
  const params = await searchParams
  const isDemo = params.demo === 'true'
  const serviceFilter = params.service?.toLowerCase()
  const typeFilter = params.type?.toLowerCase()

  // Get household ID from session
  const householdId = isDemo ? 'demo' : await getHouseholdIdFromSession()

  // Redirect if not authenticated and not demo mode
  if (!householdId && !isDemo) {
    redirect('/login')
  }

  // Use cache fallback for production, skeleton for demo
  const effectiveHouseholdId = householdId || 'demo'

  return (
    <Suspense fallback={isDemo ? <FeedPageSkeleton /> : <FeedCacheFallback householdId={effectiveHouseholdId} />}>
      <FeedDataLoader
        householdId={effectiveHouseholdId}
        isDemo={isDemo}
        serviceFilter={serviceFilter}
        typeFilter={typeFilter}
      />
    </Suspense>
  )
}
