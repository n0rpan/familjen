'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import type { Child } from '@/lib/types'

interface ExternalSuggestion {
  id: string
  household_id: string
  integration_id: string
  source_message_id: string | null
  suggested_type: 'task' | 'event' | 'reminder'
  suggested_child_id: string | null
  suggested_date: string | null
  suggested_time: string | null
  suggested_title: string
  suggested_description: string | null
  confidence_score: number | null
  status: 'pending' | 'accepted' | 'dismissed'
  created_at: string
  // Joined data
  source_message?: {
    body: string
    sender_name: string | null
    message_date: string
  } | null
  integration?: {
    service: string
    display_name: string
  } | null
}

interface SuggestionReviewProps {
  householdId: string
  children: Child[]
  onSuggestionAccepted?: () => void
}

/**
 * Banner component showing pending suggestion count.
 */
export function SuggestionBanner({
  householdId,
  children,
  onSuggestionAccepted,
}: SuggestionReviewProps) {
  const { t } = useLanguage()
  const [pendingCount, setPendingCount] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)

  const supabase = useMemo(() => createClient(), [])

  // Fetch pending suggestions count
  const fetchCount = useCallback(async () => {
    const { count } = await supabase
      .from('external_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId)
      .eq('status', 'pending')

    setPendingCount(count || 0)
    setLoading(false)
  }, [supabase, householdId])

  useEffect(() => {
    fetchCount()
  }, [fetchCount])

  const handleModalClose = () => {
    setShowModal(false)
    fetchCount()
    onSuggestionAccepted?.()
  }

  if (loading || pendingCount === 0) {
    return null
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="w-full flex items-center gap-3 p-4 rounded-xl transition-all hover:scale-[1.01]"
        style={{
          background: 'linear-gradient(135deg, rgba(126, 182, 196, 0.15) 0%, rgba(167, 139, 250, 0.15) 100%)',
          border: '1px solid rgba(126, 182, 196, 0.3)',
        }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--color-sky)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 10 10.5v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
            <path d="M10 22h4"/>
            <path d="M10 18h4v4h-4z"/>
          </svg>
        </div>
        <div className="flex-1 text-left">
          <div className="font-medium" style={{ color: 'var(--foreground)' }}>
            {pendingCount} {pendingCount === 1 ? t.week.suggestion : t.week.suggestions}
          </div>
          <div className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.week.reviewSuggestions}
          </div>
        </div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      {showModal && (
        <SuggestionReviewModal
          householdId={householdId}
          children={children}
          onClose={handleModalClose}
        />
      )}
    </>
  )
}

/**
 * Modal for reviewing suggestions one by one.
 */
function SuggestionReviewModal({
  householdId,
  children,
  onClose,
}: {
  householdId: string
  children: Child[]
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [suggestions, setSuggestions] = useState<ExternalSuggestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    title: '',
    date: '',
    time: '',
    child_id: '',
    type: 'task' as 'task' | 'event' | 'reminder',
  })

  const supabase = useMemo(() => createClient(), [])

  // Fetch pending suggestions
  useEffect(() => {
    const fetchSuggestions = async () => {
      const { data } = await supabase
        .from('external_suggestions')
        .select(`
          *,
          source_message:external_messages(body, sender_name, message_date),
          integration:external_integrations(service, display_name)
        `)
        .eq('household_id', householdId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(20)

      setSuggestions(data || [])
      setLoading(false)

      // Initialize edit form with first suggestion
      if (data && data.length > 0) {
        initEditForm(data[0])
      }
    }

    fetchSuggestions()
  }, [supabase, householdId])

  const initEditForm = (suggestion: ExternalSuggestion) => {
    setEditForm({
      title: suggestion.suggested_title,
      date: suggestion.suggested_date || '',
      time: suggestion.suggested_time || '',
      child_id: suggestion.suggested_child_id || children[0]?.id || '',
      type: suggestion.suggested_type,
    })
    setEditMode(false)
  }

  const currentSuggestion = suggestions[currentIndex]
  const remaining = suggestions.length - currentIndex

  const handleAccept = async () => {
    if (!currentSuggestion) return
    setSaving(true)

    try {
      // Call the accept_suggestion RPC function
      const { error } = await supabase.rpc('accept_suggestion', {
        p_suggestion_id: currentSuggestion.id,
        p_title: editForm.title,
        p_date: editForm.date || null,
        p_time: editForm.time || null,
        p_child_id: editForm.child_id || null,
        p_type: editForm.type,
      })

      if (error) {
        console.error('Error accepting suggestion:', error)
        return
      }

      // Move to next suggestion
      moveToNext()
    } catch (err) {
      console.error('Error accepting suggestion:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDismiss = async () => {
    if (!currentSuggestion) return
    setSaving(true)

    try {
      const { error } = await supabase.rpc('dismiss_suggestion', {
        p_suggestion_id: currentSuggestion.id,
      })

      if (error) {
        console.error('Error dismissing suggestion:', error)
        return
      }

      // Move to next suggestion
      moveToNext()
    } catch (err) {
      console.error('Error dismissing suggestion:', err)
    } finally {
      setSaving(false)
    }
  }

  const moveToNext = () => {
    // Remove current from list
    const newSuggestions = suggestions.filter((_, i) => i !== currentIndex)
    setSuggestions(newSuggestions)

    if (newSuggestions.length === 0) {
      onClose()
      return
    }

    // Stay at same index (which now shows next item)
    const nextIndex = Math.min(currentIndex, newSuggestions.length - 1)
    setCurrentIndex(nextIndex)
    initEditForm(newSuggestions[nextIndex])
  }

  const handleSkip = () => {
    if (currentIndex < suggestions.length - 1) {
      setCurrentIndex(currentIndex + 1)
      initEditForm(suggestions[currentIndex + 1])
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'task': return '🎒'
      case 'event': return '📅'
      case 'reminder': return '📝'
      default: return '📌'
    }
  }

  const getConfidenceColor = (score: number | null) => {
    if (!score) return 'var(--muted)'
    if (score >= 0.8) return 'var(--color-sage)'
    if (score >= 0.5) return 'var(--color-honey)'
    return 'var(--color-coral)'
  }

  const getServiceBadge = (service: string | undefined) => {
    switch (service?.toLowerCase()) {
      case 'spond': return 'Spond'
      case 'kidplan': return 'Kidplan'
      case 'iskole': return 'iSkole'
      default: return 'Ekstern'
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0" style={{ background: 'rgba(0, 0, 0, 0.5)' }} />
        <div
          className="relative w-full max-w-lg rounded-2xl p-6"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-center py-8">
            <svg className="animate-spin h-8 w-8" style={{ color: 'var(--accent)' }} viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        </div>
      </div>
    )
  }

  if (!currentSuggestion) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0" style={{ background: 'rgba(0, 0, 0, 0.5)' }} onClick={onClose} />
        <div
          className="relative w-full max-w-lg rounded-2xl p-6 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div className="py-8">
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
              style={{ background: 'rgba(131, 166, 151, 0.15)' }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
              {t.week.noMoreSuggestions}
            </h3>
            <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
              {t.week.allSuggestionsReviewed}
            </p>
            <button onClick={onClose} className="btn btn-primary">
              {t.common.close}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0, 0, 0, 0.5)' }} onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-2xl overflow-hidden animate-fade-in"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <span
              className="px-2 py-1 rounded text-xs font-medium"
              style={{ background: 'var(--color-sky)', color: 'white' }}
            >
              {getServiceBadge(currentSuggestion.integration?.service)}
            </span>
            <span className="text-sm" style={{ color: 'var(--muted)' }}>
              {remaining} {remaining === 1 ? t.week.remaining : t.week.remaining}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Source message */}
        {currentSuggestion.source_message && (
          <div className="px-6 py-4" style={{ background: 'var(--background)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                {t.week.originalMessage}
              </span>
              {currentSuggestion.source_message.sender_name && (
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  fra {currentSuggestion.source_message.sender_name}
                </span>
              )}
            </div>
            <p
              className="text-sm p-3 rounded-lg"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
            >
              {currentSuggestion.source_message.body.length > 300
                ? currentSuggestion.source_message.body.substring(0, 300) + '...'
                : currentSuggestion.source_message.body}
            </p>
          </div>
        )}

        {/* Suggestion content */}
        <div className="px-6 py-4 space-y-4">
          {/* AI Suggestion header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{getTypeIcon(currentSuggestion.suggested_type)}</span>
              <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                {t.week.aiSuggestion}
              </span>
            </div>
            {currentSuggestion.confidence_score !== null && (
              <div className="flex items-center gap-1">
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {t.week.confidence}:
                </span>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded"
                  style={{
                    background: `${getConfidenceColor(currentSuggestion.confidence_score)}20`,
                    color: getConfidenceColor(currentSuggestion.confidence_score),
                  }}
                >
                  {Math.round((currentSuggestion.confidence_score || 0) * 100)}%
                </span>
              </div>
            )}
          </div>

          {editMode ? (
            /* Edit form */
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                  {t.week.taskTitle}
                </label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="input text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                    {t.week.startDate}
                  </label>
                  <input
                    type="date"
                    value={editForm.date}
                    onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                    className="input text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                    {t.week.taskTime}
                  </label>
                  <input
                    type="time"
                    value={editForm.time}
                    onChange={(e) => setEditForm({ ...editForm, time: e.target.value })}
                    className="input text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                  {t.week.selectChild}
                </label>
                <select
                  value={editForm.child_id}
                  onChange={(e) => setEditForm({ ...editForm, child_id: e.target.value })}
                  className="input text-sm"
                >
                  {children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                  {t.week.taskType}
                </label>
                <div className="flex gap-2">
                  {['task', 'event', 'reminder'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setEditForm({ ...editForm, type: type as typeof editForm.type })}
                      className="flex-1 px-3 py-2 rounded-lg text-sm transition-colors"
                      style={{
                        background: editForm.type === type ? 'var(--accent)' : 'var(--background)',
                        color: editForm.type === type ? 'white' : 'var(--foreground)',
                        border: `1px solid ${editForm.type === type ? 'var(--accent)' : 'var(--border)'}`,
                      }}
                    >
                      {getTypeIcon(type)} {type === 'task' ? t.week.taskTypes.bring : type === 'event' ? t.home.event : t.week.taskTypes.reminder}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Display view */
            <div
              className="p-4 rounded-xl"
              style={{
                background: 'rgba(126, 182, 196, 0.1)',
                border: '1px solid rgba(126, 182, 196, 0.2)',
              }}
            >
              <h4 className="font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                {currentSuggestion.suggested_title}
              </h4>
              {currentSuggestion.suggested_description && (
                <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
                  {currentSuggestion.suggested_description}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {currentSuggestion.suggested_date && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                    style={{ background: 'var(--background)', color: 'var(--foreground)' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    {new Date(currentSuggestion.suggested_date).toLocaleDateString('nb-NO', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                )}
                {currentSuggestion.suggested_time && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                    style={{ background: 'var(--background)', color: 'var(--foreground)' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    {currentSuggestion.suggested_time.substring(0, 5)}
                  </span>
                )}
                {currentSuggestion.suggested_child_id && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                    style={{ background: 'var(--background)', color: 'var(--foreground)' }}
                  >
                    {children.find(c => c.id === currentSuggestion.suggested_child_id)?.name || 'Barn'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-2 px-6 py-4"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <button
            onClick={handleDismiss}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
            style={{ color: 'var(--color-coral)' }}
          >
            {t.common.dismiss}
          </button>

          <div className="flex-1" />

          {suggestions.length > 1 && currentIndex < suggestions.length - 1 && (
            <button
              onClick={handleSkip}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
              style={{ color: 'var(--muted)' }}
            >
              {t.common.skip}
            </button>
          )}

          {!editMode ? (
            <>
              <button
                onClick={() => {
                  initEditForm(currentSuggestion)
                  setEditMode(true)
                }}
                disabled={saving}
                className="btn btn-secondary"
              >
                {t.common.edit}
              </button>
              <button
                onClick={handleAccept}
                disabled={saving}
                className="btn btn-primary"
              >
                {saving ? t.common.loading : t.common.accept}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditMode(false)}
                disabled={saving}
                className="btn btn-secondary"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleAccept}
                disabled={saving || !editForm.title}
                className="btn btn-primary"
              >
                {saving ? t.common.loading : t.common.save}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
