'use client'

import { useState, useEffect, useCallback } from 'react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

export type PushPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported'

export function usePushNotifications() {
  const [permission, setPermission] = useState<PushPermissionState>('prompt')
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check current permission and subscription status
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check if push is supported
    if (!('PushManager' in window) || !('serviceWorker' in navigator)) {
      setPermission('unsupported')
      return
    }

    // Check notification permission
    if ('Notification' in window) {
      setPermission(Notification.permission as PushPermissionState)
    }

    // Check if already subscribed
    navigator.serviceWorker.ready.then(async (registration) => {
      const existingSub = await registration.pushManager.getSubscription()
      setSubscription(existingSub)
    })
  }, [])

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!VAPID_PUBLIC_KEY) {
      setError('Push notifications ikke konfigurert')
      return false
    }

    setLoading(true)
    setError(null)

    try {
      // Request notification permission
      const result = await Notification.requestPermission()
      setPermission(result as PushPermissionState)

      if (result !== 'granted') {
        setError('Tillatelse til varsler ble nektet')
        return false
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready

      // Subscribe to push
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })

      setSubscription(sub)

      // Send subscription to server
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      })

      if (!response.ok) {
        throw new Error('Kunne ikke registrere subscription')
      }

      return true
    } catch (err) {
      console.error('Push subscribe error:', err)
      setError(err instanceof Error ? err.message : 'Kunne ikke aktivere varsler')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    if (!subscription) return true

    setLoading(true)
    setError(null)

    try {
      // Unsubscribe from push manager
      await subscription.unsubscribe()

      // Remove from server
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      })

      setSubscription(null)
      return true
    } catch (err) {
      console.error('Push unsubscribe error:', err)
      setError(err instanceof Error ? err.message : 'Kunne ikke deaktivere varsler')
      return false
    } finally {
      setLoading(false)
    }
  }, [subscription])

  return {
    permission,
    isSubscribed: !!subscription,
    isSupported: permission !== 'unsupported',
    loading,
    error,
    subscribe,
    unsubscribe,
  }
}

// Helper to convert VAPID public key to ArrayBuffer
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray.buffer as ArrayBuffer
}
