-- Shopping List Redesign Migration
-- Adds AI categorization, unified list support, and household settings

-- =============================================================================
-- 1. Add category column to shopping_list_items
-- =============================================================================

ALTER TABLE shopping_list_items
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other';

-- Index for efficient category grouping queries
CREATE INDEX IF NOT EXISTS idx_shopping_items_category
  ON shopping_list_items(list_id, category);

-- Compound index for common query pattern: list items sorted by category then date
CREATE INDEX IF NOT EXISTS idx_shopping_items_category_created
  ON shopping_list_items(list_id, category, created_at DESC);

-- =============================================================================
-- 2. Add trigram extension for fuzzy duplicate matching
-- =============================================================================

-- Enable pg_trgm for similarity-based duplicate detection
-- This allows queries like: WHERE similarity(name, 'melk') > 0.7
-- Note: pg_trgm is pre-installed on Supabase but may require
-- superuser privileges on self-hosted PostgreSQL
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on item names for fast fuzzy search
CREATE INDEX IF NOT EXISTS idx_shopping_items_name_trgm
  ON shopping_list_items USING gin(name gin_trgm_ops);

-- =============================================================================
-- 3. Add shopping settings to households
-- =============================================================================

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS shopping_settings JSONB DEFAULT '{}';

-- Structure:
-- {
--   "categoryOrder": ["produce", "dairy", "meat", "frozen", "pantry", "beverages", "household", "home", "electronics", "other"],
--   "defaultView": "newest",  -- "newest" | "category"
--   "filters": {
--     "dagligvarer": ["produce", "dairy", "meat", "frozen", "pantry", "beverages"],
--     "hjem": ["household", "home", "electronics"],
--     "annet": ["other"]
--   }
-- }

-- =============================================================================
-- 4. Add updated_by trigger for shopping_list_items (for realtime sync)
-- =============================================================================

-- Ensure updated_by column exists (may already exist from earlier migrations)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shopping_list_items' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE shopping_list_items ADD COLUMN updated_by UUID;
  END IF;
END $$;

-- Create or replace trigger function to set updated_by on changes
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

-- Drop existing trigger if it exists, then create
DROP TRIGGER IF EXISTS set_shopping_item_updated_by_trigger ON shopping_list_items;
CREATE TRIGGER set_shopping_item_updated_by_trigger
  BEFORE INSERT OR UPDATE ON shopping_list_items
  FOR EACH ROW
  EXECUTE FUNCTION set_shopping_item_updated_by();

-- =============================================================================
-- 5. Function for fuzzy duplicate check
-- =============================================================================

-- Uses authenticated user's household - no parameter to prevent cross-household probing
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
  WHERE sl.household_id = get_user_household_id()  -- Uses authenticated user's household
    AND si.is_bought = false
    AND similarity(si.name, p_item_name) >= p_similarity_threshold
  ORDER BY similarity_score DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION check_shopping_duplicate(TEXT, FLOAT) TO authenticated;

-- =============================================================================
-- Comments for documentation
-- =============================================================================

COMMENT ON COLUMN shopping_list_items.category IS 'AI-assigned item category: produce, dairy, meat, frozen, pantry, beverages, household, home, electronics, other';
COMMENT ON COLUMN households.shopping_settings IS 'User preferences for shopping list: categoryOrder, defaultView, custom filters';
COMMENT ON FUNCTION check_shopping_duplicate IS 'Find similar items on unbought list for duplicate prevention';
