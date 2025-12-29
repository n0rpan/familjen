'use client'

import { memo, useEffect } from 'react'
import type { Child, ChildTask, ChildTaskType } from '@/lib/types'
import type { TranslationStrings } from '@/lib/i18n/types'

interface ChildTaskModalProps {
  isOpen: boolean
  editingTask: ChildTask | null
  taskForm: {
    child_id: string
    title: string
    task_type: ChildTaskType
    date: string
    time: string
    notes: string
  }
  children: Child[]
  saving: boolean
  t: TranslationStrings
  onFormChange: (form: ChildTaskModalProps['taskForm']) => void
  onSave: () => void
  onDelete: () => void
  onClose: () => void
  onToggleStatus?: () => void
}

export const ChildTaskModal = memo(function ChildTaskModal({
  isOpen,
  editingTask,
  taskForm,
  children,
  saving,
  t,
  onFormChange,
  onSave,
  onDelete,
  onClose,
  onToggleStatus,
}: ChildTaskModalProps) {
  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const taskTypes = [
    { value: 'bring', icon: '🎒', label: t.week.taskTypes.bring },
    { value: 'appointment', icon: '🩺', label: t.week.taskTypes.appointment },
    { value: 'activity', icon: '⚽', label: t.week.taskTypes.activity },
    { value: 'closure', icon: '🏫', label: t.week.taskTypes.closure },
    { value: 'reminder', icon: '📝', label: t.week.taskTypes.reminder },
    { value: 'other', icon: '📌', label: t.week.taskTypes.other },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="child-task-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0, 0, 0, 0.5)' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - fixed */}
        <div className="flex items-center justify-between p-6 pb-0">
          <h3
            id="child-task-modal-title"
            className="text-lg font-semibold"
            style={{ color: 'var(--foreground)' }}
          >
            {editingTask ? t.week.editTask : t.week.addTask}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--muted)' }}
            aria-label={t.common.close}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Child selector */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
              {t.week.selectChild}
            </label>
            <select
              value={taskForm.child_id}
              onChange={(e) => onFormChange({ ...taskForm, child_id: e.target.value })}
              className="input"
            >
              <option value="">{t.week.selectChild}...</option>
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
              {t.week.taskTitle}
            </label>
            <input
              type="text"
              value={taskForm.title}
              onChange={(e) => onFormChange({ ...taskForm, title: e.target.value })}
              placeholder={t.week.taskTitle}
              maxLength={100}
              className="input"
            />
          </div>

          {/* Task type */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
              {t.week.taskType}
            </label>
            <div className="flex gap-2 flex-wrap">
              {taskTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => onFormChange({ ...taskForm, task_type: type.value as ChildTaskType })}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1"
                  style={{
                    background: taskForm.task_type === type.value ? 'rgba(229, 185, 94, 0.2)' : 'var(--background)',
                    border: taskForm.task_type === type.value ? '2px solid var(--color-honey)' : '2px solid var(--border)',
                    transform: taskForm.task_type === type.value ? 'scale(1.05)' : undefined,
                  }}
                >
                  <span>{type.icon}</span>
                  <span>{type.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                {t.week.startDate}
              </label>
              <input
                type="date"
                value={taskForm.date}
                onChange={(e) => onFormChange({ ...taskForm, date: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                {t.week.taskTime} <span style={{ color: 'var(--muted)' }}>({t.common.optional})</span>
              </label>
              <input
                type="time"
                value={taskForm.time}
                onChange={(e) => onFormChange({ ...taskForm, time: e.target.value })}
                className="input"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
              {t.week.taskNotes} <span style={{ color: 'var(--muted)' }}>({t.common.optional})</span>
            </label>
            <textarea
              value={taskForm.notes}
              onChange={(e) => onFormChange({ ...taskForm, notes: e.target.value })}
              placeholder={t.week.taskNotes}
              className="input"
              rows={2}
            />
          </div>

          {/* Toggle status button (for editing existing tasks) */}
          {editingTask && onToggleStatus && (
            <button
              onClick={onToggleStatus}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-medium transition-colors"
              style={{
                background: editingTask.status === 'done' ? 'rgba(229, 185, 94, 0.15)' : 'rgba(131, 166, 151, 0.15)',
                color: editingTask.status === 'done' ? 'var(--color-honey)' : 'var(--color-sage)',
              }}
            >
              {editingTask.status === 'done' ? (
                <>
                  <span>↩️</span>
                  <span>{t.week.markUndone}</span>
                </>
              ) : (
                <>
                  <span>✓</span>
                  <span>{t.week.markDone}</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Footer - sticky actions */}
        <div
          className="flex items-center justify-between p-6 pt-4 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            {editingTask && (
              <button
                onClick={onDelete}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ color: 'var(--color-coral)' }}
              >
                {t.common.delete}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="btn btn-secondary"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={onSave}
              disabled={saving || !taskForm.child_id || !taskForm.title || !taskForm.date}
              className="btn btn-primary"
            >
              {saving ? t.common.loading : t.common.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
