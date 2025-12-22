'use client'

import { useState, useCallback, memo } from 'react'
import { useLanguage } from '@/lib/i18n/context'

interface SourceReference {
  messageId: string
  excerpt: string
  date: string
  service: string
  senderName: string | null
}

interface AskResponse {
  answer: string
  sources: SourceReference[]
  noRelevantInfo: boolean
}

interface FeedSearchProps {
  /** Compact mode for home page placement */
  compact?: boolean
}

export const FeedSearch = memo(function FeedSearch({ compact = false }: FeedSearchProps) {
  const { t, language } = useLanguage()
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<AskResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim() || loading) return

    setLoading(true)
    setError(null)
    setResponse(null)

    try {
      const res = await fetch('/api/feed/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), language }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to process question')
      }

      const data: AskResponse = await res.json()
      setResponse(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [question, loading, language])

  const handleClear = useCallback(() => {
    setResponse(null)
    setError(null)
    setQuestion('')
  }, [])

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString(language === 'en' ? 'en-GB' : language === 'sv' ? 'sv-SE' : 'nb-NO', {
      day: 'numeric',
      month: 'short',
    })
  }

  const getServiceLabel = (service: string) => {
    switch (service) {
      case 'spond': return 'Spond'
      case 'iskole': return 'iSkole'
      case 'kidplan': return 'Kidplan'
      case 'mykid': return 'MyKid'
      default: return service
    }
  }

  return (
    <div
      className={`rounded-2xl ${compact ? 'p-4' : 'p-5'}`}
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Search form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={compact ? t.feed.askPlaceholderShort : t.feed.askPlaceholder}
            disabled={loading}
            className="w-full px-4 py-3 rounded-xl text-sm"
            style={{
              background: 'var(--background)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
          />
          {loading && (
            <div
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--muted)' }}
            >
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={!question.trim() || loading}
          className="btn btn-primary px-4 py-3 rounded-xl text-sm font-medium flex-shrink-0"
          style={{ opacity: !question.trim() || loading ? 0.5 : 1 }}
        >
          {loading ? t.feed.asking : t.feed.askButton}
        </button>
      </form>

      {/* Error message */}
      {error && (
        <div
          className="mt-4 p-4 rounded-xl text-sm"
          style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-red)' }}
        >
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={handleClear}
              className="text-sm font-medium hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              {t.feed.tryAgain}
            </button>
          </div>
        </div>
      )}

      {/* Response */}
      {response && (
        <div className="mt-4 space-y-4">
          {/* Answer */}
          <div
            className="p-4 rounded-xl"
            style={{ background: 'rgba(126, 182, 196, 0.1)', border: '1px solid rgba(126, 182, 196, 0.2)' }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(126, 182, 196, 0.2)' }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-sky)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-sky)' }}>
                  {t.feed.answerTitle}
                </p>
                <p
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ color: 'var(--foreground)' }}
                >
                  {response.answer}
                </p>
              </div>
            </div>
          </div>

          {/* Sources */}
          {response.sources.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                {t.feed.sourceTitle}
              </p>
              {response.sources.map((source, index) => (
                <div
                  key={`${source.messageId}-${index}`}
                  className="p-3 rounded-xl text-xs"
                  style={{ background: 'var(--background)' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
                    >
                      {getServiceLabel(source.service)}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>
                      {formatDate(source.date)}
                    </span>
                    {source.senderName && (
                      <>
                        <span style={{ color: 'var(--muted)' }}>·</span>
                        <span style={{ color: 'var(--muted)' }}>
                          {t.feed.sourceFrom} {source.senderName}
                        </span>
                      </>
                    )}
                  </div>
                  <p
                    className="text-xs leading-relaxed"
                    style={{ color: 'var(--foreground)', opacity: 0.8 }}
                  >
                    {source.excerpt}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Clear button */}
          <button
            onClick={handleClear}
            className="w-full py-2 text-sm font-medium rounded-xl"
            style={{ color: 'var(--muted)', background: 'var(--background)' }}
          >
            {t.feed.clearAnswer}
          </button>
        </div>
      )}
    </div>
  )
})
