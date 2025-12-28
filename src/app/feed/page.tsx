'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useFeed, useChildren, useTasks } from '@/hooks/data'
import { useLanguage } from '@/lib/i18n/context'
import { FeedPageContent } from '@/components/feed/FeedPageContent'
import type { FeedFilter } from '@/components/feed/FeedFilters'
import type { FeedMessage } from '@/components/feed/MessageCard'
import type { FeedPhoto } from '@/components/feed/PhotoGallery'
import type { FeedReminder } from '@/components/feed/ReminderCard'
import type { EventNotification } from '@/components/feed/EventChangeNotification'
import type { IntegrationStatus } from '@/components/feed/SyncStatusBanner'
import type { IntegrationChild } from '@/components/feed/FeedPageContent'

export default function Feed() {
  const searchParams = useSearchParams()
  const isDemo = searchParams.get('demo') === 'true'
  const serviceFilter = searchParams.get('service')?.toLowerCase()
  const typeFilter = searchParams.get('type')?.toLowerCase()
  const { t } = useLanguage()
  const supabase = useMemo(() => createClient(), [])

  // Demo mode data - hooks auto-detect demo mode via context
  const { messages: demoMessages, photos: demoPhotos, loading: demoLoading, error: demoError } = useFeed()
  const { children: demoChildren } = useChildren()
  const { tasks: demoTasks } = useTasks()

  // Production mode state
  const [loading, setLoading] = useState(!isDemo)
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [integrationsEnabled, setIntegrationsEnabled] = useState(true)
  const [messages, setMessages] = useState<FeedMessage[]>([])
  const [photos, setPhotos] = useState<FeedPhoto[]>([])
  const [reminders, setReminders] = useState<FeedReminder[]>([])
  const [notifications, setNotifications] = useState<EventNotification[]>([])
  const [integrationChildren, setIntegrationChildren] = useState<IntegrationChild[]>([])
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationStatus[]>([])

  // Track photo URL generation session
  const photoGenSessionRef = useRef(0)

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

  // Load production data
  const loadData = useCallback(async () => {
    if (isDemo) return

    setLoading(true)
    try {
      // Check auth
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      // Check household membership
      const { data: myMembership } = await supabase
        .from('household_members')
        .select('id, household_id')
        .eq('user_id', user.id)
        .single()

      if (!myMembership) {
        setLoading(false)
        return
      }

      const hId = myMembership.household_id
      setHouseholdId(hId)

      // Check if integrations are enabled
      const { data: household } = await supabase
        .from('households')
        .select('external_integrations_enabled')
        .eq('id', hId)
        .single()

      if (!household?.external_integrations_enabled) {
        setIntegrationsEnabled(false)
        setLoading(false)
        return
      }

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

      // Load reminders (child_tasks)
      const { data: tasksData } = await supabase
        .from('child_tasks')
        .select(`
          *,
          children!inner(name, household_id)
        `)
        .eq('children.household_id', hId)
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

      // Load event change notifications
      const { data: notificationsData } = await supabase
        .from('event_change_notifications')
        .select('*')
        .eq('household_id', hId)
        .in('status', ['unread', 'read'])
        .order('created_at', { ascending: false })
        .limit(20)

      setNotifications((notificationsData || []) as EventNotification[])
    } catch (error) {
      console.error('Error loading feed data:', error)
    } finally {
      setLoading(false)
    }
  }, [isDemo, supabase])

  useEffect(() => {
    if (!isDemo) {
      loadData()
    }
  }, [isDemo, loadData])

  // Toggle reminder completion (production only)
  const handleToggleReminder = async (id: string, completed: boolean) => {
    if (isDemo) return

    // Optimistic update
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, completed } : r))
    )

    const { error } = await supabase
      .from('child_tasks')
      .update({ status: completed ? 'done' : 'open' })
      .eq('id', id)

    if (error) {
      setReminders((prev) =>
        prev.map((r) => (r.id === id ? { ...r, completed: !completed } : r))
      )
    }
  }

  // Sync all integrations (production only)
  const handleSync = async () => {
    if (isDemo) return

    await Promise.allSettled([
      fetch('/api/integrations/spond/sync', { method: 'POST' }),
      fetch('/api/integrations/kidplan/sync', { method: 'POST' }),
      fetch('/api/integrations/iskole/sync', { method: 'POST' }),
      fetch('/api/integrations/mykid/sync', { method: 'POST' }),
    ])

    await fetch('/api/integrations/extract-actions', { method: 'POST' })
    await loadData()
  }

  // Demo mode: Convert tasks to reminders
  const demoReminders: FeedReminder[] = useMemo(() => {
    return demoTasks
      .filter((task) => task.status === 'open')
      .map((task) => {
        const child = demoChildren.find((c) => c.id === task.child_id)
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
  }, [demoTasks, demoChildren])

  // Demo mode rendering
  if (isDemo) {
    if (demoLoading) {
      return (
        <div className="page-container animate-fade-in">
          <div className="page-header mb-6">
            <h1 className="page-title">{t.nav.feed}</h1>
            <p style={{ color: 'var(--muted)' }}>
              {t.feed.subtitle}
            </p>
          </div>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-xl" />
            ))}
          </div>
        </div>
      )
    }

    if (demoError) {
      return (
        <div className="page-container animate-fade-in">
          <div className="page-header mb-6">
            <h1 className="page-title">{t.nav.feed}</h1>
          </div>
          <div className="card p-8 text-center">
            <p className="text-red-500">{demoError}</p>
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
          messages={demoMessages}
          photos={demoPhotos}
          reminders={demoReminders}
          notifications={[]}
          integrationChildren={[]}
          integrationStatuses={[]}
          initialFilter={initialFilter}
          onToggleReminder={() => {}} // No-op in demo
          onSync={async () => {}} // No-op in demo
          isDemo={true}
        />
      </div>
    )
  }

  // Production mode: Loading state
  if (loading) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.feed}</h1>
          <p style={{ color: 'var(--muted)' }}>
            {t.feed?.subtitle || 'Meldinger, bilder og varsler fra Spond, barnehage og skole'}
          </p>
        </div>
        <div className="space-y-4">
          <div className="animate-pulse h-12 rounded-xl" style={{ background: 'var(--background)' }} />
          <div className="animate-pulse h-32 rounded-xl" style={{ background: 'var(--card)' }} />
          <div className="animate-pulse h-32 rounded-xl" style={{ background: 'var(--card)' }} />
          <div className="animate-pulse h-32 rounded-xl" style={{ background: 'var(--card)' }} />
        </div>
      </div>
    )
  }

  // Production mode: Integrations not enabled
  if (!integrationsEnabled) {
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

  // Production mode: Ready with data
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
        notifications={notifications}
        integrationChildren={integrationChildren}
        integrationStatuses={integrationStatuses}
        initialFilter={initialFilter}
        onToggleReminder={handleToggleReminder}
        onSync={handleSync}
        onNotificationUpdate={loadData}
        isDemo={false}
      />
    </div>
  )
}
