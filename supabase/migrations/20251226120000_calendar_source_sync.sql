-- Migration: Calendar Source Sync Enhancement
-- Adds proper event tracking for external_source_urls (Kalenderkilder)
-- with update/delete detection and removal notifications

-- ============================================================================
-- 1. Extend external_events to support calendar source URLs
-- ============================================================================

-- Add source_url_id column (alternative to integration_id for manual calendar sources)
ALTER TABLE external_events
  ADD COLUMN IF NOT EXISTS source_url_id UUID REFERENCES external_source_urls(id) ON DELETE CASCADE;

-- Add source_event_hash for stable event identification (enables upsert/delete detection)
ALTER TABLE external_events
  ADD COLUMN IF NOT EXISTS source_event_hash TEXT;

-- Make integration_id nullable (it's required for API integrations, but not for source URLs)
ALTER TABLE external_events
  ALTER COLUMN integration_id DROP NOT NULL;

-- Add constraint: must have either integration_id OR source_url_id
ALTER TABLE external_events DROP CONSTRAINT IF EXISTS external_events_source_check;
ALTER TABLE external_events ADD CONSTRAINT external_events_source_check
  CHECK (integration_id IS NOT NULL OR source_url_id IS NOT NULL);

-- Unique index for upserting events from calendar sources
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_events_source_url_hash
  ON external_events(source_url_id, source_event_hash)
  WHERE source_url_id IS NOT NULL AND source_event_hash IS NOT NULL;

-- Index for querying events by source URL
CREATE INDEX IF NOT EXISTS idx_external_events_source_url
  ON external_events(source_url_id)
  WHERE source_url_id IS NOT NULL;

-- ============================================================================
-- 2. Create event_change_notifications table
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_change_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,

  -- What changed
  change_type TEXT NOT NULL CHECK (change_type IN ('removed', 'date_changed', 'title_changed')),

  -- Source info
  source_url_id UUID REFERENCES external_source_urls(id) ON DELETE SET NULL,
  source_name TEXT,  -- Store name in case source is deleted

  -- Original event info (for re-adding)
  original_title TEXT NOT NULL,
  original_date DATE NOT NULL,
  original_end_date DATE,
  original_time TIME,
  original_description TEXT,
  child_id UUID REFERENCES children(id) ON DELETE SET NULL,
  child_name TEXT,  -- Store name in case child is deleted

  -- What was deleted (if a task was linked)
  deleted_task_id UUID,
  deleted_task_type TEXT CHECK (deleted_task_type IN ('child_task', 'event', 'reminder')),
  deleted_task_title TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'restored', 'dismissed')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE event_change_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view/manage notifications for their household
DROP POLICY IF EXISTS "Users can view own household notifications" ON event_change_notifications;
CREATE POLICY "Users can view own household notifications"
  ON event_change_notifications FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Users can update own household notifications" ON event_change_notifications;
CREATE POLICY "Users can update own household notifications"
  ON event_change_notifications FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Users can delete own household notifications" ON event_change_notifications;
CREATE POLICY "Users can delete own household notifications"
  ON event_change_notifications FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- Service role can insert (used by sync process)
DROP POLICY IF EXISTS "Service can insert notifications" ON event_change_notifications;
CREATE POLICY "Service can insert notifications"
  ON event_change_notifications FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Also allow authenticated to insert (for sync via RPC)
DROP POLICY IF EXISTS "Users can insert own household notifications" ON event_change_notifications;
CREATE POLICY "Users can insert own household notifications"
  ON event_change_notifications FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_event_change_notifications_household
  ON event_change_notifications(household_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_change_notifications_unread
  ON event_change_notifications(household_id, created_at DESC)
  WHERE status = 'unread';

-- ============================================================================
-- 3. Link external_suggestions to external_events from source URLs
-- ============================================================================

-- Add column to link suggestions to source URL events
ALTER TABLE external_suggestions
  ADD COLUMN IF NOT EXISTS source_url_event_id UUID REFERENCES external_events(id) ON DELETE CASCADE;

-- Update source check constraint to include source_url_event_id
ALTER TABLE external_suggestions DROP CONSTRAINT IF EXISTS external_suggestions_source_check;
ALTER TABLE external_suggestions ADD CONSTRAINT external_suggestions_source_check
  CHECK (
    -- Integration source (Spond, Kidplan, etc.)
    (integration_id IS NOT NULL AND (source_message_id IS NOT NULL OR source_event_id IS NOT NULL))
    OR
    -- Household ICS source
    (source_household_event_id IS NOT NULL OR source_ics_uid IS NOT NULL)
    OR
    -- External document source (PDF, manual URL)
    source_document_id IS NOT NULL
    OR
    -- Calendar source URL event
    source_url_event_id IS NOT NULL
  );

-- ============================================================================
-- 4. Add linked_task tracking to external_events
-- ============================================================================

-- Track if an event has been converted to a child_task (for deletion notifications)
ALTER TABLE external_events
  ADD COLUMN IF NOT EXISTS linked_task_id UUID REFERENCES child_tasks(id) ON DELETE SET NULL;

-- Index for finding events with linked tasks
CREATE INDEX IF NOT EXISTS idx_external_events_linked_task
  ON external_events(linked_task_id)
  WHERE linked_task_id IS NOT NULL;

-- ============================================================================
-- 5. Function to restore a removed event
-- ============================================================================

CREATE OR REPLACE FUNCTION restore_removed_event(
  p_notification_id UUID,
  p_override_title TEXT DEFAULT NULL,
  p_override_date DATE DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_notification event_change_notifications;
  v_household_id UUID;
  v_task_id UUID;
BEGIN
  -- Get user's household
  SELECT household_id INTO v_household_id
  FROM household_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated or no household';
  END IF;

  -- Get the notification
  SELECT * INTO v_notification
  FROM event_change_notifications
  WHERE id = p_notification_id
    AND household_id = v_household_id;

  IF v_notification IS NULL THEN
    RAISE EXCEPTION 'Notification not found';
  END IF;

  IF v_notification.status = 'restored' THEN
    RAISE EXCEPTION 'Event already restored';
  END IF;

  -- Create a new child_task from the notification data
  INSERT INTO child_tasks (
    household_id,
    child_id,
    date,
    time,
    task_type,
    title,
    notes,
    status
  ) VALUES (
    v_household_id,
    v_notification.child_id,
    COALESCE(p_override_date, v_notification.original_date),
    v_notification.original_time,
    'reminder',  -- Restored events become reminders
    COALESCE(p_override_title, v_notification.original_title),
    COALESCE(v_notification.original_description, 'Gjenopprettet fra ' || COALESCE(v_notification.source_name, 'ekstern kilde')),
    'open'
  )
  RETURNING id INTO v_task_id;

  -- Mark notification as restored
  UPDATE event_change_notifications
  SET status = 'restored',
      updated_at = now()
  WHERE id = p_notification_id;

  RETURN v_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION restore_removed_event(UUID, TEXT, DATE) TO authenticated;

-- ============================================================================
-- 6. Auto-cleanup: Delete old notifications and past suggestions
-- ============================================================================

-- Function to clean up stale data (called by cron)
CREATE OR REPLACE FUNCTION cleanup_stale_calendar_data()
RETURNS TABLE(
  notifications_deleted INT,
  suggestions_deleted INT
) AS $$
DECLARE
  v_notifications_deleted INT;
  v_suggestions_deleted INT;
BEGIN
  -- Delete notifications older than 30 days that are read or dismissed
  DELETE FROM event_change_notifications
  WHERE created_at < now() - INTERVAL '30 days'
    AND status IN ('read', 'dismissed');
  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

  -- Auto-dismiss suggestions for past events (date < today - 1 day buffer)
  UPDATE external_suggestions
  SET status = 'dismissed',
      updated_at = now()
  WHERE status = 'pending'
    AND suggested_date < CURRENT_DATE - INTERVAL '1 day';
  GET DIAGNOSTICS v_suggestions_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_notifications_deleted, v_suggestions_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cleanup_stale_calendar_data() TO service_role;
