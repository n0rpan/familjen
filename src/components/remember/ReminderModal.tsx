'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import { getTaskConfig } from '@/lib/colors'
import type { Child, HouseholdMember, ChildTaskType, ReminderCategory, ReminderPriority, RecurrencePattern } from '@/lib/types'

type ReminderType = 'child' | 'household'

interface ReminderModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: ChildTaskFormData | HouseholdReminderFormData) => Promise<void>
  type: ReminderType
  children: Child[]
  members: HouseholdMember[]
  initialData?: ChildTaskFormData | HouseholdReminderFormData
}

export interface ChildTaskFormData {
  type: 'child'
  id?: string
  child_id: string
  date: string
  time: string | null
  task_type: ChildTaskType
  title: string
  notes: string | null
  recurrence_pattern: RecurrencePattern | null
}

export interface HouseholdReminderFormData {
  type: 'household'
  id?: string
  date: string
  time: string | null
  title: string
  notes: string | null
  category: ReminderCategory
  priority: ReminderPriority
  assigned_to: string | null
  recurrence_pattern: RecurrencePattern | null
}

export function ReminderModal({
  isOpen,
  onClose,
  onSave,
  type,
  children,
  members,
  initialData,
}: ReminderModalProps) {
  const { t } = useLanguage()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reminderType, setReminderType] = useState<ReminderType>(initialData?.type || type)

  // Form state for child tasks
  const [childId, setChildId] = useState<string>('')
  const [taskType, setTaskType] = useState<ChildTaskType>('reminder')

  // Form state for household reminders
  const [category, setCategory] = useState<ReminderCategory>('other')
  const [priority, setPriority] = useState<ReminderPriority>('normal')
  const [assignedTo, setAssignedTo] = useState<string | null>(null)

  // Shared form state
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [showRecurrence, setShowRecurrence] = useState(false)
  const [recurrenceType, setRecurrenceType] = useState<'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'>('weekly')

  // Reset form when modal opens/closes or initialData changes
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setReminderType(initialData.type)
        setDate(initialData.date)
        setTime(initialData.time || '')
        setTitle(initialData.title)
        setNotes(initialData.notes || '')
        setShowRecurrence(!!initialData.recurrence_pattern)
        if (initialData.recurrence_pattern) {
          setRecurrenceType(initialData.recurrence_pattern.type)
        }

        if (initialData.type === 'child') {
          const childData = initialData as ChildTaskFormData
          setChildId(childData.child_id)
          setTaskType(childData.task_type)
        } else {
          const householdData = initialData as HouseholdReminderFormData
          setCategory(householdData.category)
          setPriority(householdData.priority)
          setAssignedTo(householdData.assigned_to)
        }
      } else {
        // Default values for new reminder
        setReminderType(type)
        setDate(new Date().toISOString().split('T')[0])
        setTime('')
        setTitle('')
        setNotes('')
        setShowRecurrence(false)
        setChildId(children[0]?.id || '')
        setTaskType('reminder')
        setCategory('other')
        setPriority('normal')
        setAssignedTo(null)
      }
      setError(null)
    }
  }, [isOpen, initialData, type, children])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError(t.errors.invalidInput)
      return
    }

    setSaving(true)
    setError(null)

    try {
      const recurrence: RecurrencePattern | null = showRecurrence
        ? { type: recurrenceType }
        : null

      if (reminderType === 'child') {
        if (!childId) {
          setError(t.errors.invalidInput)
          setSaving(false)
          return
        }
        const data: ChildTaskFormData = {
          type: 'child',
          id: (initialData as ChildTaskFormData)?.id,
          child_id: childId,
          date,
          time: time || null,
          task_type: taskType,
          title: title.trim(),
          notes: notes.trim() || null,
          recurrence_pattern: recurrence,
        }
        await onSave(data)
      } else {
        const data: HouseholdReminderFormData = {
          type: 'household',
          id: (initialData as HouseholdReminderFormData)?.id,
          date,
          time: time || null,
          title: title.trim(),
          notes: notes.trim() || null,
          category,
          priority,
          assigned_to: assignedTo,
          recurrence_pattern: recurrence,
        }
        await onSave(data)
      }
      onClose()
    } catch {
      setError(t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const taskTypes: ChildTaskType[] = ['bring', 'appointment', 'activity', 'closure', 'reminder', 'other']
  const categories: ReminderCategory[] = ['bill', 'insurance', 'car', 'home', 'health', 'subscription', 'other']
  const priorities: ReminderPriority[] = ['low', 'normal', 'high']

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-2xl p-6 max-h-[85vh] overflow-y-auto my-auto"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {initialData ? t.remember.editReminder : t.remember.addReminder}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type toggle (only for new reminders) */}
          {!initialData && children.length > 0 && (
            <div className="flex gap-2 p-1 rounded-xl" style={{ background: 'var(--background)' }}>
              <button
                type="button"
                onClick={() => setReminderType('child')}
                className="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: reminderType === 'child' ? 'var(--accent)' : 'transparent',
                  color: reminderType === 'child' ? 'white' : 'var(--muted)',
                }}
              >
                {t.home.task}
              </button>
              <button
                type="button"
                onClick={() => setReminderType('household')}
                className="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: reminderType === 'household' ? 'var(--accent)' : 'transparent',
                  color: reminderType === 'household' ? 'white' : 'var(--muted)',
                }}
              >
                {t.remember.remindersTab}
              </button>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.remember.reminderTitle} *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-3 rounded-xl"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              placeholder={reminderType === 'child' ? t.week.taskTitle : t.remember.reminderTitle}
              required
            />
          </div>

          {/* Child selector (for child tasks) */}
          {reminderType === 'child' && children.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                {t.week.selectChild} *
              </label>
              <select
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className="w-full p-3 rounded-xl"
                style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                required
              >
                <option value="">{t.week.selectChild}</option>
                {children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Task type (for child tasks) */}
          {reminderType === 'child' && (
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                {t.week.taskType}
              </label>
              <div className="flex flex-wrap gap-2">
                {taskTypes.map((type) => {
                  const config = getTaskConfig(type)
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setTaskType(type)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                      style={{
                        background: taskType === type ? 'var(--accent)' : 'var(--background)',
                        color: taskType === type ? 'white' : 'var(--foreground)',
                        border: taskType === type ? 'none' : '1px solid var(--border)',
                      }}
                    >
                      <span>{config.icon}</span>
                      {t.remember.taskTypes[type]}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Category (for household reminders) */}
          {reminderType === 'household' && (
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                {t.remember.reminderCategory}
              </label>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{
                      background: category === cat ? 'var(--accent)' : 'var(--background)',
                      color: category === cat ? 'white' : 'var(--foreground)',
                      border: category === cat ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {t.remember.categories[cat]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                {t.remember.reminderDate} *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full p-3 rounded-xl"
                style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                {t.remember.reminderTime}
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full p-3 rounded-xl"
                style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              />
            </div>
          </div>

          {/* Priority (for household reminders) */}
          {reminderType === 'household' && (
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                {t.remember.reminderPriority}
              </label>
              <div className="flex gap-2">
                {priorities.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                    style={{
                      background: priority === p ? (
                        p === 'high' ? 'var(--color-coral)' :
                          p === 'low' ? 'var(--color-sage)' : 'var(--accent)'
                      ) : 'var(--background)',
                      color: priority === p ? 'white' : 'var(--foreground)',
                      border: priority === p ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {t.remember.priorities[p]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Assign to (for household reminders) */}
          {reminderType === 'household' && members.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                {t.remember.assignTo}
              </label>
              <select
                value={assignedTo || ''}
                onChange={(e) => setAssignedTo(e.target.value || null)}
                className="w-full p-3 rounded-xl"
                style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              >
                <option value="">{t.remember.unassigned}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Recurrence toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowRecurrence(!showRecurrence)}
              className="flex items-center gap-2 text-sm font-medium"
              style={{ color: 'var(--accent)' }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ transform: showRecurrence ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {t.remember.recurring}
            </button>

            {showRecurrence && (
              <div className="mt-3 p-3 rounded-xl" style={{ background: 'var(--background)' }}>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                  {t.remember.recurrencePattern}
                </label>
                <div className="flex flex-wrap gap-2">
                  {(['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] as const).map((rec) => (
                    <button
                      key={rec}
                      type="button"
                      onClick={() => setRecurrenceType(rec)}
                      className="px-3 py-1.5 rounded-lg text-sm transition-colors"
                      style={{
                        background: recurrenceType === rec ? 'var(--accent)' : 'transparent',
                        color: recurrenceType === rec ? 'white' : 'var(--muted)',
                        border: recurrenceType === rec ? 'none' : '1px solid var(--border)',
                      }}
                    >
                      {t.remember[rec]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.remember.reminderNotes}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-3 rounded-xl resize-none"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              rows={3}
              placeholder={t.week.taskNotes}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              className="p-3 rounded-xl text-sm"
              style={{ background: 'rgba(232, 120, 109, 0.1)', color: 'var(--color-coral)' }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl font-medium transition-colors hover:bg-[var(--sand)]"
              style={{ color: 'var(--muted)' }}
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 px-4 rounded-xl font-medium transition-opacity disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              {saving ? t.common.saving : t.common.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
