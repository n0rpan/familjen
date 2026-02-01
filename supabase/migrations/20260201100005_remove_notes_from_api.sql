-- ============================================
-- Remove notes from Family API functions
-- ============================================
-- The pickups table doesn't have a notes column.
-- This migration fixes the functions that were deployed with notes references.

-- Fix api_get_pickups to not reference notes
CREATE OR REPLACE FUNCTION api_get_pickups(
  p_household_id UUID,
  p_from_date DATE,
  p_to_date DATE
)
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'date', p.date,
        'child', jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'color', c.color
        ),
        'picker', CASE WHEN m.id IS NOT NULL THEN
          jsonb_build_object(
            'id', m.id,
            'name', m.name,
            'short_name', m.short_name
          )
        ELSE NULL END,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      )
      ORDER BY p.date, c.sort_order, c.name
    )
    FROM public.pickups p
    JOIN public.children c ON c.id = p.child_id
    LEFT JOIN public.household_members m ON m.id = p.picker_id
    WHERE p.household_id = p_household_id
      AND p.date >= p_from_date
      AND p.date <= p_to_date
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Permissions already set in base migration, but ensure they're correct
REVOKE EXECUTE ON FUNCTION api_get_pickups(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION api_get_pickups(UUID, DATE, DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION api_get_pickups(UUID, DATE, DATE) FROM authenticated;
