'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { WeekGrid } from './WeekGrid'
import { MemberEventModal, HouseholdEventModal, ChildTaskModal, ExternalEventModal } from '@/app/uke/components'
import type {
  Child,
  HouseholdMember,
  PickupWithDetails,
  MealWithRecipe,
  MemberEvent,
  HouseholdEvent,
  ExternalEvent,
  ChildTask,
  ChildTaskType,
  MemberEventType,
  ExternalEventLocalOverrides,
} from '@/lib/types'
import type { Holiday } from '@/lib/utils'
import { useLanguage } from '@/lib/i18n/context'

// Helper to safely extract HH:MM from time string
function formatTimeForForm(time: string | null | undefined): string {
  if (!time) return ''
  // Handle both HH:MM and HH:MM:SS formats
  const match = time.match(/^(\d{2}:\d{2})/)
  return match ? match[1] : ''
}

interface WeekSectionProps {
  children: Child[]
  members: HouseholdMember[]
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
  memberEvents: MemberEvent[]
  householdEvents: HouseholdEvent[]
  externalEvents: ExternalEvent[]
  childTasks: ChildTask[]
  holidays: Holiday[]
  weekStart: Date
  showFromToday?: boolean  // Only show today and upcoming days
}

export function WeekSection({
  children,
  members,
  pickups,
  meals,
  memberEvents,
  householdEvents,
  externalEvents,
  childTasks,
  holidays,
  weekStart,
  showFromToday = false,
}: WeekSectionProps) {
  const { t } = useLanguage()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Clear error after 5 seconds
  const showError = useCallback((message: string) => {
    setError(message)
    setTimeout(() => setError(null), 5000)
  }, [])

  // Member event modal state
  const [showMemberEventModal, setShowMemberEventModal] = useState(false)
  const [editingMemberEvent, setEditingMemberEvent] = useState<MemberEvent | null>(null)
  const [memberEventForm, setMemberEventForm] = useState({
    member_id: '',
    title: '',
    event_type: 'other' as MemberEventType,
    date: '',
    end_date: '',
  })

  // Household event modal state
  const [showHouseholdEventModal, setShowHouseholdEventModal] = useState(false)
  const [editingHouseholdEvent, setEditingHouseholdEvent] = useState<HouseholdEvent | null>(null)
  const [householdEventForm, setHouseholdEventForm] = useState({
    title: '',
    date: '',
    end_date: '',
    time: '',
    location: '',
  })

  // External event modal state
  const [showExternalEventModal, setShowExternalEventModal] = useState(false)
  const [editingExternalEvent, setEditingExternalEvent] = useState<ExternalEvent | null>(null)

  // Child task modal state
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [editingTask, setEditingTask] = useState<ChildTask | null>(null)
  const [taskForm, setTaskForm] = useState({
    child_id: '',
    title: '',
    task_type: 'reminder' as ChildTaskType,
    date: '',
    time: '',
    notes: '',
  })

  // Member event handlers
  const handleMemberEventClick = useCallback((event: MemberEvent) => {
    setEditingMemberEvent(event)
    setMemberEventForm({
      member_id: event.member_id,
      title: event.title,
      event_type: event.event_type as MemberEventType,
      date: event.date,
      end_date: event.end_date || '',
    })
    setShowMemberEventModal(true)
  }, [])

  const closeMemberEventModal = useCallback(() => {
    setShowMemberEventModal(false)
    setEditingMemberEvent(null)
  }, [])

  const saveMemberEvent = useCallback(async () => {
    if (!memberEventForm.member_id || !memberEventForm.title || !memberEventForm.date) return
    setSaving(true)
    try {
      if (editingMemberEvent) {
        const { error: dbError } = await supabase
          .from('member_events')
          .update({
            member_id: memberEventForm.member_id,
            title: memberEventForm.title,
            event_type: memberEventForm.event_type,
            date: memberEventForm.date,
            end_date: memberEventForm.end_date || null,
          })
          .eq('id', editingMemberEvent.id)
        if (dbError) throw dbError
      }
      closeMemberEventModal()
      router.refresh()
    } catch (err) {
      console.error('Error saving member event:', err)
      showError(t.errors.couldNotSaveEvent)
    } finally {
      setSaving(false)
    }
  }, [editingMemberEvent, memberEventForm, supabase, closeMemberEventModal, router, showError, t.errors.couldNotSaveEvent])

  const deleteMemberEvent = useCallback(async () => {
    if (!editingMemberEvent) return
    setSaving(true)
    try {
      const { error: dbError } = await supabase.from('member_events').delete().eq('id', editingMemberEvent.id)
      if (dbError) throw dbError
      closeMemberEventModal()
      router.refresh()
    } catch (err) {
      console.error('Error deleting member event:', err)
      showError(t.errors.deleteFailed)
    } finally {
      setSaving(false)
    }
  }, [editingMemberEvent, supabase, closeMemberEventModal, router, showError, t.errors.deleteFailed])

  // Household event handlers
  const handleHouseholdEventClick = useCallback((event: HouseholdEvent) => {
    setEditingHouseholdEvent(event)
    setHouseholdEventForm({
      title: event.title,
      date: event.event_date,
      end_date: event.end_date || '',
      time: event.event_time?.substring(0, 5) || '',
      location: event.location || '',
    })
    setShowHouseholdEventModal(true)
  }, [])

  const closeHouseholdEventModal = useCallback(() => {
    setShowHouseholdEventModal(false)
    setEditingHouseholdEvent(null)
  }, [])

  const saveHouseholdEvent = useCallback(async () => {
    if (!householdEventForm.title || !householdEventForm.date) return
    if (editingHouseholdEvent?.source === 'ics_calendar') return // Can't edit ICS events
    setSaving(true)
    try {
      if (editingHouseholdEvent) {
        const { error: dbError } = await supabase
          .from('household_events')
          .update({
            title: householdEventForm.title,
            event_date: householdEventForm.date,
            end_date: householdEventForm.end_date || null,
            event_time: householdEventForm.time ? `${householdEventForm.time}:00` : null,
            location: householdEventForm.location || null,
          })
          .eq('id', editingHouseholdEvent.id)
        if (dbError) throw dbError
      }
      closeHouseholdEventModal()
      router.refresh()
    } catch (err) {
      console.error('Error saving household event:', err)
      showError(t.errors.couldNotSaveEvent)
    } finally {
      setSaving(false)
    }
  }, [editingHouseholdEvent, householdEventForm, supabase, closeHouseholdEventModal, router, showError, t.errors.couldNotSaveEvent])

  const deleteHouseholdEvent = useCallback(async () => {
    if (!editingHouseholdEvent) return
    if (editingHouseholdEvent.source === 'ics_calendar') return // Can't delete ICS events
    setSaving(true)
    try {
      const { error: dbError } = await supabase.from('household_events').delete().eq('id', editingHouseholdEvent.id)
      if (dbError) throw dbError
      closeHouseholdEventModal()
      router.refresh()
    } catch (err) {
      console.error('Error deleting household event:', err)
      showError(t.errors.deleteFailed)
    } finally {
      setSaving(false)
    }
  }, [editingHouseholdEvent, supabase, closeHouseholdEventModal, router, showError, t.errors.deleteFailed])

  // External event handlers
  const handleExternalEventClick = useCallback((event: ExternalEvent) => {
    setEditingExternalEvent(event)
    setShowExternalEventModal(true)
  }, [])

  const closeExternalEventModal = useCallback(() => {
    setShowExternalEventModal(false)
    setEditingExternalEvent(null)
  }, [])

  const saveExternalEvent = useCallback(async (updates: {
    local_overrides: ExternalEventLocalOverrides | null
    user_notes: string | null
    is_hidden: boolean
  }) => {
    if (!editingExternalEvent) return
    setSaving(true)
    try {
      const { error: dbError } = await supabase
        .from('external_events')
        .update({
          local_overrides: updates.local_overrides,
          user_notes: updates.user_notes,
          is_hidden: updates.is_hidden,
        })
        .eq('id', editingExternalEvent.id)
      if (dbError) throw dbError
      closeExternalEventModal()
      router.refresh()
    } catch (err) {
      console.error('Error saving external event:', err)
      showError(t.errors.couldNotSaveEvent)
    } finally {
      setSaving(false)
    }
  }, [editingExternalEvent, supabase, closeExternalEventModal, router, showError, t.errors.couldNotSaveEvent])

  // Task handlers
  const handleTaskClick = useCallback((task: ChildTask) => {
    setEditingTask(task)
    setTaskForm({
      child_id: task.child_id,
      title: task.title,
      task_type: task.task_type as ChildTaskType,
      date: task.date,
      time: task.time?.substring(0, 5) || '',
      notes: task.notes || '',
    })
    setShowTaskModal(true)
  }, [])

  const closeTaskModal = useCallback(() => {
    setShowTaskModal(false)
    setEditingTask(null)
  }, [])

  const saveTask = useCallback(async () => {
    if (!taskForm.child_id || !taskForm.title || !taskForm.date) return
    setSaving(true)
    try {
      if (editingTask) {
        const { error: dbError } = await supabase
          .from('child_tasks')
          .update({
            child_id: taskForm.child_id,
            title: taskForm.title,
            task_type: taskForm.task_type,
            date: taskForm.date,
            time: taskForm.time || null,
            notes: taskForm.notes || null,
          })
          .eq('id', editingTask.id)
        if (dbError) throw dbError
      }
      closeTaskModal()
      router.refresh()
    } catch (err) {
      console.error('Error saving task:', err)
      showError(t.errors.couldNotSaveTask)
    } finally {
      setSaving(false)
    }
  }, [editingTask, taskForm, supabase, closeTaskModal, router, showError, t.errors.couldNotSaveTask])

  const deleteTask = useCallback(async () => {
    if (!editingTask) return
    setSaving(true)
    try {
      const { error: dbError } = await supabase.from('child_tasks').delete().eq('id', editingTask.id)
      if (dbError) throw dbError
      closeTaskModal()
      router.refresh()
    } catch (err) {
      console.error('Error deleting task:', err)
      showError(t.errors.deleteFailed)
    } finally {
      setSaving(false)
    }
  }, [editingTask, supabase, closeTaskModal, router, showError, t.errors.deleteFailed])

  const toggleTaskStatus = useCallback(async () => {
    if (!editingTask) return
    setSaving(true)
    try {
      const newStatus = editingTask.status === 'done' ? 'open' : 'done'
      const { error: dbError } = await supabase
        .from('child_tasks')
        .update({ status: newStatus })
        .eq('id', editingTask.id)
      if (dbError) throw dbError
      closeTaskModal()
      router.refresh()
    } catch (err) {
      console.error('Error toggling task status:', err)
      showError(t.errors.couldNotSaveTask)
    } finally {
      setSaving(false)
    }
  }, [editingTask, supabase, closeTaskModal, router, showError, t.errors.couldNotSaveTask])

  return (
    <>
      {/* Error Toast */}
      {error && (
        <div
          className="fixed bottom-24 left-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg animate-fade-in"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--color-coral)',
          }}
          role="alert"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="flex-1 text-sm" style={{ color: 'var(--foreground)' }}>
            {error}
          </p>
          <button
            onClick={() => setError(null)}
            className="shrink-0 p-1 rounded-md transition-colors hover:bg-[var(--sand)]"
            style={{ color: 'var(--muted)' }}
            aria-label={t.common.close}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <WeekGrid
        children={children}
        members={members}
        pickups={pickups}
        meals={meals}
        memberEvents={memberEvents}
        householdEvents={householdEvents}
        externalEvents={externalEvents}
        childTasks={childTasks}
        holidays={holidays}
        weekStart={weekStart}
        showFromToday={showFromToday}
        onEventClick={handleMemberEventClick}
        onHouseholdEventClick={handleHouseholdEventClick}
        onExternalEventClick={handleExternalEventClick}
        onTaskClick={handleTaskClick}
      />

      {/* Member Event Modal */}
      <MemberEventModal
        isOpen={showMemberEventModal}
        editingEvent={editingMemberEvent}
        eventForm={memberEventForm}
        members={members}
        saving={saving}
        t={t}
        onFormChange={setMemberEventForm}
        onSave={saveMemberEvent}
        onDelete={deleteMemberEvent}
        onClose={closeMemberEventModal}
      />

      {/* Household Event Modal */}
      <HouseholdEventModal
        isOpen={showHouseholdEventModal}
        editingEvent={editingHouseholdEvent}
        eventForm={householdEventForm}
        saving={saving}
        t={t}
        onFormChange={setHouseholdEventForm}
        onSave={saveHouseholdEvent}
        onDelete={deleteHouseholdEvent}
        onClose={closeHouseholdEventModal}
      />

      {/* External Event Modal */}
      <ExternalEventModal
        isOpen={showExternalEventModal}
        event={editingExternalEvent}
        saving={saving}
        t={t}
        onSave={saveExternalEvent}
        onClose={closeExternalEventModal}
      />

      {/* Task Modal */}
      <ChildTaskModal
        isOpen={showTaskModal}
        editingTask={editingTask}
        taskForm={taskForm}
        children={children}
        saving={saving}
        t={t}
        onFormChange={setTaskForm}
        onSave={saveTask}
        onDelete={deleteTask}
        onClose={closeTaskModal}
        onToggleStatus={toggleTaskStatus}
      />
    </>
  )
}
