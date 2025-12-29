-- Migration: Toshiba AC Group Support
-- Allows Toshiba AC devices to be added to home control groups

-- ============================================================================
-- Junction table for Toshiba devices in groups
-- ============================================================================
CREATE TABLE IF NOT EXISTS home_control_group_toshiba_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES home_control_groups(id) ON DELETE CASCADE,
  toshiba_device_id UUID NOT NULL REFERENCES toshiba_ac_devices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, toshiba_device_id)
);

CREATE INDEX IF NOT EXISTS idx_home_control_group_toshiba_devices_group
  ON home_control_group_toshiba_devices(group_id);
CREATE INDEX IF NOT EXISTS idx_home_control_group_toshiba_devices_device
  ON home_control_group_toshiba_devices(toshiba_device_id);

-- ============================================================================
-- RLS Policies
-- ============================================================================
ALTER TABLE home_control_group_toshiba_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own household group toshiba devices" ON home_control_group_toshiba_devices;
CREATE POLICY "Users can view own household group toshiba devices"
  ON home_control_group_toshiba_devices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_groups hcg
      WHERE hcg.id = group_id
      AND hcg.household_id = get_user_household_id()
    )
  );

DROP POLICY IF EXISTS "Users can manage own household group toshiba devices" ON home_control_group_toshiba_devices;
CREATE POLICY "Users can manage own household group toshiba devices"
  ON home_control_group_toshiba_devices FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_groups hcg
      WHERE hcg.id = group_id
      AND hcg.household_id = get_user_household_id()
    )
  );

-- ============================================================================
-- RPC: Assign Toshiba device to a group
-- ============================================================================
CREATE OR REPLACE FUNCTION assign_toshiba_device_to_group(
  p_group_id UUID,
  p_toshiba_device_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_group_household_id UUID;
  v_device_household_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Get the group's household
  SELECT household_id INTO v_group_household_id
  FROM home_control_groups
  WHERE id = p_group_id;

  IF v_group_household_id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- Get the device's household (via account)
  SELECT hca.household_id INTO v_device_household_id
  FROM toshiba_ac_devices tad
  JOIN home_control_accounts hca ON hca.id = tad.account_id
  WHERE tad.id = p_toshiba_device_id;

  IF v_device_household_id IS NULL THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  -- Verify both belong to the same household
  IF v_group_household_id != v_device_household_id THEN
    RAISE EXCEPTION 'Group and device must belong to the same household';
  END IF;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_group_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  -- Insert or ignore if already exists
  INSERT INTO home_control_group_toshiba_devices (group_id, toshiba_device_id)
  VALUES (p_group_id, p_toshiba_device_id)
  ON CONFLICT (group_id, toshiba_device_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Remove Toshiba device from a group
-- ============================================================================
CREATE OR REPLACE FUNCTION remove_toshiba_device_from_group(
  p_group_id UUID,
  p_toshiba_device_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_group_household_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Get the group's household
  SELECT household_id INTO v_group_household_id
  FROM home_control_groups
  WHERE id = p_group_id;

  IF v_group_household_id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_group_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  DELETE FROM home_control_group_toshiba_devices
  WHERE group_id = p_group_id AND toshiba_device_id = p_toshiba_device_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Grant execute permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION assign_toshiba_device_to_group(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_toshiba_device_from_group(UUID, UUID) TO authenticated;
