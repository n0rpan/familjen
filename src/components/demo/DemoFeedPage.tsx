'use client'

/**
 * DemoFeedPage Component
 *
 * Client-side wrapper that uses demo data hooks and renders
 * the same FeedPageContent component as production.
 * This ensures demo and production are visually identical.
 */

import { useMemo } from 'react'
import { useFeed, useChildren, useTasks } from '@/hooks/data'
import { useLanguage } from '@/lib/i18n/context'
import { FeedPageContent } from '@/components/feed/FeedPageContent'
import type { FeedReminder } from '@/components/feed/ReminderCard'

export function DemoFeedPage() {
  const { t } = useLanguage()
  const { messages, photos, loading, error } = useFeed()
  const { children } = useChildren()
  const { tasks } = useTasks({})

  // Convert childTasks to FeedReminder format
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

  // Show loading state
  if (loading) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.feed}</h1>
          <p style={{ color: 'var(--muted)' }}>
            Meldinger, bilder og varsler fra Spond, barnehage og skole
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

  // Show error state
  if (error) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.feed}</h1>
        </div>
        <div className="card p-8 text-center">
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header mb-6">
        <h1 className="page-title">{t.nav.feed}</h1>
        <p style={{ color: 'var(--muted)' }}>
          Meldinger, bilder og varsler fra Spond, barnehage og skole
        </p>
      </div>

      <FeedPageContent
        messages={messages}
        photos={photos}
        reminders={reminders}
        notifications={[]}
        integrationChildren={[]}
        integrationStatuses={[]}
        initialFilter="all"
        onToggleReminder={() => {}} // No-op in demo
        onSync={async () => {}} // No-op in demo
        isDemo={true}
      />
    </div>
  )
}
