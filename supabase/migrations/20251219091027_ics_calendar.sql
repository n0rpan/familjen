-- Add ICS calendar support to household members
-- Allows members to sync their work calendar via published ICS URL

-- Add ICS-related columns to household_members
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS ics_calendar_url TEXT;
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS ics_last_sync_at TIMESTAMPTZ;
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS ics_sync_error TEXT;

-- Add ics_uid to member_events for deduplication of ICS events
ALTER TABLE member_events ADD COLUMN IF NOT EXISTS ics_uid TEXT;

-- Create partial unique index for ICS events (only when ics_uid is not null)
-- This prevents duplicate events from the same ICS feed
CREATE UNIQUE INDEX IF NOT EXISTS member_events_ics_uid_idx
  ON member_events (household_id, member_id, date, ics_uid)
  WHERE ics_uid IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN household_members.ics_calendar_url IS 'Published ICS calendar URL for syncing work calendar events';
COMMENT ON COLUMN household_members.ics_last_sync_at IS 'Last successful ICS calendar sync timestamp';
COMMENT ON COLUMN household_members.ics_sync_error IS 'Error message from last failed ICS sync attempt';
COMMENT ON COLUMN member_events.ics_uid IS 'ICS event UID for deduplication (from VEVENT UID field)';
