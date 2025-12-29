-- Migration: Add member support to external integrations
-- Allows mapping Spond groups to household members (parents), not just children
-- Also enables multiple groups per child/member

-- ============================================================================
-- Update external_integration_children to support members
-- ============================================================================

-- Add member_id column
ALTER TABLE external_integration_children
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES household_members(id) ON DELETE CASCADE;

-- Make child_id nullable (one of child_id or member_id must be set)
ALTER TABLE external_integration_children
  ALTER COLUMN child_id DROP NOT NULL;

-- Add check constraint: either child_id or member_id must be set (but not both)
ALTER TABLE external_integration_children
  DROP CONSTRAINT IF EXISTS check_child_or_member;
ALTER TABLE external_integration_children
  ADD CONSTRAINT check_child_or_member
  CHECK (
    (child_id IS NOT NULL AND member_id IS NULL) OR
    (child_id IS NULL AND member_id IS NOT NULL)
  );

-- Update unique constraint to handle members
-- First drop existing constraint if exists
ALTER TABLE external_integration_children
  DROP CONSTRAINT IF EXISTS external_integration_children_integration_id_child_id_exter_key;

-- Create new unique indexes for both cases
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_int_child_unique
  ON external_integration_children(integration_id, child_id, external_group_id)
  WHERE child_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_int_member_unique
  ON external_integration_children(integration_id, member_id, external_group_id)
  WHERE member_id IS NOT NULL;

-- Add index for member lookups
CREATE INDEX IF NOT EXISTS idx_external_integration_children_member
  ON external_integration_children(member_id)
  WHERE member_id IS NOT NULL;

-- ============================================================================
-- Update external_events to support member_id
-- ============================================================================
ALTER TABLE external_events
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES household_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_external_events_member
  ON external_events(member_id)
  WHERE member_id IS NOT NULL;

-- ============================================================================
-- Update external_messages to support member_id
-- ============================================================================
ALTER TABLE external_messages
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES household_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_external_messages_member
  ON external_messages(member_id)
  WHERE member_id IS NOT NULL;

-- ============================================================================
-- RLS policies for new member access
-- ============================================================================

-- Update existing policies to include member-based access
-- (The existing household-based RLS should already cover this since members belong to households)

-- ============================================================================
-- Helper function to get groups for an existing integration
-- ============================================================================
CREATE OR REPLACE FUNCTION get_integration_mappings(p_integration_id UUID)
RETURNS TABLE (
  id UUID,
  child_id UUID,
  member_id UUID,
  external_group_id TEXT,
  external_group_name TEXT
) AS $$
BEGIN
  -- Verify the user has access to this integration
  IF NOT EXISTS (
    SELECT 1 FROM external_integrations ei
    JOIN household_members hm ON hm.household_id = ei.household_id
    WHERE ei.id = p_integration_id AND hm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    eic.id,
    eic.child_id,
    eic.member_id,
    eic.external_group_id,
    eic.external_group_name
  FROM external_integration_children eic
  WHERE eic.integration_id = p_integration_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_integration_mappings(UUID) TO authenticated;
