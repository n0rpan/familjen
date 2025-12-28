'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FeedPageContent } from './FeedPageContent'
import type { FeedFilter } from './FeedFilters'
import type { FeedMessage } from './MessageCard'
import type { FeedPhoto } from './PhotoGallery'
import type { FeedReminder } from './ReminderCard'
import type { EventNotification } from './EventChangeNotification'
import type { IntegrationStatus } from './SyncStatusBanner'

// Integration children mapping (which children belong to which integrations)
export interface IntegrationChild {
  integrationId: string
  childId: string
  childName: string
  groupName: string | null
}

interface Props {
  householdId: string
  initialFilter?: FeedFilter
}

export function FeedPage({ householdId, initialFilter = 'all' }: Props) {
  const supabase = useMemo(() => createClient(), [])

  // State
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState<FeedMessage[]>([])
  const [photos, setPhotos] = useState<FeedPhoto[]>([])
  const [reminders, setReminders] = useState<FeedReminder[]>([])
  const [notifications, setNotifications] = useState<EventNotification[]>([])
  const [integrationChildren, setIntegrationChildren] = useState<IntegrationChild[]>([])
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationStatus[]>([])

  // Track photo URL generation session to prevent stale updates
  const photoGenSessionRef = useRef(0)

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Load integration statuses (for sync failure banner)
      const { data: integrationsData } = await supabase
        .from('external_integrations')
        .select('id, service, display_name, last_sync_status, last_sync_error, last_sync_at')
        .eq('household_id', householdId)

      const transformedStatuses: IntegrationStatus[] = (integrationsData || []).map((i) => ({
        id: i.id,
        service: i.service as IntegrationStatus['service'],
        displayName: i.display_name || '',
        lastSyncStatus: i.last_sync_status,
        lastSyncError: i.last_sync_error,
        lastSyncAt: i.last_sync_at,
      }))
      setIntegrationStatuses(transformedStatuses)

      // Load messages with integration and child info
      const { data: messagesData } = await supabase
        .from('external_messages')
        .select(`
          *,
          external_integrations!inner(service, display_name, household_id),
          children(name)
        `)
        .eq('external_integrations.household_id', householdId)
        .order('message_date', { ascending: false })
        .limit(100)

      // Transform messages
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

      // Load integration-children mappings (which children belong to which integrations)
      const { data: integrationChildrenData } = await supabase
        .from('external_integration_children')
        .select(`
          integration_id,
          child_id,
          external_group_name,
          children(name),
          external_integrations!inner(household_id)
        `)
        .eq('external_integrations.household_id', householdId)

      const transformedIntegrationChildren: IntegrationChild[] = (integrationChildrenData || []).map((ic) => {
        // children relation is a single object when joining on child_id
        // Cast through unknown to handle Supabase's array type inference
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
        .eq('external_integrations.household_id', householdId)
        .gt('expires_at', new Date().toISOString())
        .order('taken_at', { ascending: false })
        .limit(50)

      // Filter out pending photos
      const actualPhotos = (photosData || []).filter(
        (photo) => photo.storage_path && !photo.storage_path.startsWith('pending/')
      )

      // Set photos immediately with null URLs (allows UI to render while URLs load)
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
        image_url: null, // Will be populated progressively
      }))

      setPhotos(initialPhotos)

      // Generate signed URLs progressively in background (don't block render)
      // Increment session to invalidate any previous in-flight URL generation
      const currentSession = ++photoGenSessionRef.current

      // Process in batches of 5 for better UX
      const batchSize = 5
      for (let i = 0; i < actualPhotos.length; i += batchSize) {
        // Check if this generation session is still current
        if (photoGenSessionRef.current !== currentSession) {
          break // New loadData called, abandon this batch
        }

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

        // Double-check session before updating state
        if (photoGenSessionRef.current !== currentSession) {
          break // New loadData called, don't update with stale URLs
        }

        // Update photos with new URLs
        setPhotos((prev) =>
          prev.map((p) => {
            const match = urls.find((u) => u.id === p.id)
            return match ? { ...p, image_url: match.url } : p
          })
        )
      }

      // Load reminders (child_tasks)
      const { data: tasksData } = await supabase
        .from('child_tasks')
        .select(`
          *,
          children!inner(name, household_id)
        `)
        .eq('children.household_id', householdId)
        .eq('status', 'open')
        .order('date', { ascending: true })
        .limit(50)

      const transformedReminders: FeedReminder[] = (tasksData || []).map((task) => ({
        id: task.id,
        title: task.title,
        notes: task.notes,
        due_date: task.date,
        completed: task.status === 'done',
        child_id: task.child_id,
        child_name: task.children?.name || null,
        created_at: task.created_at,
      }))

      setReminders(transformedReminders)

      // Load event change notifications (calendar source removals)
      const { data: notificationsData } = await supabase
        .from('event_change_notifications')
        .select('*')
        .eq('household_id', householdId)
        .in('status', ['unread', 'read'])
        .order('created_at', { ascending: false })
        .limit(20)

      setNotifications((notificationsData || []) as EventNotification[])
    } catch (error) {
      console.error('Error loading feed data:', error)
    } finally {
      setLoading(false)
    }
  }, [supabase, householdId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Toggle reminder completion
  const handleToggleReminder = async (id: string, completed: boolean) => {
    // Optimistic update
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, completed } : r))
    )

    const { error } = await supabase
      .from('child_tasks')
      .update({ status: completed ? 'done' : 'open' })
      .eq('id', id)

    if (error) {
      // Rollback
      setReminders((prev) =>
        prev.map((r) => (r.id === id ? { ...r, completed: !completed } : r))
      )
    }
  }

  // Sync all integrations
  const handleSync = async () => {
    // Sync all services in parallel
    await Promise.allSettled([
      fetch('/api/integrations/spond/sync', { method: 'POST' }),
      fetch('/api/integrations/kidplan/sync', { method: 'POST' }),
      fetch('/api/integrations/iskole/sync', { method: 'POST' }),
      fetch('/api/integrations/mykid/sync', { method: 'POST' }),
    ])

    // Run AI extraction on new messages
    await fetch('/api/integrations/extract-actions', { method: 'POST' })

    // Reload data after sync
    await loadData()
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse h-12 rounded-xl" style={{ background: 'var(--background)' }} />
        <div className="animate-pulse h-32 rounded-xl" style={{ background: 'var(--card)' }} />
        <div className="animate-pulse h-32 rounded-xl" style={{ background: 'var(--card)' }} />
        <div className="animate-pulse h-32 rounded-xl" style={{ background: 'var(--card)' }} />
      </div>
    )
  }

  return (
    <FeedPageContent
      messages={messages}
      photos={photos}
      reminders={reminders}
      notifications={notifications}
      integrationChildren={integrationChildren}
      integrationStatuses={integrationStatuses}
      initialFilter={initialFilter}
      onToggleReminder={handleToggleReminder}
      onSync={handleSync}
      onNotificationUpdate={loadData}
      isDemo={false}
    />
  )
}
