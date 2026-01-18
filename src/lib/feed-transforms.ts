/**
 * Feed Data Transformations
 *
 * Shared utilities for transforming feed data from Supabase format
 * (with nested external_integrations) to flat format for UI components.
 *
 * Used by:
 * - FeedPageWrapper (server-rendered data)
 * - FeedDataCache (cached data)
 * - useFeed hook (client-fetched data)
 */

import type { FeedMessage } from '@/components/feed/MessageCard'
import type { FeedPhoto } from '@/components/feed/PhotoGallery'

/**
 * Raw message format from Supabase query with joined external_integrations
 */
export interface RawFeedMessage {
  id: string
  integration_id: string
  child_id: string | null
  external_id: string
  sender_name: string | null
  title: string | null
  body: string
  message_date: string
  source_type?: string
  raw_data?: unknown
  external_integrations?: {
    service: string
    display_name: string
    household_id: string
  }
  children?: {
    name: string
  } | null
}

/**
 * Raw photo format from Supabase query with joined external_integrations
 */
export interface RawFeedPhoto {
  id: string
  integration_id: string
  child_id: string | null
  external_id: string
  title: string | null
  taken_at: string
  storage_path: string
  width?: number
  height?: number
  file_size?: number
  expires_at?: string
  raw_data?: unknown
  external_integrations?: {
    service: string
    display_name: string
    household_id: string
  }
  children?: {
    name: string
  } | null
}

type ServiceType = 'spond' | 'kidplan' | 'iskole' | 'mykid'

/**
 * Validate and normalize service type
 * Returns the service if valid, logs warning and returns 'spond' if not
 */
function normalizeService(service: unknown, context: string): ServiceType {
  const validServices: ServiceType[] = ['spond', 'kidplan', 'iskole', 'mykid']

  if (typeof service === 'string' && validServices.includes(service as ServiceType)) {
    return service as ServiceType
  }

  // Log warning in development to help debug data issues
  if (process.env.NODE_ENV === 'development' && service !== undefined) {
    console.warn(`[Feed] Unknown service type "${service}" for ${context}, defaulting to 'spond'`)
  }

  return 'spond'
}

/**
 * Transform a raw Supabase message to the flat FeedMessage format
 */
export function transformFeedMessage(raw: Record<string, unknown>): FeedMessage {
  const integrations = raw.external_integrations as RawFeedMessage['external_integrations']
  const children = raw.children as RawFeedMessage['children']

  return {
    id: raw.id as string,
    integration_id: raw.integration_id as string,
    child_id: raw.child_id as string | null,
    external_id: raw.external_id as string,
    sender_name: raw.sender_name as string | null,
    title: raw.title as string | null,
    body: raw.body as string,
    message_date: raw.message_date as string,
    source_type: (raw.source_type as string) || 'message',
    service: normalizeService(integrations?.service, `message ${raw.id}`),
    child_name: children?.name || null,
    integration_name: integrations?.display_name || null,
    raw_data: raw.raw_data,
  }
}

/**
 * Transform a raw Supabase photo to the flat FeedPhoto format
 */
export function transformFeedPhoto(raw: Record<string, unknown>): FeedPhoto {
  const children = raw.children as RawFeedPhoto['children']

  return {
    id: raw.id as string,
    integration_id: raw.integration_id as string,
    child_id: raw.child_id as string | null,
    external_id: raw.external_id as string,
    title: raw.title as string | null,
    taken_at: (raw.taken_at as string) || null,
    storage_path: raw.storage_path as string,
    thumbnail_path: (raw.thumbnail_path as string) || null,
    child_name: children?.name || null,
    // image_url is populated later via signed URL generation
    image_url: raw.image_url as string | undefined,
  }
}

/**
 * Transform an array of raw messages
 */
export function transformFeedMessages(rawMessages: Record<string, unknown>[]): FeedMessage[] {
  return rawMessages.map(transformFeedMessage)
}

/**
 * Transform an array of raw photos
 */
export function transformFeedPhotos(rawPhotos: Record<string, unknown>[]): FeedPhoto[] {
  return rawPhotos.map(transformFeedPhoto)
}

/**
 * Decode HTML entities (e.g., &nbsp; → space, &aring; → å)
 *
 * Uses a reusable textarea element to avoid creating DOM elements on each call.
 * Safe for SSR - returns input unchanged when document is not available.
 */
let _textarea: HTMLTextAreaElement | null = null

export function decodeHtmlEntities(html: string): string {
  if (typeof document === 'undefined') return html

  // Reuse textarea element for performance
  if (!_textarea) {
    _textarea = document.createElement('textarea')
  }

  _textarea.innerHTML = html
  return _textarea.value
}

/**
 * Strip HTML tags and decode entities for plain text display
 */
export function stripHtmlAndDecode(html: string): string {
  const stripped = html.replace(/<[^>]*>/g, ' ')
  const decoded = decodeHtmlEntities(stripped)
  return decoded.replace(/\s+/g, ' ').trim()
}
