-- Migration: Add undo support for external event deletions
-- Stores full event data for restoration when events are deleted from external sources

-- Add raw_event_data column to store the full event for restoration
ALTER TABLE event_change_notifications
  ADD COLUMN IF NOT EXISTS raw_event_data JSONB DEFAULT NULL;

-- Add new_title and new_date columns for modification tracking
ALTER TABLE event_change_notifications
  ADD COLUMN IF NOT EXISTS new_title TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS new_date DATE DEFAULT NULL;

-- Add comment explaining the structure
COMMENT ON COLUMN event_change_notifications.raw_event_data IS
  'Full event data stored for undo/restore functionality. Contains the complete external_events row data.';

-- Create function to restore a deleted external event
CREATE OR REPLACE FUNCTION restore_external_event(p_notification_id UUID)
RETURNS UUID AS $$
DECLARE
  v_notification RECORD;
  v_new_event_id UUID;
  v_event_data JSONB;
BEGIN
  -- Get the notification and verify it's a 'removed' type
  SELECT * INTO v_notification
  FROM event_change_notifications
  WHERE id = p_notification_id
    AND change_type = 'removed'
    AND status != 'restored';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found or already restored';
  END IF;

  -- Verify user has access to this household
  IF v_notification.household_id != get_user_household_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_event_data := v_notification.raw_event_data;

  IF v_event_data IS NULL OR v_event_data->>'_source' != 'external_integration' THEN
    -- No event data or not from external integration - create a task instead
    INSERT INTO child_tasks (
      household_id,
      child_id,
      title,
      date,
      time,
      task_type,
      notes,
      status
    ) VALUES (
      v_notification.household_id,
      v_notification.child_id,
      v_notification.original_title,
      v_notification.original_date,
      v_notification.original_time,
      'reminder',
      'Gjenopprettet fra slettet hendelse (' || v_notification.source_name || ')',
      'open'
    )
    RETURNING id INTO v_new_event_id;
  ELSE
    -- Restore the full external event
    INSERT INTO external_events (
      integration_id,
      external_id,
      title,
      description,
      event_date,
      event_time,
      end_date,
      end_time,
      location,
      event_type,
      child_id,
      local_overrides,
      user_notes,
      is_hidden,
      created_at,
      updated_at
    ) VALUES (
      (v_event_data->>'integration_id')::UUID,
      v_event_data->>'external_id' || '_restored_' || gen_random_uuid()::TEXT,  -- Make unique
      COALESCE(v_event_data->'local_overrides'->>'title', v_event_data->>'title'),
      v_event_data->>'description',
      (v_event_data->>'event_date')::DATE,
      (v_event_data->>'event_time')::TIME,
      (v_event_data->>'end_date')::DATE,
      (v_event_data->>'end_time')::TIME,
      COALESCE(v_event_data->'local_overrides'->>'location', v_event_data->>'location'),
      v_event_data->>'event_type',
      (v_event_data->>'child_id')::UUID,
      v_event_data->'local_overrides',
      COALESCE(v_event_data->>'user_notes', 'Gjenopprettet'),
      COALESCE((v_event_data->>'is_hidden')::BOOLEAN, false),
      NOW(),
      NOW()
    )
    RETURNING id INTO v_new_event_id;
  END IF;

  -- Mark notification as restored
  UPDATE event_change_notifications
  SET status = 'restored',
      updated_at = NOW()
  WHERE id = p_notification_id;

  RETURN v_new_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION restore_external_event(UUID) TO authenticated;

-- Create function to dismiss a notification
CREATE OR REPLACE FUNCTION dismiss_event_notification(p_notification_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE event_change_notifications
  SET status = 'dismissed',
      updated_at = NOW()
  WHERE id = p_notification_id
    AND household_id = get_user_household_id()
    AND status = 'unread';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION dismiss_event_notification(UUID) TO authenticated;

-- Add index for faster lookups on unread notifications
CREATE INDEX IF NOT EXISTS idx_event_change_notifications_household_unread
  ON event_change_notifications (household_id, status)
  WHERE status = 'unread';

-- Add notification types to push_notifications if not exists
-- These are used for categorizing push notifications
DO $$
BEGIN
  -- Note: NotificationType is defined in TypeScript, we just need the database to accept these values
  -- The actual validation happens in the application layer
  NULL;
END $$;
