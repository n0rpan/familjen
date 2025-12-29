-- Fix: Make integration_id nullable for household ICS suggestions
-- Household calendar suggestions don't use external integrations,
-- they use source_household_event_id instead.

ALTER TABLE external_suggestions
  ALTER COLUMN integration_id DROP NOT NULL;

-- Drop the original unnamed constraint from base migration
-- (PostgreSQL auto-named it external_suggestions_check)
ALTER TABLE external_suggestions DROP CONSTRAINT IF EXISTS external_suggestions_check;

-- Update the source constraint to reflect all valid source combinations
ALTER TABLE external_suggestions DROP CONSTRAINT IF EXISTS external_suggestions_source_check;
ALTER TABLE external_suggestions ADD CONSTRAINT external_suggestions_source_check
  CHECK (
    -- Standard integration source (message or event)
    (integration_id IS NOT NULL AND (source_message_id IS NOT NULL OR source_event_id IS NOT NULL))
    OR
    -- Household ICS source (uses household_event_id or ics_uid)
    (source_household_event_id IS NOT NULL OR source_ics_uid IS NOT NULL)
  );
