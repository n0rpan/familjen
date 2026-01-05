import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { StyringDataLoader } from '@/components/styring/StyringDataLoader'
import { StyringPageSkeleton } from '@/components/Skeleton'
import { getHouseholdIdFromSession } from '@/lib/data/server'

interface PageProps {
  searchParams: Promise<{ demo?: string }>
}

/**
 * Styring (Home Control) Page - PPR Pattern
 *
 * Server component that wraps StyringDataLoader in Suspense for instant shell rendering.
 * Individual control panels (Somfy, Toshiba, MelCloud) handle their own data fetching.
 */
export default async function StyringPage({ searchParams }: PageProps) {
  const params = await searchParams
  const isDemo = params.demo === 'true'

  // Get household ID from session (or use 'demo' for demo mode)
  const householdId = isDemo ? 'demo' : await getHouseholdIdFromSession()

  if (!householdId && !isDemo) {
    redirect('/login')
  }

  return (
    <div className="page-container">
      <Suspense fallback={<StyringPageSkeleton />}>
        <StyringDataLoader
          householdId={householdId || 'demo'}
          isDemo={isDemo}
        />
      </Suspense>
    </div>
  )
}
