/**
 * Feed Data Transformations
 *
 * Shared utilities for transforming feed data from Supabase format
 * (with nested external_integrations) to flat format for UI components.
 *
 * Used by:
 * - FeedPageWrapper (server-rendered data)
 * - FeedDataCache (cached data hydration)
 * - MessageCard (HTML entity decoding)
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

/**
 * Known integration service types.
 * 'unknown' is used as fallback when service data is missing or invalid,
 * displayed with neutral gray styling to avoid misleading users.
 */
export type ServiceType = 'spond' | 'kidplan' | 'iskole' | 'mykid' | 'unknown'

const KNOWN_SERVICES: readonly ServiceType[] = ['spond', 'kidplan', 'iskole', 'mykid'] as const

/**
 * Validate and normalize service type.
 *
 * Returns the service if valid, otherwise returns 'unknown' and logs a warning.
 * Using 'unknown' (not 'spond') as default prevents misleading attribution -
 * if we don't know the source, we shouldn't claim it's from Spond.
 */
function normalizeService(service: unknown, context: string): ServiceType {
  if (typeof service === 'string' && KNOWN_SERVICES.includes(service as ServiceType)) {
    return service as ServiceType
  }

  // Log warning to help debug data issues (missing external_integrations join, etc.)
  // In production, this indicates a data integrity issue that should be investigated
  if (service !== undefined && service !== null) {
    console.warn(`[Feed] Unknown service type "${service}" for ${context}, using 'unknown'`)
  } else {
    // Missing service usually means the external_integrations join failed
    console.warn(`[Feed] Missing service for ${context} - check Supabase query includes external_integrations`)
  }

  return 'unknown'
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
 * Safely transform messages, handling both raw and already-transformed data.
 */
export function safeTransformMessages(data: unknown): FeedMessage[] {
  if (!Array.isArray(data)) return []

  // If data is empty, return empty array
  if (data.length === 0) return []

  // Check if already transformed (has service as string, no nested external_integrations)
  const first = data[0] as Record<string, unknown>
  const isAlreadyTransformed =
    typeof first.service === 'string' &&
    !('external_integrations' in first && first.external_integrations !== null)

  if (isAlreadyTransformed) {
    // Already in FeedMessage format, just cast
    return data as FeedMessage[]
  }

  // Needs transformation from raw Supabase format
  return transformFeedMessages(data as Record<string, unknown>[])
}

/**
 * Safely transform photos, handling both raw and already-transformed data.
 */
export function safeTransformPhotos(data: unknown): FeedPhoto[] {
  if (!Array.isArray(data)) return []

  // If data is empty, return empty array
  if (data.length === 0) return []

  // Check if already transformed (no nested external_integrations or children)
  const first = data[0] as Record<string, unknown>
  const isAlreadyTransformed =
    !('external_integrations' in first && first.external_integrations !== null) &&
    !('children' in first && first.children !== null && typeof (first.children as Record<string, unknown>).name === 'string')

  if (isAlreadyTransformed) {
    // Already in FeedPhoto format, just cast
    return data as FeedPhoto[]
  }

  // Needs transformation from raw Supabase format
  return transformFeedPhotos(data as Record<string, unknown>[])
}

/**
 * Decode HTML entities (e.g., &nbsp; → space, &aring; → å, &oslash; → ø)
 *
 * ## Implementation Notes
 *
 * Uses textarea.innerHTML which is a **safe** and standard technique for HTML entity
 * decoding. This is NOT an XSS vulnerability because:
 *
 * 1. **Textarea is a "raw text element"** - The HTML spec defines <textarea> as a raw
 *    text element that only accepts text content, not HTML markup. Scripts, event
 *    handlers, and HTML tags inside textarea are treated as literal text.
 *
 * 2. **innerHTML assignment triggers entity parsing but not script execution**:
 *    ```js
 *    textarea.innerHTML = '<img src=x onerror=alert(1)>'
 *    // onerror NEVER executes - textarea treats it as literal text
 *    // textarea.value = '<img src=x onerror=alert(1)>' (unchanged)
 *
 *    textarea.innerHTML = '&amp;nbsp;&aring;'
 *    // Entities ARE decoded
 *    // textarea.value = ' å' (decoded correctly)
 *    ```
 *
 * 3. **Why not textContent?** - Using textContent would NOT decode entities:
 *    ```js
 *    textarea.textContent = '&amp;'  // textarea.value = '&amp;' (not decoded!)
 *    textarea.innerHTML = '&amp;'    // textarea.value = '&' (decoded correctly!)
 *    ```
 *
 * ## Singleton Textarea
 *
 * We reuse a single textarea element for performance. This is safe in PWA contexts:
 * - Single small DOM element (~200 bytes)
 * - No event listeners or references that could leak
 * - Automatically garbage collected if module is unloaded
 *
 * @see https://html.spec.whatwg.org/multipage/syntax.html#raw-text-elements
 */
let _textarea: HTMLTextAreaElement | null = null

export function decodeHtmlEntities(html: string): string {
  // Safe for SSR - return unchanged when document is not available
  if (typeof document === 'undefined') return html

  // Reuse textarea element for performance (see documentation above)
  if (!_textarea) {
    _textarea = document.createElement('textarea')
  }

  _textarea.innerHTML = html
  return _textarea.value
}

/**
 * Strip HTML tags and decode entities for plain text display.
 *
 * Used for message previews where we want readable text without formatting.
 */
export function stripHtmlAndDecode(html: string): string {
  // First strip HTML tags (replace with space to preserve word boundaries)
  const stripped = html.replace(/<[^>]*>/g, ' ')
  // Then decode HTML entities
  const decoded = decodeHtmlEntities(stripped)
  // Normalize whitespace
  return decoded.replace(/\s+/g, ' ').trim()
}
