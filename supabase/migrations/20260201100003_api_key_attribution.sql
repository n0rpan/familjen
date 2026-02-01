-- ============================================
-- API Key Attribution
-- ============================================
-- Track which API key made changes so users see
-- "Data Sprite endret hentingen" instead of "Someone"
-- ============================================

-- Add column to track API key that made the change
ALTER TABLE pickups
  ADD COLUMN IF NOT EXISTS updated_via_api_key_id UUID REFERENCES household_api_keys(id) ON DELETE SET NULL;

-- Index for looking up changes by API key
CREATE INDEX IF NOT EXISTS pickups_api_key_idx ON pickups(updated_via_api_key_id)
  WHERE updated_via_api_key_id IS NOT NULL;

-- Drop old function first (adding a parameter creates a new overload, not a replacement)
DROP FUNCTION IF EXISTS api_upsert_pickup(UUID, UUID, DATE, UUID);

-- Recreate api_upsert_pickup with API key ID parameter
CREATE OR REPLACE FUNCTION api_upsert_pickup(
  p_household_id UUID,
  p_child_id UUID,
  p_date DATE,
  p_picker_id UUID DEFAULT NULL,
  p_api_key_id UUID DEFAULT NULL  -- NEW: Track which API key made the change
)
RETURNS JSONB AS $$
DECLARE
  v_pickup_id UUID;
  v_is_insert BOOLEAN;
BEGIN
  -- Note: Use public. prefix because SET search_path = '' clears default schema

  -- Verify child belongs to household
  IF NOT EXISTS (
    SELECT 1 FROM public.children
    WHERE id = p_child_id AND household_id = p_household_id
  ) THEN
    RAISE EXCEPTION 'Child not found in household';
  END IF;

  -- Verify picker belongs to household (if provided)
  IF p_picker_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE id = p_picker_id AND household_id = p_household_id
  ) THEN
    RAISE EXCEPTION 'Picker not found in household';
  END IF;

  -- Check if pickup exists
  SELECT id INTO v_pickup_id
  FROM public.pickups
  WHERE household_id = p_household_id
    AND child_id = p_child_id
    AND date = p_date;

  v_is_insert := v_pickup_id IS NULL;

  -- Upsert with API key attribution
  INSERT INTO public.pickups (household_id, child_id, date, picker_id, updated_via_api_key_id)
  VALUES (p_household_id, p_child_id, p_date, p_picker_id, p_api_key_id)
  ON CONFLICT (household_id, child_id, date)
  DO UPDATE SET
    picker_id = EXCLUDED.picker_id,
    updated_at = NOW(),
    updated_via_api_key_id = EXCLUDED.updated_via_api_key_id
  RETURNING id INTO v_pickup_id;

  RETURN jsonb_build_object(
    'id', v_pickup_id,
    'operation', CASE WHEN v_is_insert THEN 'created' ELSE 'updated' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Only service role uses this function (API routes validate API key first)
REVOKE EXECUTE ON FUNCTION api_upsert_pickup(UUID, UUID, DATE, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION api_upsert_pickup(UUID, UUID, DATE, UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION api_upsert_pickup(UUID, UUID, DATE, UUID, UUID) FROM authenticated;

-- Function to get API key name for realtime display
-- Note: Use public. prefix because SET search_path = '' clears default schema
CREATE OR REPLACE FUNCTION get_api_key_name(p_api_key_id UUID)
RETURNS TEXT AS $$
BEGIN
  RETURN (
    SELECT name FROM public.household_api_keys WHERE id = p_api_key_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION get_api_key_name(UUID) TO authenticated;

-- ============================================
-- API Context Endpoint Support
-- ============================================
-- Provides schema documentation for AI assistants

CREATE OR REPLACE FUNCTION api_get_context(p_household_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object(
    'app_name', 'Familjen',
    'description', 'Norwegian family planning app for managing daily pickups, meals, and tasks',
    'language', 'Norwegian (Bokmål)',
    'timezone', 'Europe/Oslo',
    'entities', jsonb_build_object(
      'children', jsonb_build_object(
        'description', 'Children in the household who need to be picked up from school/kindergarten',
        'fields', jsonb_build_object(
          'id', 'Unique identifier (UUID)',
          'name', 'Child''s full name',
          'color', 'Color code for UI (sky, coral, sage, honey, lavender, mint)',
          'location_name', 'Name of school or kindergarten',
          'location_type', 'Either "school" or "kindergarten"'
        )
      ),
      'members', jsonb_build_object(
        'description', 'Adults in the household who can pick up children',
        'fields', jsonb_build_object(
          'id', 'Unique identifier (UUID)',
          'name', 'Full name',
          'short_name', 'Short name or nickname (used in compact UI)',
          'is_parent', 'Whether this member is a parent (vs grandparent, au pair, etc.)'
        )
      ),
      'pickups', jsonb_build_object(
        'description', 'Daily pickup assignments - who picks up which child on what date',
        'fields', jsonb_build_object(
          'id', 'Unique identifier (UUID)',
          'date', 'Date of pickup (YYYY-MM-DD)',
          'child', 'The child being picked up',
          'picker', 'The member assigned to pick up (null = unassigned)'
        ),
        'constraints', jsonb_build_array(
          'One pickup per child per date',
          'Picker must be a household member',
          'Dates should be within reasonable range (next 90 days recommended)'
        )
      )
    ),
    'tips', jsonb_build_array(
      'Use GET /api/family/children to get the list of children with their IDs',
      'Use GET /api/family/members to get the list of household members who can be pickers',
      'When creating a pickup, you need child_id and optionally picker_id from these lists',
      'Setting picker_id to null means the pickup is "unassigned" - useful when asking "who can pick up?"'
    ),
    'common_scenarios', jsonb_build_object(
      'assign_pickup', 'POST /api/family/pickups with child_id, date, and picker_id',
      'check_schedule', 'GET /api/family/pickups?from=YYYY-MM-DD&to=YYYY-MM-DD',
      'unassign_pickup', 'POST /api/family/pickups with picker_id: null'
    ),
    -- Note: Use public. prefix because SET search_path = '' clears default schema
    'household_summary', (
      SELECT jsonb_build_object(
        'children_count', (SELECT COUNT(*) FROM public.children WHERE household_id = p_household_id),
        'members_count', (SELECT COUNT(*) FROM public.household_members WHERE household_id = p_household_id),
        'children_names', (SELECT jsonb_agg(name ORDER BY sort_order, name) FROM public.children WHERE household_id = p_household_id),
        'member_names', (SELECT jsonb_agg(short_name ORDER BY name) FROM public.household_members WHERE household_id = p_household_id)
      )
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Only service role uses this function (API routes validate API key first)
REVOKE EXECUTE ON FUNCTION api_get_context(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION api_get_context(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION api_get_context(UUID) FROM authenticated;

COMMENT ON FUNCTION api_get_context IS 'Returns contextual information about the household and API schema for AI assistants';
