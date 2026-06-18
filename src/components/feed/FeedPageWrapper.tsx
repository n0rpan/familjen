'use client'

/**
 * FeedPageWrapper - Client Component
 *
 * Handles all client-side interactivity for the feed page:
 * - Realtime subscriptions
 * - Reminder toggles
 * - Sync handlers
 * - Notification callbacks
 *
 * Receives initial data from server (PPR) and manages local state.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import { useFeed } from '@/hooks/data'
import { useEventNotifications } from '@/hooks/data/useEventNotifications'
import { safeTransformMessages, safeTransformPhotos } from '@/lib/feed-transforms'
import { useRefreshWithRevalidate } from '@/hooks/useRefreshWithRevalidate'
import { FeedPageContent } from './FeedPageContent'
import { FreshnessIndicator } from '@/components/FreshnessIndicator'
import type { FeedFilter } from './FeedFilters'
import type { FeedPageData } from '@/lib/data/server'
import type { DuplicateSuggestion } from './DuplicateSuggestions'
import type { MergedDuplicate } from './MergedDuplicates'
import type { FeedMessage } from './MessageCard'
import type { FeedPhoto } from './PhotoGallery'
import type { FeedReminder } from './ReminderCard'
import type { IntegrationChild } from './FeedPageContent'
import type { IntegrationStatus } from './SyncStatusBanner'
import type { EventNotification } from './EventChangeNotification'

interface FeedPageWrapperProps {
  initialData: FeedPageData
  householdId: string
  isDemo: boolean
  serviceFilter?: string
  typeFilter?: string
  dataTimestamp?: number
}

export function FeedPageWrapper({
  initialData,
  householdId,
  isDemo,
  serviceFilter,
  typeFilter,
  dataTimestamp,
}: FeedPageWrapperProps) {
  const { t } = useLanguage()
  const supabase = useMemo(() => isDemo ? null : createClient(), [isDemo])
  const { refreshFeed } = useRefreshWithRevalidate(householdId)

  // State for duplicate management
  const [duplicateSuggestions, setDuplicateSuggestions] = useState<DuplicateSuggestion[]>(
    initialData.duplicateSuggestions as unknown as DuplicateSuggestion[] || []
  )
  const [mergedDuplicates, setMergedDuplicates] = useState<MergedDuplicate[]>(
    initialData.mergedDuplicates as unknown as MergedDuplicate[] || []
  )

  // Transform initial data to match FeedPageContent expectations
  // Safe transforms handle both raw (nested external_integrations) and already-transformed data
  const [messages, setMessages] = useState<FeedMessage[]>(() =>
    safeTransformMessages(initialData.messages || [])
  )
  const [photos, setPhotos] = useState<FeedPhoto[]>(() =>
    safeTransformPhotos(initialData.photos || [])
  )
  const [notifications, setNotificationsState] = useState<EventNotification[]>(
    initialData.notifications as unknown as EventNotification[] || []
  )

  // Generate signed URLs for photos progressively
  // Photos from server have storage_path but no image_url
  useEffect(() => {
    if (isDemo || !supabase || photos.length === 0) return

    const photosNeedingUrls = photos.filter(p => p.storage_path && !p.image_url)
    if (photosNeedingUrls.length === 0) return

    // Process in batches of 5 to avoid overwhelming the API
    const generateUrls = async () => {
      const BATCH_SIZE = 5
      for (let i = 0; i < photosNeedingUrls.length; i += BATCH_SIZE) {
        const batch = photosNeedingUrls.slice(i, i + BATCH_SIZE)

        const urlPromises = batch.map(async (photo) => {
          try {
            const { data } = await supabase.storage
              .from('external-photos')
              .createSignedUrl(photo.storage_path, 3600) // 1 hour expiry

            return { id: photo.id, url: data?.signedUrl || null }
          } catch {
            return { id: photo.id, url: null }
          }
        })

        const results = await Promise.all(urlPromises)

        // Update photos with signed URLs
        setPhotos(prev => prev.map(p => {
          const result = results.find(r => r.id === p.id)
          if (result?.url) {
            return { ...p, image_url: result.url }
          }
          return p
        }))
      }
    }

    generateUrls()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally using photos.length to avoid infinite loop when updating photos with URLs
  }, [isDemo, supabase, photos.length])

  // Integration statuses from initial data
  const integrationStatuses: IntegrationStatus[] = (initialData.integrations || []).map(i => ({
    id: i.id,
    service: i.service as 'spond' | 'kidplan' | 'iskole' | 'mykid',
    displayName: i.display_name,
    lastSyncAt: i.last_sync_at,
    lastSyncStatus: i.last_sync_status,
    lastSyncError: i.last_sync_error,
  }))

  // Integration children mapping
  const integrationChildren: IntegrationChild[] = (initialData.integrationChildren || []).map(ic => ({
    integrationId: (ic as Record<string, unknown>).integration_id as string,
    childId: (ic as Record<string, unknown>).child_id as string,
    childName: ((ic as Record<string, unknown>).children as { name: string } | null)?.name || '',
    groupName: (ic as Record<string, unknown>).external_group_name as string | null,
  }))

  // Use the feed hook for mutations and refetch (production mode only)
  const {
    reminders: feedReminders,
    toggleReminder,
    syncIntegrations,
    refetch,
  } = useFeed()

  // Use reminders from hook for mutations (but initialize with server data)
  const [reminders, setReminders] = useState<FeedReminder[]>([])

  // Sync reminders from feed hook when available
  useEffect(() => {
    if (feedReminders.length > 0) {
      setReminders(feedReminders)
    }
  }, [feedReminders])

  // Use the event notifications hook for optimistic updates
  const {
    notifications: notificationsFromHook,
    dismiss: dismissNotification,
    restore: restoreNotification,
    dismissAll: dismissAllNotifications,
    restoreAll: restoreAllNotifications,
    syncing: notificationsSyncing,
    setNotifications,
  } = useEventNotifications(notifications)

  // Sync notifications when they change
  useEffect(() => {
    if (notificationsFromHook.length > 0 || notifications.length > 0) {
      setNotifications(notifications)
    }
  }, [notifications, notificationsFromHook.length, setNotifications])

  // Fetch duplicates data
  const fetchDuplicates = useCallback(async () => {
    if (isDemo) return
    try {
      const response = await fetch('/api/integrations/duplicates')
      if (response.ok) {
        const data = await response.json()
        setDuplicateSuggestions(data.suggestions || [])
        setMergedDuplicates(data.mergedDuplicates || [])
      }
    } catch (error) {
      console.error('[Feed] Error fetching duplicates:', error)
    }
  }, [isDemo])

  // Fetch correctly-shaped duplicate data on mount.
  // The server data layer does NOT include duplicate suggestions because the
  // UI needs the nested { eventA, eventB } shape, which requires joining
  // external_events. The /api/integrations/duplicates route does that mapping.
  useEffect(() => {
    fetchDuplicates()
  }, [fetchDuplicates])

  // Determine initial filter from URL params
  const getInitialFilter = (): FeedFilter => {
    if (typeFilter === 'photos') return 'photos'
    if (typeFilter === 'reminders') return 'reminders'
    if (serviceFilter === 'spond') return 'spond'
    if (serviceFilter === 'iskole') return 'school'
    if (serviceFilter === 'kidplan' || serviceFilter === 'mykid') return 'kindergarten'
    return 'all'
  }

  const initialFilter = getInitialFilter()

  // Handle reminder toggle
  const handleToggleReminder = async (id: string, completed: boolean) => {
    if (isDemo) return
    await toggleReminder(id, completed)
    await refetch()
  }

  // Handle sync
  const handleSync = async () => {
    if (isDemo) return
    await syncIntegrations()
    await Promise.all([refetch(), fetchDuplicates()])
  }

  // Handle deduplication
  const handleDeduplicate = async () => {
    if (isDemo) return null
    try {
      const response = await fetch('/api/integrations/deduplicate', {
        method: 'POST',
      })
      if (!response.ok) {
        console.error('[Deduplicate] API error:', response.status)
        return null
      }
      const result = await response.json()
      // Refetch to show updated data
      await Promise.all([refetch(), fetchDuplicates()])
      return {
        autoMerged: result.autoMerged || 0,
        suggestionsCreated: result.suggestionsCreated || 0,
        pairsChecked: result.pairsChecked || 0,
      }
    } catch (error) {
      console.error('[Deduplicate] Error:', error)
      return null
    }
  }

  // Throttle state for realtime events - prevents flooding while keeping first update instant
  // Throttle (not debounce): first event fires immediately, then limits rate for subsequent events
  const lastRefreshRef = useRef<number>(0)
  const pendingRefreshRef = useRef<NodeJS.Timeout | null>(null)
  const THROTTLE_MS = 500 // Minimum time between refreshes

  // Realtime subscriptions for feed updates (production only)
  useEffect(() => {
    if (isDemo || !supabase) return

    // Throttled refresh - first event is INSTANT, subsequent events are rate-limited
    // This ensures spouse-to-spouse updates are immediate while preventing flood during bulk sync
    const throttledRefresh = () => {
      const now = Date.now()
      const timeSinceLastRefresh = now - lastRefreshRef.current

      if (timeSinceLastRefresh >= THROTTLE_MS) {
        // Enough time has passed - refresh immediately
        lastRefreshRef.current = now
        refreshFeed()
      } else if (!pendingRefreshRef.current) {
        // Schedule a refresh for when throttle window expires
        const delay = THROTTLE_MS - timeSinceLastRefresh
        pendingRefreshRef.current = setTimeout(() => {
          lastRefreshRef.current = Date.now()
          pendingRefreshRef.current = null
          refreshFeed()
        }, delay)
      }
      // If there's already a pending refresh, do nothing (it will pick up all changes)
    }

    const channel = supabase
      .channel(`feed-realtime-${householdId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'external_messages',
        },
        throttledRefresh
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'external_photos',
        },
        throttledRefresh
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_suggestions',
        },
        throttledRefresh
      )
      .subscribe()

    // Cleanup: clear pending timer, reset throttle state, and remove channel
    return () => {
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current)
        pendingRefreshRef.current = null
      }
      // Reset throttle timestamp so first event after re-subscribe is instant
      lastRefreshRef.current = 0
      supabase.removeChannel(channel)
    }
  }, [householdId, isDemo, refreshFeed, supabase])

  // Not enabled state
  if (!isDemo && !initialData.integrationsEnabled) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <div className="flex items-center gap-3">
            <h1 className="page-title">{t.nav.feed}</h1>
            <FreshnessIndicator timestamp={dataTimestamp} color="sage" />
          </div>
          <p style={{ color: 'var(--muted)' }}>
            {t.feed?.subtitle || 'Meldinger, bilder og varsler fra Spond, barnehage og skole'}
          </p>
        </div>

        <div
          className="card p-8 text-center"
          style={{
            border: '2px dashed var(--border)',
            background: 'transparent',
          }}
        >
          <div className="mb-4">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--muted)', margin: '0 auto' }}
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            {t.feed.integrationsDisabled}
          </h2>
          <p className="mb-4" style={{ color: 'var(--muted)' }}>
            {t.feed.contactAdmin}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header mb-6">
        <div className="flex items-center gap-3">
          <h1 className="page-title">{t.nav.feed}</h1>
          <FreshnessIndicator timestamp={dataTimestamp} color="sage" />
        </div>
        <p style={{ color: 'var(--muted)' }}>
          {t.feed?.subtitle || 'Meldinger, bilder og varsler fra Spond, barnehage og skole'}
        </p>
      </div>

      <FeedPageContent
        messages={messages}
        photos={photos}
        reminders={reminders}
        notifications={notificationsFromHook}
        integrationChildren={integrationChildren}
        integrationStatuses={integrationStatuses}
        duplicateSuggestions={duplicateSuggestions}
        mergedDuplicates={mergedDuplicates}
        initialFilter={initialFilter}
        onToggleReminder={handleToggleReminder}
        onSync={handleSync}
        onDeduplicate={handleDeduplicate}
        onDuplicatesUpdate={fetchDuplicates}
        onDismissNotification={dismissNotification}
        onRestoreNotification={restoreNotification}
        onDismissAllNotifications={dismissAllNotifications}
        onRestoreAllNotifications={restoreAllNotifications}
        notificationsSyncing={notificationsSyncing}
        isDemo={isDemo}
      />
    </div>
  )
}
