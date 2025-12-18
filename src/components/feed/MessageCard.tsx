'use client'

import { useState } from 'react'

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
  service: 'spond' | 'kidplan' | 'iskole'
  child_name?: string | null
  integration_name?: string | null
}

interface Props {
  message: FeedMessage
}

export function MessageCard({ message }: Props) {
  const [expanded, setExpanded] = useState(false)

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
    kidplan: { bg: 'rgba(131, 166, 151, 0.2)', text: 'var(--color-sage)', label: 'Barnehage' },
    iskole: { bg: 'rgba(178, 154, 198, 0.2)', text: 'var(--color-lavender)', label: 'Skole' },
  }

  const serviceStyle = serviceColors[message.service] || serviceColors.spond

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
            {serviceStyle.label}
          </span>
          {message.child_name && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {message.child_name}
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
    </div>
  )
}
