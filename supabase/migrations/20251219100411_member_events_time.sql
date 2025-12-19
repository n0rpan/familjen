-- Add event_time to member_events for ICS calendar events
-- This allows displaying meeting start times in the week view

ALTER TABLE member_events ADD COLUMN IF NOT EXISTS event_time TIME;

COMMENT ON COLUMN member_events.event_time IS 'Start time for the event (from ICS DTSTART)';
