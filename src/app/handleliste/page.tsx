import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { ShoppingDataLoader } from '@/components/shopping/ShoppingDataLoader'
import { ShoppingCacheFallback } from '@/components/shopping/ShoppingDataCache'
import { ShoppingPageSkeleton } from '@/components/Skeleton'
import { getHouseholdIdFromSession } from '@/lib/data/server'

interface PageProps {
  searchParams: Promise<{ demo?: string }>
}

/**
 * Shopping List Page - PPR Pattern
 *
 * Server component that wraps ShoppingDataLoader in Suspense for instant shell rendering.
 * Data is fetched on the server, passed to client for hydration.
 */
export default async function ShoppingListPage({ searchParams }: PageProps) {
  const params = await searchParams
  const isDemo = params.demo === 'true'

  // Get household ID from session (or use 'demo' for demo mode)
  const householdId = isDemo ? 'demo' : await getHouseholdIdFromSession()

  if (!householdId && !isDemo) {
    redirect('/login')
  }

  // Use cache fallback for production, skeleton for demo
  const effectiveHouseholdId = householdId || 'demo'

  return (
    <div className="page-container">
      <Suspense fallback={isDemo ? <ShoppingPageSkeleton /> : <ShoppingCacheFallback householdId={effectiveHouseholdId} />}>
        <ShoppingDataLoader
          householdId={effectiveHouseholdId}
          isDemo={isDemo}
        />
      </Suspense>
    </div>
  )
}
