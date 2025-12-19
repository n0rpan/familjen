-- Fix ICS unique constraint for ON CONFLICT support
-- PostgreSQL's ON CONFLICT with column names doesn't work well with partial indexes
-- Change to a regular unique constraint instead

-- Drop the partial index
DROP INDEX IF EXISTS member_events_ics_uid_idx;

-- Create a regular unique constraint
-- NULLs are considered distinct in PostgreSQL unique constraints,
-- so non-ICS events (with NULL ics_uid) won't conflict with each other
ALTER TABLE member_events
  ADD CONSTRAINT member_events_ics_unique
  UNIQUE (household_id, member_id, date, ics_uid);
