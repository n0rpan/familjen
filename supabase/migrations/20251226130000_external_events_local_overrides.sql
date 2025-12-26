-- Migration: Add local_overrides to external_events
-- Allows users to locally override title, date, time, location without affecting sync

-- Add local_overrides JSONB column
ALTER TABLE external_events
  ADD COLUMN IF NOT EXISTS local_overrides JSONB DEFAULT NULL;

-- Add comment explaining the structure
COMMENT ON COLUMN external_events.local_overrides IS 'User local overrides: {title, event_date, event_time, end_date, end_time, location}. Original values preserved in main columns.';

-- Create function to get integration stats (for settings page)
CREATE OR REPLACE FUNCTION get_integration_stats(p_integration_id UUID)
RETURNS TABLE (
  event_count BIGINT,
  message_count BIGINT,
  photo_count BIGINT,
  hidden_event_count BIGINT
) AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Get the integration's household
  SELECT household_id INTO v_household_id
  FROM external_integrations
  WHERE id = p_integration_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Integration not found';
  END IF;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM external_events WHERE integration_id = p_integration_id AND NOT is_hidden) AS event_count,
    (SELECT COUNT(*) FROM external_messages WHERE integration_id = p_integration_id AND NOT is_hidden) AS message_count,
    (SELECT COUNT(*) FROM external_photos WHERE integration_id = p_integration_id) AS photo_count,
    (SELECT COUNT(*) FROM external_events WHERE integration_id = p_integration_id AND is_hidden) AS hidden_event_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_integration_stats(UUID) TO authenticated;

-- Create function to get all integration stats for a household
CREATE OR REPLACE FUNCTION get_all_integration_stats()
RETURNS TABLE (
  integration_id UUID,
  service TEXT,
  display_name TEXT,
  event_count BIGINT,
  message_count BIGINT,
  photo_count BIGINT,
  hidden_event_count BIGINT
) AS $$
DECLARE
  v_household_id UUID;
BEGIN
  v_household_id := get_user_household_id();

  IF v_household_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ei.id AS integration_id,
    ei.service,
    ei.display_name,
    COALESCE((SELECT COUNT(*) FROM external_events ee WHERE ee.integration_id = ei.id AND NOT ee.is_hidden), 0) AS event_count,
    COALESCE((SELECT COUNT(*) FROM external_messages em WHERE em.integration_id = ei.id AND NOT em.is_hidden), 0) AS message_count,
    COALESCE((SELECT COUNT(*) FROM external_photos ep WHERE ep.integration_id = ei.id), 0) AS photo_count,
    COALESCE((SELECT COUNT(*) FROM external_events ee2 WHERE ee2.integration_id = ei.id AND ee2.is_hidden), 0) AS hidden_event_count
  FROM external_integrations ei
  WHERE ei.household_id = v_household_id
  ORDER BY ei.service, ei.display_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_all_integration_stats() TO authenticated;
