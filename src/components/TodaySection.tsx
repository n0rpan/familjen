'use client'

import { useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TodayOverview } from './TodayOverview'
import { MemberEventModal, HouseholdEventModal, ChildTaskModal, ExternalEventModal } from '@/app/uke/components'
import type { DaySummary, HouseholdEvent, MemberEvent, ExternalEvent, ChildTask, HouseholdMember, Child, ChildTaskType, MemberEventType, ExternalEventLocalOverrides } from '@/lib/types'
import type { Holiday } from '@/lib/utils'
import { useLanguage } from '@/lib/i18n/context'

interface TodaySectionProps {
  summary: DaySummary | null
  holidays?: Holiday[]
  members: HouseholdMember[]
  children: Child[]
  householdId: string
}

export function TodaySection({ summary, holidays = [], members, children, householdId }: TodaySectionProps) {
  const { t } = useLanguage()
  const supabase = useMemo(() => createClient(), [])
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Current summary state (allows updates after modal actions)
  const [currentSummary, setCurrentSummary] = useState(summary)

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

  // Reload data after changes
  const reloadData = useCallback(async () => {
    // Force a refresh by updating the key
    setReloadKey(prev => prev + 1)
    // Note: In a real implementation, you'd want to refetch the summary data
    // For now, we just close the modals - the parent page handles data refresh on navigation
  }, [])

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
    setMemberEventForm({
      member_id: '',
      title: '',
      event_type: 'other',
      date: '',
      end_date: '',
    })
  }, [])

  const saveMemberEvent = useCallback(async () => {
    if (!memberEventForm.member_id || !memberEventForm.title || !memberEventForm.date) return

    setSaving(true)
    try {
      if (editingMemberEvent) {
        await supabase
          .from('member_events')
          .update({
            member_id: memberEventForm.member_id,
            title: memberEventForm.title,
            event_type: memberEventForm.event_type,
            date: memberEventForm.date,
            end_date: memberEventForm.end_date || null,
          })
          .eq('id', editingMemberEvent.id)
      }
      closeMemberEventModal()
      reloadData()
    } catch (err) {
      console.error('Error saving member event:', err)
    } finally {
      setSaving(false)
    }
  }, [editingMemberEvent, memberEventForm, supabase, closeMemberEventModal, reloadData])

  const deleteMemberEvent = useCallback(async () => {
    if (!editingMemberEvent) return

    setSaving(true)
    try {
      await supabase
        .from('member_events')
        .delete()
        .eq('id', editingMemberEvent.id)

      closeMemberEventModal()
      reloadData()
    } catch (err) {
      console.error('Error deleting member event:', err)
    } finally {
      setSaving(false)
    }
  }, [editingMemberEvent, supabase, closeMemberEventModal, reloadData])

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
    setHouseholdEventForm({
      title: '',
      date: '',
      end_date: '',
      time: '',
      location: '',
    })
  }, [])

  const saveHouseholdEvent = useCallback(async () => {
    if (!householdEventForm.title || !householdEventForm.date) return

    // Don't allow editing ICS-synced events
    if (editingHouseholdEvent?.source === 'ics_calendar') {
      return
    }

    setSaving(true)
    try {
      if (editingHouseholdEvent) {
        await supabase
          .from('household_events')
          .update({
            title: householdEventForm.title,
            event_date: householdEventForm.date,
            end_date: householdEventForm.end_date || null,
            event_time: householdEventForm.time ? `${householdEventForm.time}:00` : null,
            location: householdEventForm.location || null,
          })
          .eq('id', editingHouseholdEvent.id)
      }
      closeHouseholdEventModal()
      reloadData()
    } catch (err) {
      console.error('Error saving household event:', err)
    } finally {
      setSaving(false)
    }
  }, [editingHouseholdEvent, householdEventForm, supabase, closeHouseholdEventModal, reloadData])

  const deleteHouseholdEvent = useCallback(async () => {
    if (!editingHouseholdEvent) return

    // Don't allow deleting ICS-synced events
    if (editingHouseholdEvent.source === 'ics_calendar') {
      return
    }

    setSaving(true)
    try {
      await supabase
        .from('household_events')
        .delete()
        .eq('id', editingHouseholdEvent.id)

      closeHouseholdEventModal()
      reloadData()
    } catch (err) {
      console.error('Error deleting household event:', err)
    } finally {
      setSaving(false)
    }
  }, [editingHouseholdEvent, supabase, closeHouseholdEventModal, reloadData])

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
      await supabase
        .from('external_events')
        .update({
          local_overrides: updates.local_overrides,
          user_notes: updates.user_notes,
          is_hidden: updates.is_hidden,
        })
        .eq('id', editingExternalEvent.id)

      closeExternalEventModal()
      reloadData()
    } catch (err) {
      console.error('Error saving external event:', err)
    } finally {
      setSaving(false)
    }
  }, [editingExternalEvent, supabase, closeExternalEventModal, reloadData])

  // Task handlers
  const handleTaskClick = useCallback((task: ChildTask) => {
    setEditingTask(task)
    setTaskForm({
      child_id: task.child_id,
      title: task.title,
      task_type: task.task_type as ChildTaskType,
      date: task.date,
      time: task.time || '',
      notes: task.notes || '',
    })
    setShowTaskModal(true)
  }, [])

  const closeTaskModal = useCallback(() => {
    setShowTaskModal(false)
    setEditingTask(null)
    setTaskForm({
      child_id: '',
      title: '',
      task_type: 'reminder',
      date: '',
      time: '',
      notes: '',
    })
  }, [])

  const saveTask = useCallback(async () => {
    if (!taskForm.child_id || !taskForm.title || !taskForm.date) return

    setSaving(true)
    try {
      if (editingTask) {
        await supabase
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
      }
      closeTaskModal()
      reloadData()
    } catch (err) {
      console.error('Error saving task:', err)
    } finally {
      setSaving(false)
    }
  }, [editingTask, taskForm, supabase, closeTaskModal, reloadData])

  const deleteTask = useCallback(async () => {
    if (!editingTask) return

    setSaving(true)
    try {
      await supabase
        .from('child_tasks')
        .delete()
        .eq('id', editingTask.id)

      closeTaskModal()
      reloadData()
    } catch (err) {
      console.error('Error deleting task:', err)
    } finally {
      setSaving(false)
    }
  }, [editingTask, supabase, closeTaskModal, reloadData])

  return (
    <>
      <TodayOverview
        key={reloadKey}
        summary={currentSummary}
        holidays={holidays}
        onHouseholdEventClick={handleHouseholdEventClick}
        onMemberEventClick={handleMemberEventClick}
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
      />
    </>
  )
}
