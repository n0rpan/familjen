-- Migration: Home Control (Somfy/Overkiz)
-- Adds tables for controlling smart home devices (blinds, screens, etc.)

-- ============================================================================
-- Home Control Accounts (Somfy accounts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS home_control_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('somfy')),
  display_name TEXT NOT NULL,
  credentials_encrypted TEXT NOT NULL,
  account_email TEXT, -- The email used to login (for display purposes)
  server TEXT DEFAULT 'somfy_europe' CHECK (server IN ('somfy_europe', 'somfy_america', 'somfy_oceania')),
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT DEFAULT 'pending' CHECK (last_sync_status IN ('pending', 'ok', 'auth_failed', 'error')),
  last_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(household_id, service, display_name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_home_control_accounts_household
  ON home_control_accounts(household_id);

-- ============================================================================
-- Home Control Devices (cached device list from Somfy)
-- ============================================================================
CREATE TABLE IF NOT EXISTS home_control_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES home_control_accounts(id) ON DELETE CASCADE,
  device_url TEXT NOT NULL, -- Overkiz device URL (unique identifier)
  label TEXT NOT NULL,
  ui_class TEXT NOT NULL, -- e.g., 'RollerShutter', 'ExteriorScreen', 'Awning'
  controllable_name TEXT,
  available BOOLEAN DEFAULT true,
  position INTEGER, -- 0-100 (0 = open, 100 = closed)
  commands JSONB, -- Available commands
  raw_data JSONB, -- Full device data
  -- User customization
  custom_name TEXT, -- User-defined name
  favorite BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  is_hidden BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(account_id, device_url)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_home_control_devices_account
  ON home_control_devices(account_id);
CREATE INDEX IF NOT EXISTS idx_home_control_devices_favorite
  ON home_control_devices(account_id, favorite) WHERE favorite = true;

-- ============================================================================
-- Device Groups (for controlling multiple devices together)
-- ============================================================================
CREATE TABLE IF NOT EXISTS home_control_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT, -- Icon identifier
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_home_control_groups_household
  ON home_control_groups(household_id);

-- ============================================================================
-- Group Memberships
-- ============================================================================
CREATE TABLE IF NOT EXISTS home_control_group_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES home_control_groups(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES home_control_devices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_home_control_group_devices_group
  ON home_control_group_devices(group_id);

-- ============================================================================
-- RLS Policies
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE home_control_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_control_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_control_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_control_group_devices ENABLE ROW LEVEL SECURITY;

-- home_control_accounts policies
DROP POLICY IF EXISTS "Users can view own household home control accounts" ON home_control_accounts;
CREATE POLICY "Users can view own household home control accounts"
  ON home_control_accounts FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Users can insert home control accounts for own household" ON home_control_accounts;
CREATE POLICY "Users can insert home control accounts for own household"
  ON home_control_accounts FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Users can update own household home control accounts" ON home_control_accounts;
CREATE POLICY "Users can update own household home control accounts"
  ON home_control_accounts FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Users can delete own household home control accounts" ON home_control_accounts;
CREATE POLICY "Users can delete own household home control accounts"
  ON home_control_accounts FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- home_control_devices policies
DROP POLICY IF EXISTS "Users can view own household home control devices" ON home_control_devices;
CREATE POLICY "Users can view own household home control devices"
  ON home_control_devices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_accounts hca
      WHERE hca.id = account_id
      AND hca.household_id = get_user_household_id()
    )
  );

DROP POLICY IF EXISTS "Users can manage own household home control devices" ON home_control_devices;
CREATE POLICY "Users can manage own household home control devices"
  ON home_control_devices FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_accounts hca
      WHERE hca.id = account_id
      AND hca.household_id = get_user_household_id()
    )
  );

-- home_control_groups policies
DROP POLICY IF EXISTS "Users can view own household home control groups" ON home_control_groups;
CREATE POLICY "Users can view own household home control groups"
  ON home_control_groups FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Users can manage own household home control groups" ON home_control_groups;
CREATE POLICY "Users can manage own household home control groups"
  ON home_control_groups FOR ALL
  TO authenticated
  USING (household_id = get_user_household_id());

-- home_control_group_devices policies
DROP POLICY IF EXISTS "Users can view own household group devices" ON home_control_group_devices;
CREATE POLICY "Users can view own household group devices"
  ON home_control_group_devices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_groups hcg
      WHERE hcg.id = group_id
      AND hcg.household_id = get_user_household_id()
    )
  );

DROP POLICY IF EXISTS "Users can manage own household group devices" ON home_control_group_devices;
CREATE POLICY "Users can manage own household group devices"
  ON home_control_group_devices FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM home_control_groups hcg
      WHERE hcg.id = group_id
      AND hcg.household_id = get_user_household_id()
    )
  );

-- ============================================================================
-- RPC Functions
-- ============================================================================

-- Upsert home control account with encrypted credentials
CREATE OR REPLACE FUNCTION upsert_home_control_account(
  p_household_id UUID,
  p_service TEXT,
  p_display_name TEXT,
  p_credentials JSON,
  p_account_email TEXT DEFAULT NULL,
  p_server TEXT DEFAULT 'somfy_europe'
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != p_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  INSERT INTO home_control_accounts (
    household_id,
    service,
    display_name,
    credentials_encrypted,
    account_email,
    server,
    updated_at
  )
  VALUES (
    p_household_id,
    p_service,
    p_display_name,
    encrypt_token(p_credentials::TEXT),
    p_account_email,
    p_server,
    NOW()
  )
  ON CONFLICT (household_id, service, display_name) DO UPDATE SET
    credentials_encrypted = encrypt_token(p_credentials::TEXT),
    account_email = COALESCE(p_account_email, home_control_accounts.account_email),
    server = p_server,
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get decrypted credentials for a home control account
CREATE OR REPLACE FUNCTION get_home_control_credentials(p_account_id UUID)
RETURNS JSON AS $$
DECLARE
  v_credentials TEXT;
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Get the account's household
  SELECT household_id, credentials_encrypted
  INTO v_household_id, v_credentials
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

  RETURN decrypt_token(v_credentials)::JSON;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get all home control accounts for a household (without credentials)
CREATE OR REPLACE FUNCTION get_household_home_control_accounts()
RETURNS TABLE (
  id UUID,
  service TEXT,
  display_name TEXT,
  account_email TEXT,
  server TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    hca.id,
    hca.service,
    hca.display_name,
    hca.account_email,
    hca.server,
    hca.last_sync_at,
    hca.last_sync_status,
    hca.last_sync_error,
    hca.created_at
  FROM home_control_accounts hca
  WHERE hca.household_id = get_user_household_id()
  ORDER BY hca.service, hca.display_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update sync status for home control account
CREATE OR REPLACE FUNCTION update_home_control_sync_status(
  p_account_id UUID,
  p_status TEXT,
  p_error TEXT DEFAULT NULL
)
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
    last_sync_at = CASE WHEN p_status = 'ok' THEN NOW() ELSE last_sync_at END,
    last_sync_status = p_status,
    last_sync_error = p_error,
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Delete a home control account and all its devices
CREATE OR REPLACE FUNCTION delete_home_control_account(p_account_id UUID)
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

  -- Delete the account (devices will be deleted via CASCADE)
  DELETE FROM home_control_accounts WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Grant execute permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION upsert_home_control_account(UUID, TEXT, TEXT, JSON, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_home_control_credentials(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_household_home_control_accounts() TO authenticated;
GRANT EXECUTE ON FUNCTION update_home_control_sync_status(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_home_control_account(UUID) TO authenticated;
