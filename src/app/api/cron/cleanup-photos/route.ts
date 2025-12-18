import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * Verify the request is from Vercel Cron.
 * In production, Vercel adds an Authorization header with CRON_SECRET.
 */
function verifyCronRequest(request: Request): boolean {
  // In development, allow without verification
  if (process.env.NODE_ENV === 'development') {
    return true
  }

  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET not configured')
    return false
  }

  return authHeader === `Bearer ${cronSecret}`
}

/**
 * GET /api/cron/cleanup-photos
 *
 * Scheduled cleanup of expired photos from external integrations.
 * Called by Vercel Cron at 06:00 UTC daily (after sync at 05:00).
 *
 * Photos have a 7-day retention period set via expires_at.
 * This job deletes expired photo records and their storage files.
 */
export async function GET(request: Request) {
  // Verify cron authorization
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron] Starting photo cleanup')

  // Use service role client to bypass RLS
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[Cron] Missing Supabase configuration')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = createServiceClient(supabaseUrl, serviceRoleKey)

  try {
    const now = new Date().toISOString()

    // Find expired photos
    const { data: expiredPhotos, error: fetchError } = await supabase
      .from('external_photos')
      .select('id, storage_path, thumbnail_path')
      .lt('expires_at', now)
      .limit(500)

    if (fetchError) {
      console.error('[Cron] Error fetching expired photos:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch expired photos' }, { status: 500 })
    }

    if (!expiredPhotos || expiredPhotos.length === 0) {
      console.log('[Cron] No expired photos to clean up')
      return NextResponse.json({
        success: true,
        photosDeleted: 0,
        storageFilesDeleted: 0,
        message: 'No expired photos',
      })
    }

    console.log(`[Cron] Found ${expiredPhotos.length} expired photos to clean up`)

    // Collect storage paths to delete
    const storagePaths: string[] = []
    for (const photo of expiredPhotos) {
      if (photo.storage_path && !photo.storage_path.startsWith('pending/')) {
        storagePaths.push(photo.storage_path)
      }
      if (photo.thumbnail_path && !photo.thumbnail_path.startsWith('pending/')) {
        storagePaths.push(photo.thumbnail_path)
      }
    }

    // Delete files from storage (if any real files exist)
    let storageFilesDeleted = 0
    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('external-photos')
        .remove(storagePaths)

      if (storageError) {
        console.error('[Cron] Error deleting storage files:', storageError)
        // Continue anyway - we still want to clean up the database records
      } else {
        storageFilesDeleted = storagePaths.length
      }
    }

    // Delete database records
    const photoIds = expiredPhotos.map((p) => p.id)
    const { error: deleteError } = await supabase
      .from('external_photos')
      .delete()
      .in('id', photoIds)

    if (deleteError) {
      console.error('[Cron] Error deleting photo records:', deleteError)
      return NextResponse.json({ error: 'Failed to delete photo records' }, { status: 500 })
    }

    console.log(`[Cron] Cleanup complete: ${expiredPhotos.length} photos deleted, ${storageFilesDeleted} storage files removed`)

    return NextResponse.json({
      success: true,
      photosDeleted: expiredPhotos.length,
      storageFilesDeleted,
    })
  } catch (error) {
    console.error('[Cron] Photo cleanup error:', error)
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
