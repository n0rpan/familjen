import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { verifyCronRequest } from '@/lib/cron-auth'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

/**
 * GET /api/cron/cleanup-photos
 *
 * Scheduled cleanup of expired photos and orphaned data.
 * Called by Vercel Cron at 06:00 UTC daily (after sync at 05:00).
 *
 * Cleans up:
 * 1. Photos with expired retention (1 year)
 * 2. Orphaned pickups (picker_id is null, date in past)
 * 3. Bought shopping items older than 7 days
 */
export async function GET(request: Request) {
  // Verify cron authorization
  if (!verifyCronRequest(request)) {
    return ApiErrors.unauthorized()
  }

  console.log('[Cron] Starting cleanup job')

  // Use service role client to bypass RLS
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[Cron] Missing Supabase configuration')
    return ApiErrors.internal({ internalMessage: 'Missing Supabase configuration' })
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
      return ApiErrors.internal({ internalMessage: `Failed to fetch expired photos: ${fetchError.message}` })
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
      return ApiErrors.internal({ internalMessage: `Failed to delete photo records: ${deleteError.message}` })
    }

    console.log(`[Cron] Photo cleanup: ${expiredPhotos.length} photos deleted, ${storageFilesDeleted} storage files removed`)

    // --- Cleanup orphaned pickups ---
    // Pickups with picker_id = null are from AI "delete" operations (soft delete for undo)
    // Clean up past dates where undo window has expired
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    const { data: orphanedPickups, error: pickupFetchError } = await supabase
      .from('pickups')
      .select('id')
      .is('picker_id', null)
      .lt('date', yesterdayStr)
      .limit(500)

    let pickupsDeleted = 0
    if (pickupFetchError) {
      console.error('[Cron] Error fetching orphaned pickups:', pickupFetchError)
    } else if (orphanedPickups && orphanedPickups.length > 0) {
      const { error: pickupDeleteError } = await supabase
        .from('pickups')
        .delete()
        .in('id', orphanedPickups.map(p => p.id))

      if (pickupDeleteError) {
        console.error('[Cron] Error deleting orphaned pickups:', pickupDeleteError)
      } else {
        pickupsDeleted = orphanedPickups.length
        console.log(`[Cron] Deleted ${pickupsDeleted} orphaned pickups`)
      }
    }

    // --- Cleanup old bought shopping items ---
    // Items marked as bought more than 7 days ago
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysAgoStr = sevenDaysAgo.toISOString()

    const { data: boughtItems, error: shoppingFetchError } = await supabase
      .from('shopping_list_items')
      .select('id')
      .eq('is_bought', true)
      .lt('updated_at', sevenDaysAgoStr)
      .limit(500)

    let shoppingItemsDeleted = 0
    if (shoppingFetchError) {
      console.error('[Cron] Error fetching old bought items:', shoppingFetchError)
    } else if (boughtItems && boughtItems.length > 0) {
      const { error: shoppingDeleteError } = await supabase
        .from('shopping_list_items')
        .delete()
        .in('id', boughtItems.map(i => i.id))

      if (shoppingDeleteError) {
        console.error('[Cron] Error deleting bought items:', shoppingDeleteError)
      } else {
        shoppingItemsDeleted = boughtItems.length
        console.log(`[Cron] Deleted ${shoppingItemsDeleted} old bought shopping items`)
      }
    }

    console.log('[Cron] Cleanup job complete')

    return NextResponse.json({
      success: true,
      photosDeleted: expiredPhotos.length,
      storageFilesDeleted,
      pickupsDeleted,
      shoppingItemsDeleted,
    })
  } catch (error) {
    return handleApiError(error, 'cron cleanup')
  }
}
