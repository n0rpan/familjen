-- Add calendar sync columns to pickups table
-- For sending pickup assignments to work calendars

ALTER TABLE pickups
ADD COLUMN IF NOT EXISTS sync_to_work_calendar BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS work_calendar_event_id TEXT;

-- Index for finding pickups that need sync
CREATE INDEX IF NOT EXISTS pickups_sync_idx ON pickups(sync_to_work_calendar) WHERE sync_to_work_calendar = true;

COMMENT ON COLUMN pickups.sync_to_work_calendar IS 'If true, send calendar invite to picker work_email';
COMMENT ON COLUMN pickups.work_calendar_event_id IS 'Google Calendar event ID for synced pickup';
