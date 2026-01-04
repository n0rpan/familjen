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

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import { useFeed } from '@/hooks/data'
import { useEventNotifications } from '@/hooks/data/useEventNotifications'
import { FeedPageContent } from './FeedPageContent'
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
}

export function FeedPageWrapper({
  initialData,
  householdId,
  isDemo,
  serviceFilter,
  typeFilter,
}: FeedPageWrapperProps) {
  const router = useRouter()
  const { t } = useLanguage()
  const supabase = useMemo(() => isDemo ? null : createClient(), [isDemo])

  // State for duplicate management
  const [duplicateSuggestions, setDuplicateSuggestions] = useState<DuplicateSuggestion[]>(
    initialData.duplicateSuggestions as unknown as DuplicateSuggestion[] || []
  )
  const [mergedDuplicates, setMergedDuplicates] = useState<MergedDuplicate[]>(
    initialData.mergedDuplicates as unknown as MergedDuplicate[] || []
  )

  // Transform initial data to match FeedPageContent expectations
  const [messages, setMessages] = useState<FeedMessage[]>(
    initialData.messages as unknown as FeedMessage[] || []
  )
  const [photos, setPhotos] = useState<FeedPhoto[]>(
    initialData.photos as unknown as FeedPhoto[] || []
  )
  const [notifications, setNotificationsState] = useState<EventNotification[]>(
    initialData.notifications as unknown as EventNotification[] || []
  )

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

  // Realtime subscriptions for feed updates (production only)
  useEffect(() => {
    if (isDemo || !supabase) return

    const channel = supabase
      .channel(`feed-realtime-${householdId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'external_messages',
        },
        () => {
          router.refresh()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'external_photos',
        },
        () => {
          router.refresh()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_suggestions',
        },
        () => {
          router.refresh()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [householdId, isDemo, router, supabase])

  // Not enabled state
  if (!isDemo && !initialData.integrationsEnabled) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.feed}</h1>
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
        <h1 className="page-title">{t.nav.feed}</h1>
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
