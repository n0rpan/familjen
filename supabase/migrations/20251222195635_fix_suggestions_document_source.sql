-- Fix: Include source_document_id in valid source combinations
-- External document suggestions (from manual URL sources) use source_document_id

-- 1. Drop and recreate source_type check to include 'external_document'
ALTER TABLE external_suggestions DROP CONSTRAINT IF EXISTS external_suggestions_source_type_check;
ALTER TABLE external_suggestions ADD CONSTRAINT external_suggestions_source_type_check
  CHECK (source_type IN ('external_message', 'external_event', 'household_ics', 'external_document'));

-- 2. Drop and recreate source check to include source_document_id
ALTER TABLE external_suggestions DROP CONSTRAINT IF EXISTS external_suggestions_source_check;
ALTER TABLE external_suggestions ADD CONSTRAINT external_suggestions_source_check
  CHECK (
    -- Standard integration source (message or event)
    (integration_id IS NOT NULL AND (source_message_id IS NOT NULL OR source_event_id IS NOT NULL))
    OR
    -- Household ICS source (uses household_event_id or ics_uid)
    (source_household_event_id IS NOT NULL OR source_ics_uid IS NOT NULL)
    OR
    -- External document source (manual URL, PDF, etc.)
    source_document_id IS NOT NULL
  );
