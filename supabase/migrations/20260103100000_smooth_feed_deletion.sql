-- Migration: Smooth Feed Deletion
-- Improves event restoration and adds batch operations for notifications
-- Events are restored to external_events (child-owned) instead of child_tasks

-- ============================================================================
-- 1. Add restored event support to external_events
-- ============================================================================

-- Add column to mark restored events (won't be deleted on sync)
ALTER TABLE external_events
  ADD COLUMN IF NOT EXISTS is_restored BOOLEAN NOT NULL DEFAULT false;

-- Track which notification the event was restored from
ALTER TABLE external_events
  ADD COLUMN IF NOT EXISTS restored_from_notification_id UUID REFERENCES event_change_notifications(id) ON DELETE SET NULL;

-- Update constraint to allow restored events (no integration_id or source_url_id required)
ALTER TABLE external_events DROP CONSTRAINT IF EXISTS external_events_source_check;
ALTER TABLE external_events ADD CONSTRAINT external_events_source_check
  CHECK (
    integration_id IS NOT NULL
    OR source_url_id IS NOT NULL
    OR is_restored = true
  );

-- Index for finding restored events
CREATE INDEX IF NOT EXISTS idx_external_events_restored
  ON external_events(is_restored)
  WHERE is_restored = true;

-- ============================================================================
-- 2. Update restore_removed_event to create external_events
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
  v_event_id UUID;
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

  -- Create a restored external_event from the notification data
  INSERT INTO external_events (
    child_id,
    external_id,
    title,
    description,
    event_date,
    end_date,
    event_time,
    is_restored,
    restored_from_notification_id,
    user_notes
  ) VALUES (
    v_notification.child_id,
    'restored-' || p_notification_id::text,  -- Unique external_id
    COALESCE(p_override_title, v_notification.original_title),
    v_notification.original_description,
    COALESCE(p_override_date, v_notification.original_date),
    v_notification.original_end_date,
    v_notification.original_time,
    true,  -- Mark as restored
    p_notification_id,
    'Gjenopprettet fra ' || COALESCE(v_notification.source_name, 'ekstern kilde')
  )
  RETURNING id INTO v_event_id;

  -- Mark notification as restored
  UPDATE event_change_notifications
  SET status = 'restored',
      updated_at = now()
  WHERE id = p_notification_id;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. Batch dismiss all notifications
-- ============================================================================

CREATE OR REPLACE FUNCTION dismiss_all_notifications(
  p_household_id UUID DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
  v_household_id UUID;
  v_count INT;
BEGIN
  -- Get user's household if not provided
  IF p_household_id IS NULL THEN
    SELECT household_id INTO v_household_id
    FROM household_members
    WHERE user_id = auth.uid()
    LIMIT 1;
  ELSE
    v_household_id := p_household_id;
  END IF;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated or no household';
  END IF;

  -- Verify user belongs to this household
  IF NOT EXISTS (
    SELECT 1 FROM household_members
    WHERE user_id = auth.uid() AND household_id = v_household_id
  ) THEN
    RAISE EXCEPTION 'Not authorized for this household';
  END IF;

  -- Dismiss all unread/read notifications
  UPDATE event_change_notifications
  SET status = 'dismissed',
      updated_at = now()
  WHERE household_id = v_household_id
    AND status IN ('unread', 'read');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION dismiss_all_notifications(UUID) TO authenticated;

-- ============================================================================
-- 4. Batch restore all notifications
-- ============================================================================

CREATE OR REPLACE FUNCTION restore_all_notifications(
  p_household_id UUID DEFAULT NULL
)
RETURNS TABLE(
  restored_count INT,
  event_ids UUID[]
) AS $$
DECLARE
  v_household_id UUID;
  v_notification RECORD;
  v_event_id UUID;
  v_event_ids UUID[] := ARRAY[]::UUID[];
  v_count INT := 0;
BEGIN
  -- Get user's household if not provided
  IF p_household_id IS NULL THEN
    SELECT household_id INTO v_household_id
    FROM household_members
    WHERE user_id = auth.uid()
    LIMIT 1;
  ELSE
    v_household_id := p_household_id;
  END IF;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated or no household';
  END IF;

  -- Verify user belongs to this household
  IF NOT EXISTS (
    SELECT 1 FROM household_members
    WHERE user_id = auth.uid() AND household_id = v_household_id
  ) THEN
    RAISE EXCEPTION 'Not authorized for this household';
  END IF;

  -- Loop through all active notifications and restore them
  FOR v_notification IN
    SELECT * FROM event_change_notifications
    WHERE household_id = v_household_id
      AND status IN ('unread', 'read')
    ORDER BY created_at ASC
  LOOP
    -- Create restored external_event
    INSERT INTO external_events (
      child_id,
      external_id,
      title,
      description,
      event_date,
      end_date,
      event_time,
      is_restored,
      restored_from_notification_id,
      user_notes
    ) VALUES (
      v_notification.child_id,
      'restored-' || v_notification.id::text,
      v_notification.original_title,
      v_notification.original_description,
      v_notification.original_date,
      v_notification.original_end_date,
      v_notification.original_time,
      true,
      v_notification.id,
      'Gjenopprettet fra ' || COALESCE(v_notification.source_name, 'ekstern kilde')
    )
    RETURNING id INTO v_event_id;

    v_event_ids := array_append(v_event_ids, v_event_id);

    -- Mark notification as restored
    UPDATE event_change_notifications
    SET status = 'restored',
        updated_at = now()
    WHERE id = v_notification.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count, v_event_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION restore_all_notifications(UUID) TO authenticated;

-- ============================================================================
-- 5. Update RLS policies for restored events
-- ============================================================================

-- Restored events should be viewable by household members
-- The existing RLS policy on external_events checks integration/source ownership
-- We need to add a policy for restored events

-- First, check if the household owns the restored event
CREATE OR REPLACE FUNCTION is_restored_event_owner(p_event_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_household_id UUID;
  v_event_child_household UUID;
BEGIN
  -- Get user's household
  SELECT household_id INTO v_household_id
  FROM household_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_household_id IS NULL THEN
    RETURN false;
  END IF;

  -- Check if the event's child belongs to the user's household
  SELECT c.household_id INTO v_event_child_household
  FROM external_events e
  JOIN children c ON c.id = e.child_id
  WHERE e.id = p_event_id
    AND e.is_restored = true;

  RETURN v_event_child_household = v_household_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate external_events policies to include restored events
-- (Keeping existing policies, just ensuring restored events are covered)

-- Policy for viewing restored events
DROP POLICY IF EXISTS "View restored events" ON external_events;
CREATE POLICY "View restored events"
  ON external_events FOR SELECT
  TO authenticated
  USING (
    is_restored = true
    AND is_restored_event_owner(id)
  );

-- Policy for updating restored events
DROP POLICY IF EXISTS "Update restored events" ON external_events;
CREATE POLICY "Update restored events"
  ON external_events FOR UPDATE
  TO authenticated
  USING (
    is_restored = true
    AND is_restored_event_owner(id)
  );

-- Policy for deleting restored events
DROP POLICY IF EXISTS "Delete restored events" ON external_events;
CREATE POLICY "Delete restored events"
  ON external_events FOR DELETE
  TO authenticated
  USING (
    is_restored = true
    AND is_restored_event_owner(id)
  );

-- Policy for inserting restored events (via RPC, but also direct for completeness)
DROP POLICY IF EXISTS "Insert restored events" ON external_events;
CREATE POLICY "Insert restored events"
  ON external_events FOR INSERT
  TO authenticated
  WITH CHECK (
    is_restored = true
    AND child_id IN (
      SELECT c.id FROM children c
      WHERE c.household_id = get_user_household_id()
    )
  );
