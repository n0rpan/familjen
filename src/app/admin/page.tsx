import { Suspense } from 'react'
import { AdminDataLoader } from '@/components/admin/AdminDataLoader'
import { AdminPageSkeleton } from '@/components/Skeleton'

/**
 * Admin Page - PPR Pattern
 *
 * Server component that wraps AdminDataLoader in Suspense for instant shell rendering.
 * Admin page does NOT support demo mode - requires real authentication.
 * Authentication and admin verification is done in AdminDataLoader.
 */
export default async function AdminPage() {
  return (
    <div className="page-container">
      <Suspense fallback={<AdminPageSkeleton />}>
        <AdminDataLoader />
      </Suspense>
    </div>
  )
}
