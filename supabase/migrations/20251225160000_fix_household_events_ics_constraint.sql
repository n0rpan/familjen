-- Fix ICS unique constraint for household_events ON CONFLICT support
-- PostgreSQL's ON CONFLICT with column names doesn't work well with partial indexes
-- Change to a regular unique constraint (same fix applied to member_events earlier)

-- Drop the partial index
DROP INDEX IF EXISTS idx_household_events_ics_uid;

-- Create a regular unique constraint on household_id and ics_uid
-- NULLs are considered distinct in PostgreSQL unique constraints,
-- so non-ICS events (with NULL ics_uid) won't conflict with each other
-- Note: We don't include event_date because the same ics_uid shouldn't exist
-- twice in the same household, even if the date changes in the ICS feed
ALTER TABLE household_events
  ADD CONSTRAINT household_events_ics_unique
  UNIQUE (household_id, ics_uid);
