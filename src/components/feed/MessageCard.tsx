'use client'

import { useState } from 'react'

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
}

export function MessageCard({ message }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showComments, setShowComments] = useState(false)

  // Extract Spond-specific data from raw_data
  const spondData = message.service === 'spond' && message.raw_data
    ? (message.raw_data as SpondPostRaw)
    : null
  const groupName = spondData?.group?.name || spondData?.subGroup?.name
  const comments = spondData?.comments || []

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return date.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays === 1) {
      return 'I går'
    } else if (diffDays < 7) {
      return date.toLocaleDateString('nb-NO', { weekday: 'long' })
    }
    return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
  }

  // Service badge colors
  const serviceColors: Record<string, { bg: string; text: string; label: string }> = {
    spond: { bg: 'rgba(126, 182, 196, 0.2)', text: 'var(--color-sky)', label: 'Spond' },
    kidplan: { bg: 'rgba(131, 166, 151, 0.2)', text: 'var(--color-sage)', label: 'Kidplan' },
    iskole: { bg: 'rgba(178, 154, 198, 0.2)', text: 'var(--color-lavender)', label: 'iSkole' },
    mykid: { bg: 'rgba(232, 180, 120, 0.2)', text: 'var(--color-honey)', label: 'MyKid' },
  }

  const serviceStyle = serviceColors[message.service] || serviceColors.spond

  // Build badge label: "Service · ChildName" or just "Service"
  const badgeLabel = message.child_name
    ? `${serviceStyle.label} · ${message.child_name}`
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

      {/* Sender */}
      {message.sender_name && (
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
          {expanded ? 'Vis mindre' : 'Les mer'}
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
            {comments.length} {comments.length === 1 ? 'kommentar' : 'kommentarer'}
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
