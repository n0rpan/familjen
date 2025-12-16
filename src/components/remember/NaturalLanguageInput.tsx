'use client'

import { useState, useCallback, useRef } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import type { ParsedReminder } from '@/lib/schemas'
import type { ChildTaskType } from '@/lib/types'
import { getTaskConfig } from '@/lib/colors'

interface NaturalLanguageInputProps {
  onSubmit: (reminder: ParsedReminder) => void
  onCancel?: () => void
  defaultDate?: string
}

export function NaturalLanguageInput({ onSubmit, onCancel, defaultDate }: NaturalLanguageInputProps) {
  const { t } = useLanguage()
  const [input, setInput] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [parsedResults, setParsedResults] = useState<ParsedReminder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const parseInput = useCallback(async (text: string) => {
    if (text.trim().length < 5) {
      setParsedResults([])
      return
    }

    setIsParsing(true)
    setError(null)

    try {
      const response = await fetch('/api/openrouter/parse-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text,
          defaultDate,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Kunne ikke tolke tekst')
      }

      const data = await response.json()
      setParsedResults(data.reminders || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
      setParsedResults([])
    } finally {
      setIsParsing(false)
    }
  }, [defaultDate])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setInput(text)

    // Clear existing debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Debounce the API call
    debounceRef.current = setTimeout(() => {
      parseInput(text)
    }, 500)
  }, [parseInput])

  const handleSubmit = (reminder: ParsedReminder) => {
    onSubmit(reminder)
    // Remove from results
    setParsedResults(prev => prev.filter(r => r !== reminder))
    // Clear input if no more results
    if (parsedResults.length <= 1) {
      setInput('')
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'var(--color-sage)'
    if (confidence >= 0.6) return 'var(--color-honey)'
    return 'var(--color-coral)'
  }

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return t.remember.aiConfidenceHigh
    if (confidence >= 0.6) return t.remember.aiConfidenceMedium
    return t.remember.aiConfidenceLow
  }

  return (
    <div className="space-y-4">
      {/* Input field */}
      <div className="relative">
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          placeholder={t.remember.aiInputPlaceholder}
          className="w-full p-4 rounded-xl text-base resize-none"
          style={{
            background: 'var(--background)',
            border: '2px solid var(--border)',
            color: 'var(--foreground)',
            minHeight: '80px',
          }}
          rows={2}
        />
        {isParsing && (
          <div
            className="absolute right-3 top-3 flex items-center gap-2 px-3 py-1 rounded-full text-sm"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            {t.remember.aiParsing}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div
          className="p-3 rounded-xl text-sm"
          style={{ background: 'rgba(232, 120, 109, 0.1)', color: 'var(--color-coral)' }}
        >
          {error}
        </div>
      )}

      {/* Parsed results */}
      {parsedResults.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
            {t.remember.aiConfirm}:
          </p>
          {parsedResults.map((reminder, index) => {
            const config = getTaskConfig(reminder.task_type as ChildTaskType)
            const isEditing = editingIndex === index

            return (
              <div
                key={index}
                className="p-4 rounded-xl"
                style={{
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                }}
              >
                {isEditing ? (
                  <EditableReminder
                    reminder={reminder}
                    onSave={(updated) => {
                      setParsedResults(prev =>
                        prev.map((r, i) => i === index ? updated : r)
                      )
                      setEditingIndex(null)
                    }}
                    onCancel={() => setEditingIndex(null)}
                    t={t}
                  />
                ) : (
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{config.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                        {reminder.title}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                        {reminder.date && (
                          <span className="flex items-center gap-1">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                              <line x1="16" y1="2" x2="16" y2="6"/>
                              <line x1="8" y1="2" x2="8" y2="6"/>
                              <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            {reminder.date}
                          </span>
                        )}
                        {reminder.time && (
                          <span className="flex items-center gap-1">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"/>
                              <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            {reminder.time}
                          </span>
                        )}
                        {reminder.child_name && (
                          <span className="flex items-center gap-1">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                              <circle cx="12" cy="7" r="4"/>
                            </svg>
                            {reminder.child_name}
                          </span>
                        )}
                      </div>
                      {/* Confidence indicator */}
                      <div className="flex items-center gap-2 mt-2">
                        <div
                          className="h-1.5 rounded-full flex-1 max-w-[100px]"
                          style={{ background: 'var(--border)' }}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.round(reminder.confidence * 100)}%`,
                              background: getConfidenceColor(reminder.confidence),
                            }}
                          />
                        </div>
                        <span className="text-xs" style={{ color: getConfidenceColor(reminder.confidence) }}>
                          {Math.round(reminder.confidence * 100)}% {getConfidenceLabel(reminder.confidence)}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingIndex(index)}
                        className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
                        title={t.remember.aiEdit}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => handleSubmit(reminder)}
                        className="px-4 py-2 rounded-lg font-medium text-sm transition-colors"
                        style={{ background: 'var(--accent)', color: 'white' }}
                      >
                        {t.remember.useThis}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Cancel button */}
      {onCancel && (
        <div className="flex justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--sand)]"
            style={{ color: 'var(--muted)' }}
          >
            {t.common.cancel}
          </button>
        </div>
      )}
    </div>
  )
}

interface EditableReminderProps {
  reminder: ParsedReminder
  onSave: (reminder: ParsedReminder) => void
  onCancel: () => void
  t: ReturnType<typeof useLanguage>['t']
}

function EditableReminder({ reminder, onSave, onCancel, t }: EditableReminderProps) {
  const [title, setTitle] = useState(reminder.title)
  const [date, setDate] = useState(reminder.date || '')
  const [time, setTime] = useState(reminder.time || '')
  const [taskType, setTaskType] = useState(reminder.task_type)

  const taskTypes: ChildTaskType[] = ['bring', 'appointment', 'activity', 'closure', 'reminder', 'other']

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full p-2 rounded-lg text-sm"
        style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
        placeholder={t.remember.reminderTitle}
      />
      <div className="flex gap-2 flex-wrap">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="p-2 rounded-lg text-sm"
          style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="p-2 rounded-lg text-sm"
          style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
        />
        <select
          value={taskType}
          onChange={(e) => setTaskType(e.target.value as ChildTaskType)}
          className="p-2 rounded-lg text-sm"
          style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
        >
          {taskTypes.map((type) => {
            const config = getTaskConfig(type)
            return (
              <option key={type} value={type}>
                {config.icon} {t.remember.taskTypes[type]}
              </option>
            )
          })}
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--sand)]"
          style={{ color: 'var(--muted)' }}
        >
          {t.common.cancel}
        </button>
        <button
          onClick={() => onSave({
            ...reminder,
            title,
            date: date || null,
            time: time || null,
            task_type: taskType,
          })}
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          {t.common.save}
        </button>
      </div>
    </div>
  )
}
