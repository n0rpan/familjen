-- Migration: Event Deduplication
-- Adds cross-source event deduplication with AI confidence scoring
-- High confidence duplicates are auto-merged, medium confidence creates suggestions

-- ============================================================================
-- 1. Extend external_events with duplicate tracking
-- ============================================================================

-- Add column to track which event this is a duplicate of (for auto-merged high confidence)
ALTER TABLE external_events
  ADD COLUMN IF NOT EXISTS duplicate_of_id UUID REFERENCES external_events(id) ON DELETE SET NULL;

-- Add column to store the duplicate confidence score (0.0-1.0)
ALTER TABLE external_events
  ADD COLUMN IF NOT EXISTS duplicate_confidence REAL;

-- Index for finding duplicates
CREATE INDEX IF NOT EXISTS idx_external_events_duplicate_of
  ON external_events(duplicate_of_id)
  WHERE duplicate_of_id IS NOT NULL;

-- ============================================================================
-- 2. Create table for medium confidence duplicate suggestions
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_duplicate_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,

  -- The two events that might be duplicates
  event_a_id UUID NOT NULL REFERENCES external_events(id) ON DELETE CASCADE,
  event_b_id UUID NOT NULL REFERENCES external_events(id) ON DELETE CASCADE,

  -- Confidence score (0.6-0.9 for medium confidence)
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

  -- Reason for the match (for user explanation)
  match_reason TEXT,

  -- User decision
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'merged', 'not_duplicate', 'dismissed')),

  -- Which event was kept (if merged)
  kept_event_id UUID REFERENCES external_events(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Ensure we don't create duplicate suggestions (A,B) and (B,A)
  CONSTRAINT event_duplicate_unique_pair CHECK (event_a_id < event_b_id)
);

-- Unique index to prevent duplicate suggestions for the same pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_duplicate_suggestions_pair
  ON event_duplicate_suggestions(event_a_id, event_b_id)
  WHERE status = 'pending';

-- Enable RLS
ALTER TABLE event_duplicate_suggestions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own household duplicate suggestions" ON event_duplicate_suggestions;
CREATE POLICY "Users can view own household duplicate suggestions"
  ON event_duplicate_suggestions FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Users can update own household duplicate suggestions" ON event_duplicate_suggestions;
CREATE POLICY "Users can update own household duplicate suggestions"
  ON event_duplicate_suggestions FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Users can insert own household duplicate suggestions" ON event_duplicate_suggestions;
CREATE POLICY "Users can insert own household duplicate suggestions"
  ON event_duplicate_suggestions FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Users can delete own household duplicate suggestions" ON event_duplicate_suggestions;
CREATE POLICY "Users can delete own household duplicate suggestions"
  ON event_duplicate_suggestions FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_event_duplicate_suggestions_household_pending
  ON event_duplicate_suggestions(household_id, created_at DESC)
  WHERE status = 'pending';

-- ============================================================================
-- 3. Function to merge duplicate events
-- ============================================================================

CREATE OR REPLACE FUNCTION merge_duplicate_events(
  p_keep_event_id UUID,
  p_remove_event_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_household_id UUID;
  v_keep_event external_events;
  v_remove_event external_events;
BEGIN
  -- Get user's household
  SELECT household_id INTO v_household_id
  FROM household_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated or no household';
  END IF;

  -- Get both events and verify they belong to the user's household via source URLs
  SELECT e.* INTO v_keep_event
  FROM external_events e
  LEFT JOIN external_source_urls s ON e.source_url_id = s.id
  LEFT JOIN external_integrations i ON e.integration_id = i.id
  WHERE e.id = p_keep_event_id
    AND (s.household_id = v_household_id OR i.household_id = v_household_id);

  SELECT e.* INTO v_remove_event
  FROM external_events e
  LEFT JOIN external_source_urls s ON e.source_url_id = s.id
  LEFT JOIN external_integrations i ON e.integration_id = i.id
  WHERE e.id = p_remove_event_id
    AND (s.household_id = v_household_id OR i.household_id = v_household_id);

  IF v_keep_event IS NULL OR v_remove_event IS NULL THEN
    RAISE EXCEPTION 'One or both events not found or not accessible';
  END IF;

  -- Mark the removed event as a duplicate
  UPDATE external_events
  SET duplicate_of_id = p_keep_event_id,
      is_hidden = true
  WHERE id = p_remove_event_id;

  -- Update any linked tasks to point to the kept event
  UPDATE external_events
  SET linked_task_id = v_keep_event.linked_task_id
  WHERE id = p_remove_event_id
    AND v_keep_event.linked_task_id IS NOT NULL
    AND linked_task_id IS NULL;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION merge_duplicate_events(UUID, UUID) TO authenticated;

-- ============================================================================
-- 4. Function to resolve a duplicate suggestion
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_duplicate_suggestion(
  p_suggestion_id UUID,
  p_action TEXT,  -- 'merge_keep_a', 'merge_keep_b', 'not_duplicate', 'dismiss'
  p_keep_event_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_suggestion event_duplicate_suggestions;
  v_household_id UUID;
BEGIN
  -- Get user's household
  SELECT household_id INTO v_household_id
  FROM household_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated or no household';
  END IF;

  -- Get the suggestion
  SELECT * INTO v_suggestion
  FROM event_duplicate_suggestions
  WHERE id = p_suggestion_id
    AND household_id = v_household_id
    AND status = 'pending';

  IF v_suggestion IS NULL THEN
    RAISE EXCEPTION 'Suggestion not found or already resolved';
  END IF;

  -- Handle the action
  IF p_action = 'merge_keep_a' THEN
    PERFORM merge_duplicate_events(v_suggestion.event_a_id, v_suggestion.event_b_id);
    UPDATE event_duplicate_suggestions
    SET status = 'merged',
        kept_event_id = v_suggestion.event_a_id,
        resolved_at = now(),
        resolved_by = auth.uid()
    WHERE id = p_suggestion_id;
  ELSIF p_action = 'merge_keep_b' THEN
    PERFORM merge_duplicate_events(v_suggestion.event_b_id, v_suggestion.event_a_id);
    UPDATE event_duplicate_suggestions
    SET status = 'merged',
        kept_event_id = v_suggestion.event_b_id,
        resolved_at = now(),
        resolved_by = auth.uid()
    WHERE id = p_suggestion_id;
  ELSIF p_action = 'not_duplicate' THEN
    UPDATE event_duplicate_suggestions
    SET status = 'not_duplicate',
        resolved_at = now(),
        resolved_by = auth.uid()
    WHERE id = p_suggestion_id;
  ELSIF p_action = 'dismiss' THEN
    UPDATE event_duplicate_suggestions
    SET status = 'dismissed',
        resolved_at = now(),
        resolved_by = auth.uid()
    WHERE id = p_suggestion_id;
  ELSE
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION resolve_duplicate_suggestion(UUID, TEXT, UUID) TO authenticated;

-- ============================================================================
-- 5. View to get events excluding duplicates
-- ============================================================================

-- This view excludes events that have been marked as duplicates
CREATE OR REPLACE VIEW external_events_deduplicated AS
SELECT *
FROM external_events
WHERE duplicate_of_id IS NULL
  AND is_hidden = false;

-- Grant access to the view
GRANT SELECT ON external_events_deduplicated TO authenticated;
