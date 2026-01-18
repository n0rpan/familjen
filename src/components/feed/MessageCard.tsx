'use client'

import { useState, useMemo } from 'react'
import type { IntegrationChild } from './FeedPageContent'
import { useLanguage } from '@/lib/i18n/context'
import { getLocale, formatDateShort } from '@/lib/utils'

// Spond comment structure from raw_data
interface SpondComment {
  id: string
  text: string
  timestamp: string
  sender?: {
    id: string
    firstName: string
    lastName: string
  }
}

// Spond post raw_data structure (partial)
interface SpondPostRaw {
  group?: { id: string; name: string }
  subGroup?: { id: string; name: string }
  comments?: SpondComment[]
  // Chat metadata added during sync for personal messages
  _chatName?: string
  _chatType?: string
  _isPersonalChat?: boolean
}

export interface FeedMessage {
  id: string
  integration_id: string
  child_id: string | null
  external_id: string
  sender_name: string | null
  title: string | null
  body: string
  message_date: string
  source_type: string
  service: 'spond' | 'kidplan' | 'iskole' | 'mykid'
  child_name?: string | null
  integration_name?: string | null
  raw_data?: unknown
}

interface Props {
  message: FeedMessage
  integrationChildren?: IntegrationChild[]
}

export function MessageCard({ message, integrationChildren = [] }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const { t, language } = useLanguage()

  // Extract Spond-specific data from raw_data
  const spondData = message.service === 'spond' && message.raw_data
    ? (message.raw_data as SpondPostRaw)
    : null
  const spondGroupName = spondData?.group?.name || spondData?.subGroup?.name
  const comments = spondData?.comments || []

  // For personal/direct messages, use chat name as context
  const isPersonalChat = spondData?._isPersonalChat || spondData?._chatType === 'personal'
  const chatName = spondData?._chatName

  // Get children and group name for this integration
  const integrationContext = useMemo(() => {
    // If message already has child_name from direct relation, use that
    if (message.child_name) {
      return { childNames: [message.child_name], groupName: null }
    }

    // Otherwise, look up children mapped to this integration
    const childrenForIntegration = integrationChildren.filter(
      (ic) => ic.integrationId === message.integration_id
    )

    if (childrenForIntegration.length === 0) {
      return { childNames: [], groupName: null }
    }

    // Get unique child names and group name
    const childNames = [...new Set(childrenForIntegration.map((ic) => ic.childName).filter(Boolean))]
    // Use the first non-null group name (typically same for all children in same integration)
    const groupName = childrenForIntegration.find((ic) => ic.groupName)?.groupName || null

    return { childNames, groupName }
  }, [message.integration_id, message.child_name, integrationChildren])

  // Combine group names from Spond raw_data and integration mapping
  // For personal chats, show "Conversation with [name]" instead of just the name
  const groupName = isPersonalChat && chatName
    ? t.feed.conversationWith.replace('{name}', chatName)
    : (spondGroupName || integrationContext.groupName)

  // Format date with localization
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return date.toLocaleTimeString(getLocale(language), { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays === 1) {
      return t.common.yesterday
    } else if (diffDays < 7) {
      return date.toLocaleDateString(getLocale(language), { weekday: 'long' })
    }
    return formatDateShort(dateStr, language)
  }

  // Service badge colors
  const serviceColors: Record<string, { bg: string; text: string; label: string }> = {
    spond: { bg: 'rgba(126, 182, 196, 0.2)', text: 'var(--color-sky)', label: 'Spond' },
    kidplan: { bg: 'rgba(131, 166, 151, 0.2)', text: 'var(--color-sage)', label: 'Kidplan' },
    iskole: { bg: 'rgba(178, 154, 198, 0.2)', text: 'var(--color-lavender)', label: 'iSkole' },
    mykid: { bg: 'rgba(232, 180, 120, 0.2)', text: 'var(--color-honey)', label: 'MyKid' },
  }

  const serviceStyle = serviceColors[message.service] || serviceColors.spond

  // Build badge label with child names from integration context
  const childNamesDisplay = integrationContext.childNames.length > 0
    ? integrationContext.childNames.join(', ')
    : null

  // For personal messages, add direct message indicator
  const badgeLabel = isPersonalChat
    ? `${serviceStyle.label} · ${t.feed.directMessage}`
    : childNamesDisplay
      ? `${serviceStyle.label} · ${childNamesDisplay}`
      : serviceStyle.label

  // Strip HTML tags for preview
  const stripHtml = (html: string) => {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  const plainBody = stripHtml(message.body)
  const isLong = plainBody.length > 200
  const displayBody = expanded || !isLong ? plainBody : plainBody.substring(0, 200) + '...'

  return (
    <div
      className="p-4 rounded-xl transition-all"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: serviceStyle.bg, color: serviceStyle.text }}
          >
            {badgeLabel}
          </span>
          {groupName && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {groupName}
            </span>
          )}
        </div>
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--muted)' }}>
          {formatDate(message.message_date)}
        </span>
      </div>

      {/* Sender - hide for personal chats since we can't reliably know who sent each message */}
      {message.sender_name && !isPersonalChat && (
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
          {message.sender_name}
        </p>
      )}

      {/* Title */}
      {message.title && (
        <h3 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
          {message.title}
        </h3>
      )}

      {/* Body */}
      <p className="text-sm leading-relaxed" style={{ color: 'var(--foreground)' }}>
        {displayBody}
      </p>

      {/* Expand button */}
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm mt-2 font-medium"
          style={{ color: 'var(--accent)' }}
        >
          {expanded ? t.feed.showLess : t.feed.readMore}
        </button>
      )}

      {/* Comments section (Spond only) */}
      {comments.length > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setShowComments(!showComments)}
            className="text-sm font-medium flex items-center gap-1"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {comments.length} {comments.length === 1 ? t.feed.comment : t.feed.comments}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${showComments ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showComments && (
            <div className="mt-3 space-y-3">
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className="pl-3 py-2"
                  style={{ borderLeft: '2px solid var(--border)' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {comment.sender?.firstName} {comment.sender?.lastName}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      {formatDate(comment.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--foreground)' }}>
                    {comment.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
