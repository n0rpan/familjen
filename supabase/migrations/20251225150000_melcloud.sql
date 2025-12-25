-- Migration: Mitsubishi MELCloud Integration
-- Adds support for Mitsubishi AC units via MELCloud

-- ============================================================================
-- Update service constraint to include MELCloud
-- ============================================================================
ALTER TABLE home_control_accounts
  DROP CONSTRAINT IF EXISTS home_control_accounts_service_check;

ALTER TABLE home_control_accounts
  ADD CONSTRAINT home_control_accounts_service_check
  CHECK (service IN ('somfy', 'toshiba', 'melcloud'));

-- ============================================================================
-- MELCloud AC Devices (cached device state)
-- ============================================================================
CREATE TABLE IF NOT EXISTS melcloud_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES home_control_accounts(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL, -- MELCloud device ID
  building_id INTEGER NOT NULL, -- MELCloud building ID (required for API calls)
  name TEXT NOT NULL,
  building_name TEXT,
  floor_name TEXT,
  area_name TEXT,
  model TEXT,
  -- Current state
  power_state TEXT DEFAULT 'OFF' CHECK (power_state IN ('ON', 'OFF')),
  operation_mode TEXT DEFAULT 'AUTO' CHECK (operation_mode IN ('AUTO', 'COOL', 'HEAT', 'DRY', 'FAN')),
  target_temperature NUMERIC(4,1) DEFAULT 22,
  current_temperature NUMERIC(4,1),
  outdoor_temperature NUMERIC(4,1),
  fan_speed TEXT DEFAULT 'AUTO' CHECK (fan_speed IN ('AUTO', 'SPEED_1', 'SPEED_2', 'SPEED_3', 'SPEED_4', 'SPEED_5')),
  vane_vertical TEXT DEFAULT 'AUTO' CHECK (vane_vertical IN ('AUTO', 'POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5', 'SWING')),
  vane_horizontal TEXT DEFAULT 'AUTO' CHECK (vane_horizontal IN ('AUTO', 'POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5', 'SPLIT', 'SWING')),
  -- Capabilities
  number_of_fan_speeds INTEGER DEFAULT 0,
  can_cool BOOLEAN DEFAULT true,
  can_heat BOOLEAN DEFAULT true,
  can_dry BOOLEAN DEFAULT true,
  has_vane_vertical BOOLEAN DEFAULT false,
  has_vane_horizontal BOOLEAN DEFAULT false,
  has_swing BOOLEAN DEFAULT false,
  has_wide_vane BOOLEAN DEFAULT false,
  -- Status
  offline BOOLEAN DEFAULT false,
  has_error BOOLEAN DEFAULT false,
  error_code INTEGER DEFAULT 0,
  wifi_signal_strength INTEGER DEFAULT 0,
  -- Raw data
  raw_data JSONB,
  -- User customization
  custom_name TEXT,
  favorite BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  is_hidden BOOLEAN DEFAULT false,
  -- Timestamps
  last_state_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(account_id, device_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_melcloud_devices_account
  ON melcloud_devices(account_id);
CREATE INDEX IF NOT EXISTS idx_melcloud_devices_favorite
  ON melcloud_devices(account_id, favorite) WHERE favorite = true;

-- ============================================================================
-- RLS Policies
-- ============================================================================
ALTER TABLE melcloud_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own household melcloud devices" ON melcloud_devices;
CREATE POLICY "Users can view own household melcloud devices"
  ON melcloud_devices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_accounts hca
      WHERE hca.id = account_id
      AND hca.household_id = get_user_household_id()
    )
  );

DROP POLICY IF EXISTS "Users can manage own household melcloud devices" ON melcloud_devices;
CREATE POLICY "Users can manage own household melcloud devices"
  ON melcloud_devices FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_accounts hca
      WHERE hca.id = account_id
      AND hca.household_id = get_user_household_id()
    )
  );

-- ============================================================================
-- Junction table for groups
-- ============================================================================
CREATE TABLE IF NOT EXISTS home_control_group_melcloud_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES home_control_groups(id) ON DELETE CASCADE,
  melcloud_device_id UUID NOT NULL REFERENCES melcloud_devices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, melcloud_device_id)
);

CREATE INDEX IF NOT EXISTS idx_group_melcloud_devices_group ON home_control_group_melcloud_devices(group_id);
CREATE INDEX IF NOT EXISTS idx_group_melcloud_devices_device ON home_control_group_melcloud_devices(melcloud_device_id);

ALTER TABLE home_control_group_melcloud_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own household group melcloud devices" ON home_control_group_melcloud_devices;
CREATE POLICY "Users can view own household group melcloud devices"
  ON home_control_group_melcloud_devices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_groups hcg
      WHERE hcg.id = group_id
      AND hcg.household_id = get_user_household_id()
    )
  );

DROP POLICY IF EXISTS "Users can manage own household group melcloud devices" ON home_control_group_melcloud_devices;
CREATE POLICY "Users can manage own household group melcloud devices"
  ON home_control_group_melcloud_devices FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_groups hcg
      WHERE hcg.id = group_id
      AND hcg.household_id = get_user_household_id()
    )
  );

-- ============================================================================
-- RPC: Get MELCloud tokens
-- ============================================================================
CREATE OR REPLACE FUNCTION get_melcloud_tokens(p_account_id UUID)
RETURNS JSON AS $$
DECLARE
  v_context_key TEXT;
  v_token_expiry TIMESTAMPTZ;
  v_household_id UUID;
  v_user_household_id UUID;
  v_service TEXT;
BEGIN
  -- Get the account's data
  SELECT
    household_id,
    service,
    access_token_encrypted,
    token_expiry
  INTO v_household_id, v_service, v_context_key, v_token_expiry
  FROM home_control_accounts
  WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_service != 'melcloud' THEN
    RAISE EXCEPTION 'Not a MELCloud account';
  END IF;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  -- Return null if no cached tokens
  IF v_context_key IS NULL THEN
    RETURN NULL;
  END IF;

  -- Return decrypted tokens with expiry info
  RETURN json_build_object(
    'contextKey', decrypt_token(v_context_key),
    'expiry', v_token_expiry,
    'isExpired', v_token_expiry IS NULL OR v_token_expiry < NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Update MELCloud tokens
-- ============================================================================
CREATE OR REPLACE FUNCTION update_melcloud_tokens(
  p_account_id UUID,
  p_context_key TEXT,
  p_expires_in INTEGER -- seconds until expiry
)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
  v_service TEXT;
BEGIN
  -- Get the account's household
  SELECT household_id, service INTO v_household_id, v_service
  FROM home_control_accounts
  WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_service != 'melcloud' THEN
    RAISE EXCEPTION 'Not a MELCloud account';
  END IF;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE home_control_accounts
  SET
    access_token_encrypted = encrypt_token(p_context_key),
    token_expiry = NOW() + (p_expires_in * INTERVAL '1 second') - INTERVAL '60 seconds', -- 60s safety margin
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Clear MELCloud tokens
-- ============================================================================
CREATE OR REPLACE FUNCTION clear_melcloud_tokens(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Get the account's household
  SELECT household_id INTO v_household_id
  FROM home_control_accounts
  WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE home_control_accounts
  SET
    access_token_encrypted = NULL,
    token_expiry = NULL,
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Update MELCloud device state
-- ============================================================================
CREATE OR REPLACE FUNCTION update_melcloud_device_state(
  p_device_id UUID,
  p_power_state TEXT DEFAULT NULL,
  p_operation_mode TEXT DEFAULT NULL,
  p_target_temperature NUMERIC DEFAULT NULL,
  p_current_temperature NUMERIC DEFAULT NULL,
  p_outdoor_temperature NUMERIC DEFAULT NULL,
  p_fan_speed TEXT DEFAULT NULL,
  p_vane_vertical TEXT DEFAULT NULL,
  p_vane_horizontal TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_account_id UUID;
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Get the device's account
  SELECT account_id INTO v_account_id
  FROM melcloud_devices
  WHERE id = p_device_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  -- Get the account's household
  SELECT household_id INTO v_household_id
  FROM home_control_accounts
  WHERE id = v_account_id;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE melcloud_devices
  SET
    power_state = COALESCE(p_power_state, power_state),
    operation_mode = COALESCE(p_operation_mode, operation_mode),
    target_temperature = COALESCE(p_target_temperature, target_temperature),
    current_temperature = COALESCE(p_current_temperature, current_temperature),
    outdoor_temperature = COALESCE(p_outdoor_temperature, outdoor_temperature),
    fan_speed = COALESCE(p_fan_speed, fan_speed),
    vane_vertical = COALESCE(p_vane_vertical, vane_vertical),
    vane_horizontal = COALESCE(p_vane_horizontal, vane_horizontal),
    last_state_update = NOW(),
    updated_at = NOW()
  WHERE id = p_device_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Grant execute permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION get_melcloud_tokens(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_melcloud_tokens(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_melcloud_tokens(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_melcloud_device_state(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
