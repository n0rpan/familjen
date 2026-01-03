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

-- Index for tracing restoration history (debugging and future features)
CREATE INDEX IF NOT EXISTS idx_external_events_restored_notification
  ON external_events(restored_from_notification_id)
  WHERE restored_from_notification_id IS NOT NULL;

-- ============================================================================
-- 2. Update restore_removed_event to create external_events
-- ============================================================================

CREATE OR REPLACE FUNCTION restore_removed_event(
  p_notification_id UUID,
  p_override_title TEXT DEFAULT NULL,
  p_override_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ============================================================================
-- 3. Batch dismiss all notifications
-- ============================================================================

CREATE OR REPLACE FUNCTION dismiss_all_notifications(
  p_household_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION dismiss_all_notifications(UUID) TO authenticated;

-- ============================================================================
-- 4. Batch restore all notifications (set-based, not loop)
-- ============================================================================

CREATE OR REPLACE FUNCTION restore_all_notifications(
  p_household_id UUID DEFAULT NULL
)
RETURNS TABLE(
  restored_count INT,
  event_ids UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id UUID;
  v_event_ids UUID[];
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

  -- Set-based INSERT: Create all restored events at once
  WITH inserted_events AS (
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
    )
    SELECT
      n.child_id,
      'restored-' || n.id::text,
      n.original_title,
      n.original_description,
      n.original_date,
      n.original_end_date,
      n.original_time,
      true,
      n.id,
      'Gjenopprettet fra ' || COALESCE(n.source_name, 'ekstern kilde')
    FROM event_change_notifications n
    WHERE n.household_id = v_household_id
      AND n.status IN ('unread', 'read')
    RETURNING id, restored_from_notification_id
  )
  SELECT array_agg(id), count(*)::INT
  INTO v_event_ids, v_count
  FROM inserted_events;

  -- Set-based UPDATE: Mark all notifications as restored at once
  UPDATE event_change_notifications
  SET status = 'restored',
      updated_at = now()
  WHERE household_id = v_household_id
    AND status IN ('unread', 'read');

  -- Handle case where no notifications were restored
  IF v_count IS NULL THEN
    v_count := 0;
    v_event_ids := ARRAY[]::UUID[];
  END IF;

  RETURN QUERY SELECT v_count, v_event_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION restore_all_notifications(UUID) TO authenticated;

-- ============================================================================
-- 5. Update RLS policies for restored events
-- ============================================================================

-- Restored events should be viewable by household members
-- Use direct join instead of function call for better performance

-- Drop and recreate external_events policies to include restored events
-- (Keeping existing policies, just ensuring restored events are covered)

-- Policy for viewing restored events (uses direct join for performance)
DROP POLICY IF EXISTS "View restored events" ON external_events;
CREATE POLICY "View restored events"
  ON external_events FOR SELECT
  TO authenticated
  USING (
    is_restored = true
    AND child_id IN (
      SELECT c.id FROM children c
      JOIN household_members hm ON hm.household_id = c.household_id
      WHERE hm.user_id = auth.uid()
    )
  );

-- Policy for updating restored events
DROP POLICY IF EXISTS "Update restored events" ON external_events;
CREATE POLICY "Update restored events"
  ON external_events FOR UPDATE
  TO authenticated
  USING (
    is_restored = true
    AND child_id IN (
      SELECT c.id FROM children c
      JOIN household_members hm ON hm.household_id = c.household_id
      WHERE hm.user_id = auth.uid()
    )
  );

-- Policy for deleting restored events
DROP POLICY IF EXISTS "Delete restored events" ON external_events;
CREATE POLICY "Delete restored events"
  ON external_events FOR DELETE
  TO authenticated
  USING (
    is_restored = true
    AND child_id IN (
      SELECT c.id FROM children c
      JOIN household_members hm ON hm.household_id = c.household_id
      WHERE hm.user_id = auth.uid()
    )
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

-- Drop the now-unused is_restored_event_owner function
DROP FUNCTION IF EXISTS is_restored_event_owner(UUID);
