-- Migration: Add source_ics_uid to external_suggestions
-- This allows suggestions to persist across calendar re-syncs
-- (since ICS sync uses delete+insert pattern with new UUIDs)

-- Add source_ics_uid column for persistent linking
ALTER TABLE external_suggestions
  ADD COLUMN IF NOT EXISTS source_ics_uid TEXT;

-- Index for looking up suggestions by ics_uid
CREATE INDEX IF NOT EXISTS idx_external_suggestions_ics_uid
  ON external_suggestions(household_id, source_ics_uid)
  WHERE source_ics_uid IS NOT NULL;

-- Update the source CHECK constraint to allow source_ics_uid as alternative
ALTER TABLE external_suggestions DROP CONSTRAINT IF EXISTS external_suggestions_source_check;
ALTER TABLE external_suggestions ADD CONSTRAINT external_suggestions_source_check
  CHECK (
    source_message_id IS NOT NULL OR
    source_event_id IS NOT NULL OR
    source_household_event_id IS NOT NULL OR
    source_ics_uid IS NOT NULL
  );

-- Update accept_household_ics_suggestion to handle re-synced events
-- When the source event was deleted and re-created, look up by ics_uid
CREATE OR REPLACE FUNCTION accept_household_ics_suggestion(
  p_suggestion_id UUID,
  p_title TEXT DEFAULT NULL,
  p_date DATE DEFAULT NULL,
  p_time TIME DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_suggestion external_suggestions%ROWTYPE;
  v_created_id UUID;
  v_household_id UUID;
  v_user_id UUID;
  v_reviewer_id UUID;
  v_event_id UUID;
BEGIN
  v_user_id := auth.uid();
  v_household_id := get_user_household_id();

  -- Get reviewer member id
  SELECT id INTO v_reviewer_id FROM household_members WHERE user_id = v_user_id LIMIT 1;

  -- Get the suggestion (must be household_ics type and belong to user's household)
  SELECT * INTO v_suggestion
  FROM external_suggestions
  WHERE id = p_suggestion_id
    AND household_id = v_household_id
    AND source_type = 'household_ics';

  IF v_suggestion.id IS NULL THEN
    RAISE EXCEPTION 'Suggestion not found';
  END IF;

  IF v_suggestion.status != 'pending' THEN
    RAISE EXCEPTION 'Suggestion already processed';
  END IF;

  -- Find the current event (may have been re-synced with new ID)
  IF v_suggestion.source_ics_uid IS NOT NULL THEN
    SELECT id INTO v_event_id
    FROM household_events
    WHERE household_id = v_household_id
      AND ics_uid = v_suggestion.source_ics_uid
    LIMIT 1;
  ELSE
    v_event_id := v_suggestion.source_household_event_id;
  END IF;

  -- Create child_task or member_event based on target
  IF v_suggestion.suggested_child_id IS NOT NULL THEN
    -- Create child task
    INSERT INTO child_tasks (household_id, child_id, date, time, task_type, title, status, source)
    VALUES (
      v_household_id,
      v_suggestion.suggested_child_id,
      COALESCE(p_date, v_suggestion.suggested_date),
      COALESCE(p_time, v_suggestion.suggested_time),
      COALESCE(v_suggestion.suggested_type, 'other'),
      COALESCE(p_title, v_suggestion.suggested_title),
      'open',
      'ai_suggested'
    ) RETURNING id INTO v_created_id;

    UPDATE external_suggestions SET
      status = 'accepted',
      reviewed_by = v_reviewer_id,
      reviewed_at = NOW(),
      created_task_id = v_created_id
    WHERE id = p_suggestion_id;

  ELSIF v_suggestion.target_member_id IS NOT NULL THEN
    -- Create member event
    INSERT INTO member_events (household_id, member_id, date, title, event_type, source)
    VALUES (
      v_household_id,
      v_suggestion.target_member_id,
      COALESCE(p_date, v_suggestion.suggested_date),
      COALESCE(p_title, v_suggestion.suggested_title),
      'other',
      'manual'
    ) RETURNING id INTO v_created_id;

    UPDATE external_suggestions SET
      status = 'accepted',
      reviewed_by = v_reviewer_id,
      reviewed_at = NOW()
    WHERE id = p_suggestion_id;
  ELSE
    RAISE EXCEPTION 'Suggestion has no target (child or member)';
  END IF;

  -- Mark source household event as redistributed (if it exists)
  IF v_event_id IS NOT NULL THEN
    UPDATE household_events SET is_redistributed = true
    WHERE id = v_event_id;
  END IF;

  RETURN v_created_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION accept_household_ics_suggestion(UUID, TEXT, DATE, TIME) TO authenticated;
