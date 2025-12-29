-- Migration: Toshiba Home AC Control
-- Adds support for Toshiba AC units to home control

-- ============================================================================
-- Update service constraint to include Toshiba
-- ============================================================================
ALTER TABLE home_control_accounts
  DROP CONSTRAINT IF EXISTS home_control_accounts_service_check;

ALTER TABLE home_control_accounts
  ADD CONSTRAINT home_control_accounts_service_check
  CHECK (service IN ('somfy', 'toshiba'));

-- Add consumer_id for Toshiba (used instead of refresh_token)
ALTER TABLE home_control_accounts
  ADD COLUMN IF NOT EXISTS consumer_id_encrypted TEXT;

-- ============================================================================
-- Toshiba AC Devices (cached device state)
-- ============================================================================
CREATE TABLE IF NOT EXISTS toshiba_ac_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES home_control_accounts(id) ON DELETE CASCADE,
  ac_id TEXT NOT NULL, -- Toshiba AC ID (unique identifier from API)
  name TEXT NOT NULL,
  model TEXT,
  firmware_version TEXT,
  timezone TEXT,
  -- Current state
  power_state TEXT DEFAULT 'OFF' CHECK (power_state IN ('ON', 'OFF')),
  operation_mode TEXT DEFAULT 'AUTO' CHECK (operation_mode IN ('AUTO', 'COOL', 'HEAT', 'DRY', 'FAN')),
  target_temperature NUMERIC(4,1) DEFAULT 22,
  current_temperature NUMERIC(4,1),
  outdoor_temperature NUMERIC(4,1),
  fan_speed TEXT DEFAULT 'AUTO' CHECK (fan_speed IN ('AUTO', 'QUIET', 'LOW', 'MEDIUM_LOW', 'MEDIUM', 'MEDIUM_HIGH', 'HIGH')),
  swing_mode TEXT DEFAULT 'OFF' CHECK (swing_mode IN ('OFF', 'ON', 'VERTICAL', 'HORIZONTAL')),
  pure_state TEXT DEFAULT 'OFF' CHECK (pure_state IN ('ON', 'OFF')),
  -- Features
  has_energy_consumption BOOLEAN DEFAULT false,
  has_auto_clean BOOLEAN DEFAULT false,
  merit_feature TEXT,
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
  UNIQUE(account_id, ac_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_toshiba_ac_devices_account
  ON toshiba_ac_devices(account_id);
CREATE INDEX IF NOT EXISTS idx_toshiba_ac_devices_favorite
  ON toshiba_ac_devices(account_id, favorite) WHERE favorite = true;

-- ============================================================================
-- RLS Policies
-- ============================================================================
ALTER TABLE toshiba_ac_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own household toshiba devices" ON toshiba_ac_devices;
CREATE POLICY "Users can view own household toshiba devices"
  ON toshiba_ac_devices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_accounts hca
      WHERE hca.id = account_id
      AND hca.household_id = get_user_household_id()
    )
  );

DROP POLICY IF EXISTS "Users can manage own household toshiba devices" ON toshiba_ac_devices;
CREATE POLICY "Users can manage own household toshiba devices"
  ON toshiba_ac_devices FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_accounts hca
      WHERE hca.id = account_id
      AND hca.household_id = get_user_household_id()
    )
  );

-- ============================================================================
-- RPC: Get Toshiba tokens (includes consumerId)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_toshiba_tokens(p_account_id UUID)
RETURNS JSON AS $$
DECLARE
  v_access_token TEXT;
  v_consumer_id TEXT;
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
    consumer_id_encrypted,
    token_expiry
  INTO v_household_id, v_service, v_access_token, v_consumer_id, v_token_expiry
  FROM home_control_accounts
  WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_service != 'toshiba' THEN
    RAISE EXCEPTION 'Not a Toshiba account';
  END IF;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  -- Return null if no cached tokens
  IF v_access_token IS NULL THEN
    RETURN NULL;
  END IF;

  -- Return decrypted tokens with expiry info
  RETURN json_build_object(
    'accessToken', decrypt_token(v_access_token),
    'consumerId', CASE WHEN v_consumer_id IS NOT NULL THEN decrypt_token(v_consumer_id) ELSE NULL END,
    'expiry', v_token_expiry,
    'isExpired', v_token_expiry IS NULL OR v_token_expiry < NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Update Toshiba tokens
-- ============================================================================
CREATE OR REPLACE FUNCTION update_toshiba_tokens(
  p_account_id UUID,
  p_access_token TEXT,
  p_consumer_id TEXT,
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

  IF v_service != 'toshiba' THEN
    RAISE EXCEPTION 'Not a Toshiba account';
  END IF;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE home_control_accounts
  SET
    access_token_encrypted = encrypt_token(p_access_token),
    consumer_id_encrypted = encrypt_token(p_consumer_id),
    token_expiry = NOW() + (p_expires_in * INTERVAL '1 second') - INTERVAL '60 seconds', -- 60s safety margin
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Clear Toshiba tokens
-- ============================================================================
CREATE OR REPLACE FUNCTION clear_toshiba_tokens(p_account_id UUID)
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
    consumer_id_encrypted = NULL,
    token_expiry = NULL,
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Update Toshiba device state
-- ============================================================================
CREATE OR REPLACE FUNCTION update_toshiba_device_state(
  p_device_id UUID,
  p_power_state TEXT DEFAULT NULL,
  p_operation_mode TEXT DEFAULT NULL,
  p_target_temperature NUMERIC DEFAULT NULL,
  p_current_temperature NUMERIC DEFAULT NULL,
  p_outdoor_temperature NUMERIC DEFAULT NULL,
  p_fan_speed TEXT DEFAULT NULL,
  p_swing_mode TEXT DEFAULT NULL,
  p_pure_state TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_account_id UUID;
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Get the device's account
  SELECT account_id INTO v_account_id
  FROM toshiba_ac_devices
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

  UPDATE toshiba_ac_devices
  SET
    power_state = COALESCE(p_power_state, power_state),
    operation_mode = COALESCE(p_operation_mode, operation_mode),
    target_temperature = COALESCE(p_target_temperature, target_temperature),
    current_temperature = COALESCE(p_current_temperature, current_temperature),
    outdoor_temperature = COALESCE(p_outdoor_temperature, outdoor_temperature),
    fan_speed = COALESCE(p_fan_speed, fan_speed),
    swing_mode = COALESCE(p_swing_mode, swing_mode),
    pure_state = COALESCE(p_pure_state, pure_state),
    last_state_update = NOW(),
    updated_at = NOW()
  WHERE id = p_device_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Grant execute permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION get_toshiba_tokens(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_toshiba_tokens(UUID, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_toshiba_tokens(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_toshiba_device_state(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
