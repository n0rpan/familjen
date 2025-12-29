-- Migration: Household Calendar Feature
-- Adds household-level ICS calendar support and household_events table

-- ============================================================================
-- 1. Add ICS fields to households table
-- ============================================================================
ALTER TABLE households ADD COLUMN IF NOT EXISTS ics_calendar_url TEXT;
ALTER TABLE households ADD COLUMN IF NOT EXISTS ics_last_sync_at TIMESTAMPTZ;
ALTER TABLE households ADD COLUMN IF NOT EXISTS ics_sync_error TEXT;

COMMENT ON COLUMN households.ics_calendar_url IS 'Shared family ICS calendar URL';
COMMENT ON COLUMN households.ics_last_sync_at IS 'Last successful household ICS sync';
COMMENT ON COLUMN households.ics_sync_error IS 'Error from last failed sync';

-- ============================================================================
-- 2. Create household_events table
-- ============================================================================
CREATE TABLE IF NOT EXISTS household_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  end_date DATE,  -- For multi-day events
  event_time TIME,  -- null = all-day (no is_all_day flag needed)
  end_time TIME,
  location TEXT,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'ics_calendar')),
  ics_uid TEXT,
  is_redistributed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes (mirror member_events patterns)
CREATE INDEX IF NOT EXISTS idx_household_events_date
  ON household_events(household_id, event_date);
CREATE INDEX IF NOT EXISTS idx_household_events_range
  ON household_events(household_id, event_date, end_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_household_events_ics_uid
  ON household_events(household_id, event_date, ics_uid)
  WHERE ics_uid IS NOT NULL;

-- RLS (mirror member_events patterns)
ALTER TABLE household_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own household events" ON household_events;
CREATE POLICY "Users view own household events"
  ON household_events FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Users manage own household events" ON household_events;
CREATE POLICY "Users manage own household events"
  ON household_events FOR ALL TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

-- ============================================================================
-- 3. Extend external_suggestions for household ICS suggestions
-- ============================================================================

-- Add source_type column to distinguish suggestion sources
ALTER TABLE external_suggestions
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'external_message';

-- Add constraint for source_type values (if column was just added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'external_suggestions_source_type_check'
  ) THEN
    ALTER TABLE external_suggestions
      ADD CONSTRAINT external_suggestions_source_type_check
      CHECK (source_type IN ('external_message', 'external_event', 'household_ics'));
  END IF;
END $$;

-- Add reference to household_events for household ICS suggestions
ALTER TABLE external_suggestions
  ADD COLUMN IF NOT EXISTS source_household_event_id UUID REFERENCES household_events(id) ON DELETE CASCADE;

-- Add target_member_id for adult redistribution (in addition to existing suggested_child_id)
ALTER TABLE external_suggestions
  ADD COLUMN IF NOT EXISTS target_member_id UUID REFERENCES household_members(id) ON DELETE SET NULL;

-- Update the source CHECK constraint to include household_ics source
-- First drop old constraint if exists, then add new one
ALTER TABLE external_suggestions DROP CONSTRAINT IF EXISTS external_suggestions_source_check;
ALTER TABLE external_suggestions ADD CONSTRAINT external_suggestions_source_check
  CHECK (
    source_message_id IS NOT NULL OR
    source_event_id IS NOT NULL OR
    source_household_event_id IS NOT NULL
  );

-- ============================================================================
-- 4. New RPC for accepting household ICS suggestions
-- ============================================================================
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

  -- Mark source household event as redistributed
  IF v_suggestion.source_household_event_id IS NOT NULL THEN
    UPDATE household_events SET is_redistributed = true
    WHERE id = v_suggestion.source_household_event_id;
  END IF;

  RETURN v_created_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION accept_household_ics_suggestion(UUID, TEXT, DATE, TIME) TO authenticated;

-- ============================================================================
-- 5. Enable realtime for household_events
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE household_events;
