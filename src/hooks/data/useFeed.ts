'use client'

/**
 * useFeed Hook
 *
 * Abstracts feed data fetching for both demo and production modes.
 * Feed includes messages and photos from external integrations.
 */

import { useState, useEffect, useCallback } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import type { FeedMessage } from '@/components/feed/MessageCard'
import type { FeedPhoto } from '@/components/feed/PhotoGallery'

export interface UseFeedReturn {
  messages: FeedMessage[]
  photos: FeedPhoto[]
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Hook to get feed data (messages and photos from integrations)
 */
export function useFeed(): UseFeedReturn {
  const { isDemo, supabase, demoState } = useDataSource()
  const { household } = useHousehold()

  const [messages, setMessages] = useState<FeedMessage[]>([])
  const [photos, setPhotos] = useState<FeedPhoto[]>([])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setLoading(true)
    setError(null)

    try {
      // Get integration IDs for this household
      const { data: integrations } = await supabase
        .from('external_integrations')
        .select('id')
        .eq('household_id', household.id)

      if (!integrations || integrations.length === 0) {
        setMessages([])
        setPhotos([])
        setLoading(false)
        return
      }

      const integrationIds = integrations.map(i => i.id)

      // Fetch messages and photos in parallel
      const [messagesResult, photosResult] = await Promise.all([
        supabase
          .from('external_messages')
          .select('*')
          .in('integration_id', integrationIds)
          .order('message_date', { ascending: false })
          .limit(50),
        supabase
          .from('external_photos')
          .select('*')
          .in('integration_id', integrationIds)
          .order('taken_at', { ascending: false })
          .limit(50),
      ])

      if (messagesResult.error) throw messagesResult.error
      if (photosResult.error) throw photosResult.error

      setMessages(messagesResult.data || [])
      setPhotos(photosResult.data || [])
    } catch (err) {
      console.error('Error fetching feed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load feed')
    } finally {
      setLoading(false)
    }
  }, [isDemo, supabase, household?.id])

  // Initial fetch for production mode
  useEffect(() => {
    if (!isDemo && household?.id) {
      fetchData()
    }
  }, [isDemo, household?.id, fetchData])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    return {
      messages: demoState.feedMessages,
      photos: demoState.feedPhotos,
      loading: false,
      error: null,
      refetch: () => {}, // No-op in demo
    }
  }

  return {
    messages,
    photos,
    loading,
    error,
    refetch: fetchData,
  }
}
