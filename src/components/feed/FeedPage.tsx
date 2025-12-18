'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FeedFilters, type FeedFilter } from './FeedFilters'
import { MessageCard, type FeedMessage } from './MessageCard'
import { PhotoGallery, type FeedPhoto } from './PhotoGallery'
import { ReminderCard, type FeedReminder } from './ReminderCard'
import { useLanguage } from '@/lib/i18n/context'

interface Props {
  householdId: string
}

export function FeedPage({ householdId }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const { t } = useLanguage()

  // State
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<FeedFilter>('all')
  const [messages, setMessages] = useState<FeedMessage[]>([])
  const [photos, setPhotos] = useState<FeedPhoto[]>([])
  const [reminders, setReminders] = useState<FeedReminder[]>([])
  const [syncing, setSyncing] = useState(false)

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
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
        service: msg.external_integrations?.service as 'spond' | 'kidplan' | 'iskole',
        child_name: msg.children?.name || null,
        integration_name: msg.external_integrations?.display_name || null,
      }))

      setMessages(transformedMessages)

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

      const transformedPhotos: FeedPhoto[] = (photosData || []).map((photo) => ({
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
      }))

      setPhotos(transformedPhotos)

      // Load reminders (child_tasks with type 'reminder' or household_reminders)
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
    setSyncing(true)
    try {
      // Sync all services in parallel
      const [spondRes, kidplanRes, iskoleRes] = await Promise.allSettled([
        fetch('/api/integrations/spond/sync', { method: 'POST' }),
        fetch('/api/integrations/kidplan/sync', { method: 'POST' }),
        fetch('/api/integrations/iskole/sync', { method: 'POST' }),
      ])

      // Reload data after sync
      await loadData()
    } catch (error) {
      console.error('Sync error:', error)
    } finally {
      setSyncing(false)
    }
  }

  // Calculate filter counts
  const counts = useMemo(() => {
    const spondCount = messages.filter((m) => m.service === 'spond').length
    const schoolCount = messages.filter((m) => m.service === 'iskole').length
    const kindergartenCount = messages.filter((m) => m.service === 'kidplan').length

    return {
      all: messages.length + photos.length + reminders.length,
      spond: spondCount,
      school: schoolCount,
      kindergarten: kindergartenCount,
      photos: photos.length,
      reminders: reminders.length,
    }
  }, [messages, photos, reminders])

  // Filter content based on active filter
  const filteredMessages = useMemo(() => {
    switch (activeFilter) {
      case 'spond':
        return messages.filter((m) => m.service === 'spond')
      case 'school':
        return messages.filter((m) => m.service === 'iskole')
      case 'kindergarten':
        return messages.filter((m) => m.service === 'kidplan')
      case 'photos':
      case 'reminders':
        return []
      default:
        return messages
    }
  }, [messages, activeFilter])

  const showPhotos = activeFilter === 'all' || activeFilter === 'photos'
  const showReminders = activeFilter === 'all' || activeFilter === 'reminders'
  const showMessages = activeFilter !== 'photos' && activeFilter !== 'reminders'

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

  const hasNoContent = messages.length === 0 && photos.length === 0 && reminders.length === 0

  return (
    <div className="space-y-6">
      {/* Header with sync button */}
      <div className="flex items-center justify-between">
        <FeedFilters
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          counts={counts}
        />
        <button
          onClick={handleSync}
          disabled={syncing}
          className="btn btn-secondary text-sm flex-shrink-0 ml-4"
        >
          {syncing ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Synker...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              Oppdater
            </span>
          )}
        </button>
      </div>

      {/* Empty state */}
      {hasNoContent ? (
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
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            Ingen meldinger ennå
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            Koble til Spond, Kidplan eller iSkole i innstillingene for å se meldinger her.
          </p>
        </div>
      ) : (
        <>
          {/* Photos section */}
          {showPhotos && photos.length > 0 && (
            <section>
              {activeFilter === 'all' && (
                <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
                  Siste bilder
                </h2>
              )}
              <PhotoGallery photos={activeFilter === 'all' ? photos.slice(0, 8) : photos} />
              {activeFilter === 'all' && photos.length > 8 && (
                <button
                  onClick={() => setActiveFilter('photos')}
                  className="w-full mt-3 py-2 text-sm font-medium rounded-xl"
                  style={{ color: 'var(--accent)', background: 'var(--background)' }}
                >
                  Se alle {photos.length} bilder
                </button>
              )}
            </section>
          )}

          {/* Reminders section */}
          {showReminders && reminders.length > 0 && (
            <section>
              {activeFilter === 'all' && (
                <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
                  Påminnelser
                </h2>
              )}
              <div className="space-y-2">
                {(activeFilter === 'all' ? reminders.slice(0, 5) : reminders).map((reminder) => (
                  <ReminderCard
                    key={reminder.id}
                    reminder={reminder}
                    onToggle={handleToggleReminder}
                  />
                ))}
              </div>
              {activeFilter === 'all' && reminders.length > 5 && (
                <button
                  onClick={() => setActiveFilter('reminders')}
                  className="w-full mt-3 py-2 text-sm font-medium rounded-xl"
                  style={{ color: 'var(--accent)', background: 'var(--background)' }}
                >
                  Se alle {reminders.length} påminnelser
                </button>
              )}
            </section>
          )}

          {/* Messages section */}
          {showMessages && filteredMessages.length > 0 && (
            <section>
              {activeFilter === 'all' && (
                <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
                  Meldinger
                </h2>
              )}
              <div className="space-y-3">
                {filteredMessages.map((message) => (
                  <MessageCard key={message.id} message={message} />
                ))}
              </div>
            </section>
          )}

          {/* No results for current filter */}
          {!hasNoContent &&
            ((activeFilter === 'photos' && photos.length === 0) ||
              (activeFilter === 'reminders' && reminders.length === 0) ||
              (showMessages && filteredMessages.length === 0)) && (
              <div
                className="p-8 text-center rounded-xl"
                style={{ background: 'var(--background)' }}
              >
                <p style={{ color: 'var(--muted)' }}>
                  Ingen{' '}
                  {activeFilter === 'photos'
                    ? 'bilder'
                    : activeFilter === 'reminders'
                    ? 'påminnelser'
                    : 'meldinger'}{' '}
                  å vise
                </p>
              </div>
            )}
        </>
      )}
    </div>
  )
}
