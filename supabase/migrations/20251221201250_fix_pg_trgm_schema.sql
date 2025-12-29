-- Fix pg_trgm extension to use extensions schema
-- This addresses Supabase linter warning about extensions in public schema

-- Drop existing extension if in wrong schema and recreate in extensions schema
DO $$
BEGIN
  -- Check if pg_trgm exists in public schema
  IF EXISTS (
    SELECT 1 FROM pg_extension
    WHERE extname = 'pg_trgm'
    AND extnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    -- Drop dependent objects first (the index)
    DROP INDEX IF EXISTS idx_shopping_items_name_trgm;

    -- Drop extension from public
    DROP EXTENSION pg_trgm;

    -- Recreate in extensions schema
    CREATE EXTENSION pg_trgm WITH SCHEMA extensions;

    -- Recreate index using qualified function name
    CREATE INDEX idx_shopping_items_name_trgm
      ON shopping_list_items USING gin(name extensions.gin_trgm_ops);
  ELSIF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    -- Extension doesn't exist yet, create in correct schema
    CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
  END IF;
  -- If pg_trgm already in extensions schema, do nothing
END $$;

-- Update check_shopping_duplicate function to use qualified function name
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
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    si.id,
    si.name,
    si.quantity,
    si.list_id,
    extensions.similarity(si.name, p_item_name) AS similarity_score
  FROM shopping_list_items si
  JOIN shopping_lists sl ON si.list_id = sl.id
  WHERE sl.household_id = get_user_household_id()
    AND sl.is_archived = false
    AND si.is_bought = false
    AND extensions.similarity(si.name, p_item_name) >= p_similarity_threshold
  ORDER BY similarity_score DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;
