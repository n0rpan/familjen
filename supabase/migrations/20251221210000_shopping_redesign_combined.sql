-- Shopping List Redesign - Combined Migration
-- Merges schema changes and data migration into single idempotent migration
-- Safe to re-run: uses IF NOT EXISTS, IF EXISTS, and checks for existing state

-- =============================================================================
-- PART 1: SCHEMA CHANGES
-- =============================================================================

-- 1.1 Add category column to shopping_list_items
ALTER TABLE shopping_list_items
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other';

-- 1.2 Add is_archived column to shopping_lists (for reversibility)
ALTER TABLE shopping_lists
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- 1.3 Add shopping settings to households
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS shopping_settings JSONB DEFAULT '{}';

-- 1.4 Ensure updated_by column exists on shopping_list_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shopping_list_items' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE shopping_list_items ADD COLUMN updated_by UUID;
  END IF;
END $$;

-- =============================================================================
-- PART 2: INDEXES
-- =============================================================================

-- Index for efficient category grouping queries
CREATE INDEX IF NOT EXISTS idx_shopping_items_category
  ON shopping_list_items(list_id, category);

-- Compound index for common query pattern: list items sorted by category then date
CREATE INDEX IF NOT EXISTS idx_shopping_items_category_created
  ON shopping_list_items(list_id, category, created_at DESC);

-- Enable pg_trgm for similarity-based duplicate detection
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on item names for fast fuzzy search
CREATE INDEX IF NOT EXISTS idx_shopping_items_name_trgm
  ON shopping_list_items USING gin(name gin_trgm_ops);

-- =============================================================================
-- PART 3: FUNCTIONS AND TRIGGERS
-- =============================================================================

-- 3.1 Trigger function to set updated_by on changes
CREATE OR REPLACE FUNCTION set_shopping_item_updated_by()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS set_shopping_item_updated_by_trigger ON shopping_list_items;
CREATE TRIGGER set_shopping_item_updated_by_trigger
  BEFORE INSERT OR UPDATE ON shopping_list_items
  FOR EACH ROW
  EXECUTE FUNCTION set_shopping_item_updated_by();

-- 3.2 Function for fuzzy duplicate check
CREATE OR REPLACE FUNCTION check_shopping_duplicate(
  p_item_name TEXT,
  p_similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  quantity TEXT,
  list_id UUID,
  similarity_score FLOAT
)
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    si.id,
    si.name,
    si.quantity,
    si.list_id,
    similarity(si.name, p_item_name) AS similarity_score
  FROM shopping_list_items si
  JOIN shopping_lists sl ON si.list_id = sl.id
  WHERE sl.household_id = get_user_household_id()
    AND sl.is_archived = false
    AND si.is_bought = false
    AND similarity(si.name, p_item_name) >= p_similarity_threshold
  ORDER BY similarity_score DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION check_shopping_duplicate(TEXT, FLOAT) TO authenticated;

-- 3.3 Merge function (idempotent - only merges if multiple non-archived lists exist)
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
    RAISE EXCEPTION 'Access denied: you can only merge your own household lists';
  END IF;

  -- Find all non-archived lists for this household
  SELECT array_agg(id) INTO v_list_ids
  FROM shopping_lists
  WHERE household_id = p_household_id
    AND is_archived = false;

  -- If no lists or only one list, nothing to merge (idempotent)
  IF v_list_ids IS NULL OR array_length(v_list_ids, 1) <= 1 THEN
    SELECT id INTO v_primary_list_id FROM shopping_lists
    WHERE household_id = p_household_id AND is_archived = false
    LIMIT 1;
    RETURN QUERY SELECT 0::INTEGER, 0::INTEGER, v_primary_list_id;
    RETURN;
  END IF;

  -- Find primary list (lowest sort_order)
  SELECT id INTO v_primary_list_id
  FROM shopping_lists
  WHERE household_id = p_household_id
    AND is_archived = false
  ORDER BY sort_order ASC NULLS LAST
  LIMIT 1;

  -- Rename primary list to "Handleliste"
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

  -- Archive the other lists
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

-- 3.4 Preflight check function
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
  SELECT get_user_household_id() INTO v_user_household_id;
  SELECT is_admin() INTO v_is_admin;

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

-- 3.5 Rollback function
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
  SELECT get_user_household_id() INTO v_user_household_id;
  IF v_user_household_id IS NOT NULL AND v_user_household_id != p_household_id THEN
    RAISE EXCEPTION 'Access denied: you can only rollback your own household lists';
  END IF;

  FOR v_list IN
    SELECT id, name FROM shopping_lists
    WHERE household_id = p_household_id AND is_archived = true
  LOOP
    UPDATE shopping_lists SET is_archived = false WHERE id = v_list.id;
    v_lists_restored := v_lists_restored + 1;
  END LOOP;

  RETURN QUERY SELECT v_items_restored, v_lists_restored;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION rollback_shopping_list_merge(UUID) TO authenticated;

-- =============================================================================
-- PART 4: DATA MIGRATION (idempotent - skips if already merged)
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
-- PART 5: DOCUMENTATION
-- =============================================================================

COMMENT ON COLUMN shopping_list_items.category IS 'AI-assigned item category: produce, dairy, meat, frozen, pantry, beverages, household, home, electronics, other';
COMMENT ON COLUMN shopping_lists.is_archived IS 'Used during migration to hide old lists without deleting';
COMMENT ON COLUMN households.shopping_settings IS 'User preferences for shopping list: categoryOrder, defaultView, custom filters';
COMMENT ON FUNCTION merge_shopping_lists_for_household IS 'Merge multiple shopping lists into a single "Handleliste" for a household';
COMMENT ON FUNCTION get_shopping_migration_preflight IS 'Get status of shopping list migration for all households';
COMMENT ON FUNCTION rollback_shopping_list_merge IS 'Restore archived lists (note: items stay in primary list)';
COMMENT ON FUNCTION check_shopping_duplicate IS 'Find similar items on unbought list for duplicate prevention';
