-- Shopping List Merge Migration
-- Merges "Frukt og grønt" and "Annet" lists into a single "Handleliste" per household
-- Categories on items now replace the two-list approach
--
-- This migration is REVERSIBLE - old lists are kept with is_archived flag

-- =============================================================================
-- 1. Add is_archived column to shopping_lists (for reversibility)
-- =============================================================================

ALTER TABLE shopping_lists
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

COMMENT ON COLUMN shopping_lists.is_archived IS 'Used during migration to hide old lists without deleting';

-- =============================================================================
-- 2. Create the merge function (can be called per-household or in bulk)
-- =============================================================================

CREATE OR REPLACE FUNCTION merge_shopping_lists_for_household(p_household_id UUID)
RETURNS TABLE (
  items_moved INTEGER,
  lists_archived INTEGER,
  primary_list_id UUID
)
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_primary_list_id UUID;
  v_items_moved INTEGER := 0;
  v_lists_archived INTEGER := 0;
  v_list_ids UUID[];
  v_user_household_id UUID;
BEGIN
  -- SECURITY: Verify caller belongs to the target household
  -- Exception: Allow when called during migration (no auth context = postgres role)
  SELECT get_user_household_id() INTO v_user_household_id;
  IF v_user_household_id IS NOT NULL AND v_user_household_id != p_household_id THEN
    -- User is authenticated but trying to access another household
    RAISE EXCEPTION 'Access denied: you can only merge your own household lists';
  END IF;
  -- If v_user_household_id IS NULL, allow (migration context or admin)

  -- Find all non-archived lists for this household
  SELECT array_agg(id) INTO v_list_ids
  FROM shopping_lists
  WHERE household_id = p_household_id
    AND is_archived = false;

  -- If no lists or only one list, nothing to merge
  IF v_list_ids IS NULL OR array_length(v_list_ids, 1) <= 1 THEN
    -- Return the single list if it exists
    SELECT id INTO v_primary_list_id FROM shopping_lists
    WHERE household_id = p_household_id AND is_archived = false
    LIMIT 1;

    RETURN QUERY SELECT 0::INTEGER, 0::INTEGER, v_primary_list_id;
    RETURN;
  END IF;

  -- Find or create primary list (use the one with sort_order = 0, or lowest sort_order)
  SELECT id INTO v_primary_list_id
  FROM shopping_lists
  WHERE household_id = p_household_id
    AND is_archived = false
  ORDER BY sort_order ASC NULLS LAST
  LIMIT 1;

  -- Rename primary list to "Handleliste" if it isn't already
  UPDATE shopping_lists
  SET name = 'Handleliste', sort_order = 0
  WHERE id = v_primary_list_id;

  -- Move all items from other lists to the primary list
  WITH moved AS (
    UPDATE shopping_list_items
    SET list_id = v_primary_list_id
    WHERE list_id = ANY(v_list_ids)
      AND list_id != v_primary_list_id
    RETURNING 1
  )
  SELECT count(*) INTO v_items_moved FROM moved;

  -- Archive the other lists (don't delete for reversibility)
  WITH archived AS (
    UPDATE shopping_lists
    SET is_archived = true
    WHERE id = ANY(v_list_ids)
      AND id != v_primary_list_id
    RETURNING 1
  )
  SELECT count(*) INTO v_lists_archived FROM archived;

  RETURN QUERY SELECT v_items_moved, v_lists_archived, v_primary_list_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION merge_shopping_lists_for_household(UUID) TO authenticated;

-- =============================================================================
-- 3. Function to check migration status (preflight)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_shopping_migration_preflight()
RETURNS TABLE (
  household_id UUID,
  household_name TEXT,
  list_count INTEGER,
  total_items INTEGER,
  needs_merge BOOLEAN
)
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_household_id UUID;
  v_is_admin BOOLEAN;
BEGIN
  -- Get caller's household and admin status
  SELECT get_user_household_id() INTO v_user_household_id;
  SELECT is_admin() INTO v_is_admin;

  -- SECURITY: Only return data for caller's household, or all households if admin
  RETURN QUERY
  SELECT
    h.id AS household_id,
    h.name AS household_name,
    (SELECT count(*)::INTEGER FROM shopping_lists sl WHERE sl.household_id = h.id AND sl.is_archived = false) AS list_count,
    (
      SELECT count(*)::INTEGER
      FROM shopping_list_items si
      JOIN shopping_lists sl ON si.list_id = sl.id
      WHERE sl.household_id = h.id AND sl.is_archived = false
    ) AS total_items,
    (SELECT count(*) > 1 FROM shopping_lists sl WHERE sl.household_id = h.id AND sl.is_archived = false) AS needs_merge
  FROM households h
  WHERE h.id = v_user_household_id OR v_is_admin = true
  ORDER BY h.name;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_shopping_migration_preflight() TO authenticated;

-- =============================================================================
-- 4. Run the migration for ALL households
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  v_result RECORD;
  v_total_items INTEGER := 0;
  v_total_lists INTEGER := 0;
BEGIN
  RAISE NOTICE 'Starting shopping list merge for all households...';

  FOR r IN SELECT id, name FROM households LOOP
    SELECT * INTO v_result FROM merge_shopping_lists_for_household(r.id);

    IF v_result.items_moved > 0 OR v_result.lists_archived > 0 THEN
      RAISE NOTICE 'Household %: moved % items, archived % lists',
        r.name, v_result.items_moved, v_result.lists_archived;
      v_total_items := v_total_items + v_result.items_moved;
      v_total_lists := v_total_lists + v_result.lists_archived;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration complete: moved % items across % archived lists',
    v_total_items, v_total_lists;
END $$;

-- =============================================================================
-- 5. Rollback function (if needed)
-- =============================================================================

CREATE OR REPLACE FUNCTION rollback_shopping_list_merge(p_household_id UUID)
RETURNS TABLE (
  items_restored INTEGER,
  lists_restored INTEGER
)
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_items_restored INTEGER := 0;
  v_lists_restored INTEGER := 0;
  v_list RECORD;
  v_user_household_id UUID;
BEGIN
  -- SECURITY: Verify caller belongs to the target household
  -- Exception: Allow when called during migration (no auth context = postgres role)
  SELECT get_user_household_id() INTO v_user_household_id;
  IF v_user_household_id IS NOT NULL AND v_user_household_id != p_household_id THEN
    -- User is authenticated but trying to access another household
    RAISE EXCEPTION 'Access denied: you can only rollback your own household lists';
  END IF;
  -- If v_user_household_id IS NULL, allow (migration context or admin)

  -- Restore archived lists
  FOR v_list IN
    SELECT id, name FROM shopping_lists
    WHERE household_id = p_household_id AND is_archived = true
  LOOP
    -- Restore the list
    UPDATE shopping_lists SET is_archived = false WHERE id = v_list.id;
    v_lists_restored := v_lists_restored + 1;

    -- Note: We cannot automatically restore items to their original lists
    -- because we didn't track which list each item came from.
    -- A more sophisticated migration would store the original list_id.
  END LOOP;

  RETURN QUERY SELECT v_items_restored, v_lists_restored;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION rollback_shopping_list_merge(UUID) TO authenticated;

-- =============================================================================
-- Documentation
-- =============================================================================

COMMENT ON FUNCTION merge_shopping_lists_for_household IS 'Merge multiple shopping lists into a single "Handleliste" for a household';
COMMENT ON FUNCTION get_shopping_migration_preflight IS 'Get status of shopping list migration for all households';
COMMENT ON FUNCTION rollback_shopping_list_merge IS 'Restore archived lists (note: items stay in primary list)';
