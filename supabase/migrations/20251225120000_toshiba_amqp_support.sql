-- Migration: Toshiba AMQP Support
-- Adds SAS token and device ID storage for Azure IoT Hub AMQP communication

-- ============================================================================
-- Add new columns for AMQP authentication
-- ============================================================================
ALTER TABLE home_control_accounts
  ADD COLUMN IF NOT EXISTS sas_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS amqp_device_id TEXT;

-- ============================================================================
-- Update get_toshiba_tokens to include SAS token and device ID
-- ============================================================================
CREATE OR REPLACE FUNCTION get_toshiba_tokens(p_account_id UUID)
RETURNS JSON AS $$
DECLARE
  v_access_token TEXT;
  v_consumer_id TEXT;
  v_sas_token TEXT;
  v_device_id TEXT;
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
    sas_token_encrypted,
    amqp_device_id,
    token_expiry
  INTO v_household_id, v_service, v_access_token, v_consumer_id, v_sas_token, v_device_id, v_token_expiry
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
    'sasToken', CASE WHEN v_sas_token IS NOT NULL THEN decrypt_token(v_sas_token) ELSE NULL END,
    'deviceId', v_device_id,
    'expiry', v_token_expiry,
    'isExpired', v_token_expiry IS NULL OR v_token_expiry < NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Update update_toshiba_tokens to include SAS token and device ID
-- ============================================================================
CREATE OR REPLACE FUNCTION update_toshiba_tokens(
  p_account_id UUID,
  p_access_token TEXT,
  p_consumer_id TEXT,
  p_sas_token TEXT DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
  p_expires_in INTEGER DEFAULT NULL -- seconds until expiry
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
    sas_token_encrypted = CASE WHEN p_sas_token IS NOT NULL THEN encrypt_token(p_sas_token) ELSE sas_token_encrypted END,
    amqp_device_id = COALESCE(p_device_id, amqp_device_id),
    token_expiry = CASE WHEN p_expires_in IS NOT NULL
      THEN NOW() + (p_expires_in * INTERVAL '1 second') - INTERVAL '60 seconds'
      ELSE token_expiry END,
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Update clear_toshiba_tokens to also clear SAS token
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
    sas_token_encrypted = NULL,
    amqp_device_id = NULL,
    token_expiry = NULL,
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Grant permissions for updated function signatures
-- ============================================================================
GRANT EXECUTE ON FUNCTION get_toshiba_tokens(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_toshiba_tokens(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_toshiba_tokens(UUID) TO authenticated;
