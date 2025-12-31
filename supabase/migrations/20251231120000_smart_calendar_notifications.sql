-- Migration: Smart Calendar Notifications
-- Adds new columns to event_change_notifications for LLM-powered smart notifications:
-- - explanation: AI-generated explanation of what changed
-- - suggested_action: What the user should do
-- - new_title, new_date, new_time: For tracking date/time changes

-- ============================================================================
-- 1. Extend change_type CHECK constraint to include 'changed' and 'moved'
-- ============================================================================

ALTER TABLE event_change_notifications
  DROP CONSTRAINT IF EXISTS event_change_notifications_change_type_check;

ALTER TABLE event_change_notifications
  ADD CONSTRAINT event_change_notifications_change_type_check
  CHECK (change_type IN ('removed', 'date_changed', 'title_changed', 'changed', 'moved'));

-- ============================================================================
-- 2. Add new columns for smart notifications
-- ============================================================================

-- AI-generated explanation of what changed and why
ALTER TABLE event_change_notifications
  ADD COLUMN IF NOT EXISTS explanation TEXT;

-- Suggested action for the user
ALTER TABLE event_change_notifications
  ADD COLUMN IF NOT EXISTS suggested_action TEXT;

-- New event info (for change/move tracking)
ALTER TABLE event_change_notifications
  ADD COLUMN IF NOT EXISTS new_title TEXT;

ALTER TABLE event_change_notifications
  ADD COLUMN IF NOT EXISTS new_date DATE;

ALTER TABLE event_change_notifications
  ADD COLUMN IF NOT EXISTS new_time TIME;

-- ============================================================================
-- 3. Add comment for documentation
-- ============================================================================

COMMENT ON COLUMN event_change_notifications.explanation IS 'AI-generated explanation of what changed';
COMMENT ON COLUMN event_change_notifications.suggested_action IS 'Suggested action for the user';
COMMENT ON COLUMN event_change_notifications.new_title IS 'New title after change (if applicable)';
COMMENT ON COLUMN event_change_notifications.new_date IS 'New date after change (if applicable)';
COMMENT ON COLUMN event_change_notifications.new_time IS 'New time after change (if applicable)';
