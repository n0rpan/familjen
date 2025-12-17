'use client'

import { useState, useEffect } from 'react'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useLanguage } from '@/lib/i18n/context'
import { createClient } from '@/lib/supabase/client'

interface NotificationPreferences {
  notify_pickup_assigned: boolean
  notify_meal_changed: boolean
  notify_task_added: boolean
  notify_event_affects_me: boolean
}

export function NotificationSettings() {
  const { t } = useLanguage()
  const {
    permission,
    isSubscribed,
    isSupported,
    loading: pushLoading,
    error: pushError,
    subscribe,
    unsubscribe,
  } = usePushNotifications()

  const [preferences, setPreferences] = useState<NotificationPreferences>({
    notify_pickup_assigned: true,
    notify_meal_changed: true,
    notify_task_added: true,
    notify_event_affects_me: true,
  })
  const [saving, setSaving] = useState(false)
  const [testSent, setTestSent] = useState(false)

  const supabase = createClient()

  // Load preferences on mount
  useEffect(() => {
    async function loadPreferences() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('household_members')
        .select('notify_pickup_assigned, notify_meal_changed, notify_task_added, notify_event_affects_me')
        .eq('user_id', user.id)
        .single()

      if (data) {
        setPreferences({
          notify_pickup_assigned: data.notify_pickup_assigned ?? true,
          notify_meal_changed: data.notify_meal_changed ?? true,
          notify_task_added: data.notify_task_added ?? true,
          notify_event_affects_me: data.notify_event_affects_me ?? true,
        })
      }
    }
    loadPreferences()
  }, [supabase])

  // Save preference when changed
  async function updatePreference(key: keyof NotificationPreferences, value: boolean) {
    setPreferences(prev => ({ ...prev, [key]: value }))
    setSaving(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('household_members')
        .update({ [key]: value })
        .eq('user_id', user.id)
    }

    setSaving(false)
  }

  // Handle enable/disable notifications
  async function handleToggleNotifications() {
    if (isSubscribed) {
      await unsubscribe()
    } else {
      await subscribe()
    }
  }

  // Send test notification
  async function sendTestNotification() {
    if (!isSubscribed) return

    try {
      // Send test notification to self (test: true bypasses the "don't notify self" filter)
      await fetch('/api/push/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'meal_changed',
          data: {
            mealName: 'Test middag',
            date: 'i dag',
          },
          test: true,
        }),
      })
      setTestSent(true)
      setTimeout(() => setTestSent(false), 3000)
    } catch (err) {
      console.error('Test notification error:', err)
    }
  }

  // Not supported
  if (!isSupported) {
    return (
      <div className="card p-6">
        <h3 className="text-lg font-semibold mb-2">{t.notifications.title}</h3>
        <div className="p-4 rounded-xl" style={{ background: 'rgba(232, 120, 109, 0.1)' }}>
          <p className="font-medium" style={{ color: 'var(--color-coral)' }}>
            {t.notifications.unsupported}
          </p>
          <p className="text-sm text-[var(--muted)] mt-1">
            {t.notifications.unsupportedDesc}
          </p>
        </div>
      </div>
    )
  }

  // Permission denied
  if (permission === 'denied') {
    return (
      <div className="card p-6">
        <h3 className="text-lg font-semibold mb-2">{t.notifications.title}</h3>
        <div className="p-4 rounded-xl" style={{ background: 'rgba(232, 120, 109, 0.1)' }}>
          <p className="font-medium" style={{ color: 'var(--color-coral)' }}>
            {t.notifications.denied}
          </p>
          <p className="text-sm text-[var(--muted)] mt-1">
            {t.notifications.deniedDesc}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold mb-2">{t.notifications.title}</h3>
      <p className="text-sm text-[var(--muted)] mb-4">{t.notifications.description}</p>

      {/* Enable/Disable toggle */}
      <div className="flex items-center justify-between p-4 rounded-xl mb-4" style={{ background: 'var(--card-alt)' }}>
        <div>
          <p className="font-medium">
            {isSubscribed ? t.notifications.enabled : t.notifications.disabled}
          </p>
          {pushError && (
            <p className="text-sm" style={{ color: 'var(--color-coral)' }}>{pushError}</p>
          )}
        </div>
        <button
          onClick={handleToggleNotifications}
          disabled={pushLoading}
          className="px-4 py-2 rounded-lg font-medium transition-colors"
          style={{
            background: isSubscribed ? 'var(--muted)' : 'var(--color-coral)',
            color: 'white',
            opacity: pushLoading ? 0.7 : 1,
          }}
        >
          {pushLoading ? '...' : (isSubscribed ? t.notifications.disable : t.notifications.enable)}
        </button>
      </div>

      {/* Preferences (only show when subscribed) */}
      {isSubscribed && (
        <>
          <h4 className="font-medium mb-3">{t.notifications.preferences}</h4>
          <p className="text-sm text-[var(--muted)] mb-4">{t.notifications.preferencesDesc}</p>

          <div className="space-y-3">
            {/* Pickup assigned */}
            <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--card-alt)] transition-colors">
              <input
                type="checkbox"
                checked={preferences.notify_pickup_assigned}
                onChange={(e) => updatePreference('notify_pickup_assigned', e.target.checked)}
                className="mt-1 w-5 h-5 rounded"
                style={{ accentColor: 'var(--color-coral)' }}
              />
              <div>
                <p className="font-medium">{t.notifications.pickupAssigned}</p>
                <p className="text-sm text-[var(--muted)]">{t.notifications.pickupAssignedDesc}</p>
              </div>
            </label>

            {/* Meal changed */}
            <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--card-alt)] transition-colors">
              <input
                type="checkbox"
                checked={preferences.notify_meal_changed}
                onChange={(e) => updatePreference('notify_meal_changed', e.target.checked)}
                className="mt-1 w-5 h-5 rounded"
                style={{ accentColor: 'var(--color-coral)' }}
              />
              <div>
                <p className="font-medium">{t.notifications.mealChanged}</p>
                <p className="text-sm text-[var(--muted)]">{t.notifications.mealChangedDesc}</p>
              </div>
            </label>

            {/* Task added */}
            <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--card-alt)] transition-colors">
              <input
                type="checkbox"
                checked={preferences.notify_task_added}
                onChange={(e) => updatePreference('notify_task_added', e.target.checked)}
                className="mt-1 w-5 h-5 rounded"
                style={{ accentColor: 'var(--color-coral)' }}
              />
              <div>
                <p className="font-medium">{t.notifications.taskAdded}</p>
                <p className="text-sm text-[var(--muted)]">{t.notifications.taskAddedDesc}</p>
              </div>
            </label>

            {/* Event affects me */}
            <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--card-alt)] transition-colors">
              <input
                type="checkbox"
                checked={preferences.notify_event_affects_me}
                onChange={(e) => updatePreference('notify_event_affects_me', e.target.checked)}
                className="mt-1 w-5 h-5 rounded"
                style={{ accentColor: 'var(--color-coral)' }}
              />
              <div>
                <p className="font-medium">{t.notifications.eventAffectsMe}</p>
                <p className="text-sm text-[var(--muted)]">{t.notifications.eventAffectsMeDesc}</p>
              </div>
            </label>
          </div>

          {/* Test notification button */}
          <div className="mt-6 pt-4 border-t border-[var(--border)]">
            <button
              onClick={sendTestNotification}
              className="text-sm px-4 py-2 rounded-lg transition-colors"
              style={{ background: 'var(--card-alt)' }}
            >
              {testSent ? t.notifications.testSent : t.notifications.testNotification}
            </button>
          </div>

          {saving && (
            <p className="text-sm text-[var(--muted)] mt-2">{t.common.saving}...</p>
          )}
        </>
      )}
    </div>
  )
}
