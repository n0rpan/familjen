-- Migration: Home Control Token Caching
-- Adds token caching to avoid re-authentication on every API call

-- ============================================================================
-- Add token fields to home_control_accounts
-- ============================================================================
ALTER TABLE home_control_accounts
  ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS token_expiry TIMESTAMPTZ;

-- ============================================================================
-- RPC: Update cached tokens
-- ============================================================================
CREATE OR REPLACE FUNCTION update_home_control_tokens(
  p_account_id UUID,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_expires_in INTEGER -- seconds until expiry
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
    access_token_encrypted = encrypt_token(p_access_token),
    refresh_token_encrypted = CASE
      WHEN p_refresh_token IS NOT NULL THEN encrypt_token(p_refresh_token)
      ELSE refresh_token_encrypted  -- Keep existing if not provided
    END,
    token_expiry = NOW() + (p_expires_in * INTERVAL '1 second') - INTERVAL '60 seconds', -- 60s safety margin
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Get cached tokens
-- ============================================================================
CREATE OR REPLACE FUNCTION get_home_control_tokens(p_account_id UUID)
RETURNS JSON AS $$
DECLARE
  v_access_token TEXT;
  v_refresh_token TEXT;
  v_token_expiry TIMESTAMPTZ;
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Get the account's data
  SELECT
    household_id,
    access_token_encrypted,
    refresh_token_encrypted,
    token_expiry
  INTO v_household_id, v_access_token, v_refresh_token, v_token_expiry
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

  -- Return null if no cached tokens
  IF v_access_token IS NULL THEN
    RETURN NULL;
  END IF;

  -- Return decrypted tokens with expiry info
  RETURN json_build_object(
    'accessToken', decrypt_token(v_access_token),
    'refreshToken', CASE WHEN v_refresh_token IS NOT NULL THEN decrypt_token(v_refresh_token) ELSE NULL END,
    'expiry', v_token_expiry,
    'isExpired', v_token_expiry IS NULL OR v_token_expiry < NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Clear cached tokens (on auth failure)
-- ============================================================================
CREATE OR REPLACE FUNCTION clear_home_control_tokens(p_account_id UUID)
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
    refresh_token_encrypted = NULL,
    token_expiry = NULL,
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Grant execute permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION update_home_control_tokens(UUID, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_home_control_tokens(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_home_control_tokens(UUID) TO authenticated;
