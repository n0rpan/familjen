'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'

interface Change {
  id: string
  created_at: string
  table_name: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  new_data: Record<string, unknown> | null
  old_data: Record<string, unknown> | null
}

interface RecentChangesProps {
  householdId: string
  weekStart: Date
  weekEnd: Date
}

export function RecentChanges({ householdId, weekStart, weekEnd }: RecentChangesProps) {
  const { t } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
  const [changes, setChanges] = useState<Change[]>([])
  const [loading, setLoading] = useState(false)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!isOpen) return

    const fetchChanges = async () => {
      setLoading(true)
      try {
        // Get changes from the last 24 hours for relevant tables
        const since = new Date()
        since.setHours(since.getHours() - 24)

        const { data } = await supabase
          .from('audit_log')
          .select('id, created_at, table_name, action, new_data, old_data')
          .eq('household_id', householdId)
          .in('table_name', ['pickups', 'meals', 'child_tasks', 'member_events'])
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(20)

        setChanges(data || [])
      } catch (err) {
        console.error('Error fetching changes:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchChanges()
  }, [isOpen, householdId, supabase])

  const getChangeIcon = (tableName: string) => {
    switch (tableName) {
      case 'pickups':
        return '👤'
      case 'meals':
        return '🍽️'
      case 'child_tasks':
        return '✅'
      case 'member_events':
        return '📅'
      default:
        return '📝'
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'INSERT':
        return 'var(--color-sage)'
      case 'UPDATE':
        return 'var(--color-honey)'
      case 'DELETE':
        return 'var(--color-coral)'
      default:
        return 'var(--muted)'
    }
  }

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'INSERT':
        return t.admin?.actionCreated || 'Created'
      case 'UPDATE':
        return t.admin?.actionUpdated || 'Updated'
      case 'DELETE':
        return t.admin?.actionDeleted || 'Deleted'
      default:
        return action
    }
  }

  const getEntityName = (tableName: string) => {
    switch (tableName) {
      case 'pickups':
        return t.admin?.entityPickup || 'Pickup'
      case 'meals':
        return t.admin?.entityMeal || 'Meal'
      case 'child_tasks':
        return t.week?.editTask?.replace('Rediger ', '') || 'Task'
      case 'member_events':
        return t.week?.editEvent?.replace('Rediger ', '') || 'Event'
      default:
        return tableName
    }
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return date.toLocaleDateString()
  }

  const getChangeSummary = (change: Change) => {
    const data = change.new_data || change.old_data
    if (!data) return ''

    if (change.table_name === 'meals') {
      return (data.custom_meal as string) || 'Meal'
    }
    if (change.table_name === 'child_tasks') {
      return (data.title as string) || 'Task'
    }
    if (change.table_name === 'member_events') {
      return (data.title as string) || 'Event'
    }
    if (change.table_name === 'pickups') {
      return (data.date as string) || 'Pickup'
    }
    return ''
  }

  if (changes.length === 0 && !isOpen) {
    return null
  }

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-[var(--sand)]"
        style={{ color: 'var(--muted)' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        {t.admin?.latestChanges || 'Recent changes'}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="mt-2 rounded-xl p-4 space-y-2"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          {loading ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
              <div className="w-4 h-4 border-2 border-[var(--sand)] border-t-[var(--accent)] rounded-full animate-spin" />
              {t.common?.loading || 'Loading...'}
            </div>
          ) : changes.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {t.admin?.noActivityYet || 'No recent changes'}
            </p>
          ) : (
            changes.map((change) => (
              <div
                key={change.id}
                className="flex items-center gap-3 py-2 border-b last:border-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <span className="text-lg">{getChangeIcon(change.table_name)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: `${getActionColor(change.action)}20`, color: getActionColor(change.action) }}
                    >
                      {getActionLabel(change.action)}
                    </span>
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                      {getEntityName(change.table_name)}
                    </span>
                  </div>
                  {getChangeSummary(change) && (
                    <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                      {getChangeSummary(change)}
                    </p>
                  )}
                </div>
                <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                  {formatTime(change.created_at)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
