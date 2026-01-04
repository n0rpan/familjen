/**
 * AdminDataLoader - Server Component
 *
 * Verifies admin access and loads initial admin data from the server.
 * Admin page does NOT support demo mode - requires real authentication.
 */

import { redirect } from 'next/navigation'
import { fetchAdminPageData } from '@/lib/data/server'
import { AdminPageContent } from './AdminPageContent'
import { createClient } from '@/lib/supabase/server'

export async function AdminDataLoader() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Verify authentication
  if (!user?.email) {
    redirect('/')
  }

  // Verify admin status via JWT app_metadata
  if (user.app_metadata?.is_admin !== true) {
    redirect('/')
  }

  // Fetch admin data
  const initialData = await fetchAdminPageData()

  return (
    <AdminPageContent
      initialData={initialData}
      currentUserId={user.id}
    />
  )
}
