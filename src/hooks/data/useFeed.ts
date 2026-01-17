'use client'

/**
 * useFeed Hook
 *
 * Abstracts feed data fetching for both demo and production modes.
 * Feed includes messages, photos, reminders, notifications, and integration data.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { useChildren } from './useChildren'
import { useTasks } from './useTasks'
import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'
import { CACHE_KEYS, CACHE_VERSION } from '@/lib/cache-constants'
import type { FeedMessage } from '@/components/feed/MessageCard'
import type { FeedPhoto } from '@/components/feed/PhotoGallery'
import type { FeedReminder } from '@/components/feed/ReminderCard'
import type { EventNotification } from '@/components/feed/EventChangeNotification'
import type { IntegrationStatus } from '@/components/feed/SyncStatusBanner'
import type { IntegrationChild } from '@/components/feed/FeedPageContent'

// Cache max age - 3 minutes (same as prefetch)
const FEED_CACHE_MAX_AGE = 3 * 60 * 1000

// Cache data structure (matches what prefetch stores)
interface FeedCacheData {
  integrationsEnabled: boolean
  integrations?: Array<{
    id: string
    service: string
    display_name: string
    last_sync_status: string | null
    last_sync_error: string | null
    last_sync_at: string | null
  }>
  messages?: Array<Record<string, unknown>>
  integrationChildren?: Array<Record<string, unknown>>
  photos?: Array<Record<string, unknown>>
  notifications?: Array<Record<string, unknown>>
}

export interface UseFeedReturn {
  // Data
  messages: FeedMessage[]
  photos: FeedPhoto[]
  reminders: FeedReminder[]
  notifications: EventNotification[]
  integrationChildren: IntegrationChild[]
  integrationStatuses: IntegrationStatus[]

  // State
  loading: boolean
  error: string | null
  integrationsEnabled: boolean

  // Actions
  refetch: () => Promise<void>
  toggleReminder: (id: string, completed: boolean) => Promise<void>
  syncIntegrations: () => Promise<void>
}

/**
 * Hook to get feed data (messages, photos, reminders, notifications from integrations)
 * Works for both demo and production modes.
 */
export function useFeed(): UseFeedReturn {
  const { isDemo, supabase, demoState } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()
  const { children } = useChildren()
  const { tasks } = useTasks()

  // State for production mode
  const [messages, setMessages] = useState<FeedMessage[]>([])
  const [photos, setPhotos] = useState<FeedPhoto[]>([])
  const [notifications, setNotifications] = useState<EventNotification[]>([])
  const [integrationChildren, setIntegrationChildren] = useState<IntegrationChild[]>([])
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationStatus[]>([])
  const [integrationsEnabled, setIntegrationsEnabled] = useState(true)
  // In demo mode, show loading until demoState is available
  const [loading, setLoading] = useState(!isDemo || !demoState)
  const [error, setError] = useState<string | null>(null)

  // Track photo URL generation session
  const photoGenSessionRef = useRef(0)

  // Convert tasks to reminders format
  const reminders: FeedReminder[] = useMemo(() => {
    return tasks
      .filter((task) => task.status === 'open')
      .map((task) => {
        const child = children.find((c) => c.id === task.child_id)
        return {
          id: task.id,
          title: task.title,
          notes: task.notes,
          due_date: task.date,
          completed: task.status === 'done',
          child_id: task.child_id,
          child_name: child?.name || null,
          created_at: task.created_at,
        }
      })
  }, [tasks, children])

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setLoading(true)
    setError(null)

    try {
      const hId = household.id

      // Check if integrations are enabled
      const { data: householdData } = await supabase
        .from('households')
        .select('external_integrations_enabled')
        .eq('id', hId)
        .single()

      if (!householdData?.external_integrations_enabled) {
        setIntegrationsEnabled(false)
        setLoading(false)
        return
      }

      setIntegrationsEnabled(true)

      // Load integration statuses
      const { data: integrationsData } = await supabase
        .from('external_integrations')
        .select('id, service, display_name, last_sync_status, last_sync_error, last_sync_at')
        .eq('household_id', hId)

      const transformedStatuses: IntegrationStatus[] = (integrationsData || []).map((i) => ({
        id: i.id,
        service: i.service as IntegrationStatus['service'],
        displayName: i.display_name || '',
        lastSyncStatus: i.last_sync_status,
        lastSyncError: i.last_sync_error,
        lastSyncAt: i.last_sync_at,
      }))
      setIntegrationStatuses(transformedStatuses)

      // Load messages
      const { data: messagesData } = await supabase
        .from('external_messages')
        .select(`
          *,
          external_integrations!inner(service, display_name, household_id),
          children(name)
        `)
        .eq('external_integrations.household_id', hId)
        .order('message_date', { ascending: false })
        .limit(100)

      const transformedMessages: FeedMessage[] = (messagesData || []).map((msg) => ({
        id: msg.id,
        integration_id: msg.integration_id,
        child_id: msg.child_id,
        external_id: msg.external_id,
        sender_name: msg.sender_name,
        title: msg.title,
        body: msg.body,
        message_date: msg.message_date,
        source_type: msg.source_type || 'message',
        service: msg.external_integrations?.service as 'spond' | 'kidplan' | 'iskole' | 'mykid',
        child_name: msg.children?.name || null,
        integration_name: msg.external_integrations?.display_name || null,
        raw_data: msg.raw_data,
      }))
      setMessages(transformedMessages)

      // Load integration-children mappings
      const { data: integrationChildrenData } = await supabase
        .from('external_integration_children')
        .select(`
          integration_id,
          child_id,
          external_group_name,
          children(name),
          external_integrations!inner(household_id)
        `)
        .eq('external_integrations.household_id', hId)

      const transformedIntegrationChildren: IntegrationChild[] = (integrationChildrenData || []).map((ic) => {
        const childData = ic.children as unknown as { name: string } | null
        return {
          integrationId: ic.integration_id,
          childId: ic.child_id,
          childName: childData?.name || '',
          groupName: ic.external_group_name,
        }
      })
      setIntegrationChildren(transformedIntegrationChildren)

      // Load photos
      const { data: photosData } = await supabase
        .from('external_photos')
        .select(`
          *,
          external_integrations!inner(service, display_name, household_id),
          children(name)
        `)
        .eq('external_integrations.household_id', hId)
        .gt('expires_at', new Date().toISOString())
        .order('taken_at', { ascending: false })
        .limit(50)

      const actualPhotos = (photosData || []).filter(
        (photo) => photo.storage_path && !photo.storage_path.startsWith('pending/')
      )

      const initialPhotos: FeedPhoto[] = actualPhotos.map((photo) => ({
        id: photo.id,
        integration_id: photo.integration_id,
        child_id: photo.child_id,
        external_id: photo.external_id,
        title: photo.title,
        taken_at: photo.taken_at,
        storage_path: photo.storage_path,
        thumbnail_path: photo.thumbnail_path,
        child_name: photo.children?.name || null,
        integration_name: photo.external_integrations?.display_name || null,
        image_url: null,
      }))
      setPhotos(initialPhotos)

      // Generate signed URLs progressively
      const currentSession = ++photoGenSessionRef.current
      const batchSize = 5
      for (let i = 0; i < actualPhotos.length; i += batchSize) {
        if (photoGenSessionRef.current !== currentSession) break

        const batch = actualPhotos.slice(i, i + batchSize)
        const urls = await Promise.all(
          batch.map(async (photo) => {
            try {
              const { data } = await supabase.storage
                .from('external-photos')
                .createSignedUrl(photo.storage_path, 3600)
              return { id: photo.id, url: data?.signedUrl || null }
            } catch {
              return { id: photo.id, url: null }
            }
          })
        )

        if (photoGenSessionRef.current !== currentSession) break

        setPhotos((prev) =>
          prev.map((p) => {
            const match = urls.find((u) => u.id === p.id)
            return match ? { ...p, image_url: match.url } : p
          })
        )
      }

      // Load event change notifications
      const { data: notificationsData } = await supabase
        .from('event_change_notifications')
        .select('*')
        .eq('household_id', hId)
        .in('status', ['unread', 'read'])
        .order('created_at', { ascending: false })
        .limit(20)

      setNotifications((notificationsData || []) as EventNotification[])

      // Update cache for next navigation (silent, don't await)
      setCache(CACHE_KEYS.feed(hId), {
        integrationsEnabled: true,
        integrations: integrationsData || [],
        messages: messagesData || [],
        integrationChildren: integrationChildrenData || [],
        photos: photosData || [],
        notifications: notificationsData || [],
        version: CACHE_VERSION,
      }).catch(() => {})
    } catch (err) {
      console.error('Error loading feed data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load feed')
    } finally {
      setLoading(false)
    }
  }, [isDemo, supabase, household?.id])

  // Toggle reminder completion (production only)
  const toggleReminder = useCallback(async (id: string, completed: boolean) => {
    if (isDemo || !supabase) return

    const { error: updateError } = await supabase
      .from('child_tasks')
      .update({ status: completed ? 'done' : 'open' })
      .eq('id', id)

    if (updateError) {
      console.error('Error toggling reminder:', updateError)
    }
  }, [isDemo, supabase])

  // Sync all integrations (production only)
  const syncIntegrations = useCallback(async () => {
    if (isDemo) return

    await Promise.allSettled([
      fetch('/api/integrations/spond/sync', { method: 'POST' }),
      fetch('/api/integrations/kidplan/sync', { method: 'POST' }),
      fetch('/api/integrations/iskole/sync', { method: 'POST' }),
      fetch('/api/integrations/mykid/sync', { method: 'POST' }),
    ])

    await fetch('/api/integrations/extract-actions', { method: 'POST' })
    await fetchData()
  }, [isDemo, fetchData])

  // Subscribe to realtime changes for instant sync between family members
  // event_change_notifications has household_id, so we can filter
  useRealtimeSubscription<EventNotification>({
    table: 'event_change_notifications',
    filter: household?.id ? createHouseholdFilter(household.id) : undefined,
    enabled: !isDemo && !!household?.id,
    onAny: fetchData,
  })

  // external_messages doesn't have household_id directly, subscribe without filter
  // fetchData will apply proper join filter
  useRealtimeSubscription<FeedMessage>({
    table: 'external_messages',
    enabled: !isDemo && !!household?.id,
    onAny: fetchData,
  })

  // external_photos doesn't have household_id directly, subscribe without filter
  // fetchData will apply proper join filter
  useRealtimeSubscription<FeedPhoto>({
    table: 'external_photos',
    enabled: !isDemo && !!household?.id,
    onAny: fetchData,
  })

  // Check for prefetched cache and do initial fetch
  useEffect(() => {
    if (isDemo || !household?.id || householdLoading) return

    const hId = household.id
    const cacheKey = CACHE_KEYS.feed(hId)

    // Try to use prefetched data first (stale-while-revalidate)
    getCached<FeedCacheData>(cacheKey).then((cached) => {
      if (cached && isCacheFresh(cached, FEED_CACHE_MAX_AGE)) {
        // Apply cached data immediately for instant render
        applyCachedData(cached.data)
        setLoading(false)
        // Still fetch fresh data in background
        fetchData()
      } else {
        // No cache or stale - fetch fresh
        fetchData()
      }
    }).catch(() => {
      // Cache error - just fetch normally
      fetchData()
    })

    // Helper to apply cached data to state
    function applyCachedData(data: FeedCacheData) {
      setIntegrationsEnabled(data.integrationsEnabled)

      if (!data.integrationsEnabled) return

      // Apply integration statuses
      if (data.integrations) {
        const statuses: IntegrationStatus[] = data.integrations.map((i) => ({
          id: i.id,
          service: i.service as IntegrationStatus['service'],
          displayName: i.display_name || '',
          lastSyncStatus: i.last_sync_status,
          lastSyncError: i.last_sync_error,
          lastSyncAt: i.last_sync_at,
        }))
        setIntegrationStatuses(statuses)
      }

      // Apply messages
      if (data.messages) {
        const msgs: FeedMessage[] = data.messages.map((msg: Record<string, unknown>) => ({
          id: msg.id as string,
          integration_id: msg.integration_id as string,
          child_id: msg.child_id as string | null,
          external_id: msg.external_id as string,
          sender_name: msg.sender_name as string | null,
          title: msg.title as string | null,
          body: (msg.body as string) || '',
          message_date: msg.message_date as string,
          source_type: (msg.source_type || 'message') as string,
          service: (msg.external_integrations as Record<string, unknown>)?.service as 'spond' | 'kidplan' | 'iskole' | 'mykid',
          child_name: (msg.children as Record<string, unknown>)?.name as string | null,
          integration_name: (msg.external_integrations as Record<string, unknown>)?.display_name as string | null,
          raw_data: msg.raw_data,
        }))
        setMessages(msgs)
      }

      // Apply integration children
      if (data.integrationChildren) {
        const ic: IntegrationChild[] = data.integrationChildren.map((item: Record<string, unknown>) => {
          const childData = item.children as Record<string, unknown> | null
          return {
            integrationId: item.integration_id as string,
            childId: item.child_id as string,
            childName: childData?.name as string || '',
            groupName: item.external_group_name as string,
          }
        })
        setIntegrationChildren(ic)
      }

      // Apply photos (without signed URLs - they'll be generated on fresh fetch)
      if (data.photos) {
        const ps: FeedPhoto[] = data.photos
          .filter((photo: Record<string, unknown>) =>
            photo.storage_path && !(photo.storage_path as string).startsWith('pending/')
          )
          .map((photo: Record<string, unknown>) => ({
            id: photo.id as string,
            integration_id: photo.integration_id as string,
            child_id: photo.child_id as string | null,
            external_id: photo.external_id as string,
            title: photo.title as string | null,
            taken_at: photo.taken_at as string,
            storage_path: photo.storage_path as string,
            thumbnail_path: photo.thumbnail_path as string | null,
            child_name: (photo.children as Record<string, unknown>)?.name as string | null,
            integration_name: (photo.external_integrations as Record<string, unknown>)?.display_name as string | null,
            image_url: null, // URLs need to be generated fresh
          }))
        setPhotos(ps)
      }

      // Apply notifications
      if (data.notifications) {
        setNotifications(data.notifications as unknown as EventNotification[])
      }
    }
  }, [isDemo, household?.id, householdLoading, fetchData])

  // Handle case where household loading finished but no household exists
  // This prevents infinite loading state for unauthenticated users or users without a household
  useEffect(() => {
    if (!isDemo && !householdLoading && !household?.id) {
      setLoading(false)
    }
  }, [isDemo, householdLoading, household?.id])

  // Update loading state when demo data becomes available
  useEffect(() => {
    if (isDemo && demoState) {
      setLoading(false)
    }
  }, [isDemo, demoState])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    const demoReminders: FeedReminder[] = tasks
      .filter((task) => task.status === 'open')
      .map((task) => {
        const child = children.find((c) => c.id === task.child_id)
        return {
          id: task.id,
          title: task.title,
          notes: task.notes,
          due_date: task.date,
          completed: task.status === 'done',
          child_id: task.child_id,
          child_name: child?.name || null,
          created_at: task.created_at,
        }
      })

    return {
      messages: demoState.feedMessages,
      photos: demoState.feedPhotos,
      reminders: demoReminders,
      notifications: [],
      integrationChildren: [],
      integrationStatuses: [],
      loading: false,
      error: null,
      integrationsEnabled: true,
      refetch: async () => {}, // No-op in demo
      toggleReminder: async () => {}, // No-op in demo
      syncIntegrations: async () => {}, // No-op in demo
    }
  }

  // Demo mode initializing: show loading
  if (isDemo && !demoState) {
    return {
      messages: [],
      photos: [],
      reminders: [],
      notifications: [],
      integrationChildren: [],
      integrationStatuses: [],
      loading: true,
      error: null,
      integrationsEnabled: true,
      refetch: async () => {},
      toggleReminder: async () => {},
      syncIntegrations: async () => {},
    }
  }

  return {
    messages,
    photos,
    reminders,
    notifications,
    integrationChildren,
    integrationStatuses,
    loading: loading || householdLoading,
    error,
    integrationsEnabled,
    refetch: fetchData,
    toggleReminder,
    syncIntegrations,
  }
}
