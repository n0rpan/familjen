-- ============================================
-- Fix Family API: Return empty arrays instead of NULL
--
-- jsonb_agg() returns NULL when there are no rows.
-- This causes issues for API consumers expecting arrays.
-- ============================================

-- Fix api_get_pickups to return empty array
CREATE OR REPLACE FUNCTION api_get_pickups(
  p_household_id UUID,
  p_from_date DATE,
  p_to_date DATE
)
RETURNS JSONB AS $$
BEGIN
  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'date', p.date,
          'notes', p.notes,
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
      FROM pickups p
      JOIN children c ON c.id = p.child_id
      LEFT JOIN household_members m ON m.id = p.picker_id
      WHERE p.household_id = p_household_id
        AND p.date >= p_from_date
        AND p.date <= p_to_date
    ),
    '[]'::jsonb
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Fix api_get_children to return empty array
CREATE OR REPLACE FUNCTION api_get_children(p_household_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'color', c.color,
          'location_name', c.location_name,
          'location_type', c.location_type,
          'birth_date', c.birth_date
        )
        ORDER BY c.sort_order, c.name
      )
      FROM children c
      WHERE c.household_id = p_household_id
    ),
    '[]'::jsonb
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Fix api_get_members to return empty array
CREATE OR REPLACE FUNCTION api_get_members(p_household_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'name', m.name,
          'short_name', m.short_name,
          'is_parent', m.is_parent
        )
        ORDER BY m.name
      )
      FROM household_members m
      WHERE m.household_id = p_household_id
    ),
    '[]'::jsonb
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
