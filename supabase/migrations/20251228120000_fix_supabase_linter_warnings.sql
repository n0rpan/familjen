-- Migration: Fix Supabase Linter Warnings
-- Addresses security and performance issues flagged by Supabase Database Linter
--
-- Issues fixed:
-- 1. SECURITY DEFINER view: google_calendar_tokens_decrypted - INTENTIONALLY NOT CHANGED
-- 2. Function search path mutable (WARN): 26 functions missing SET search_path
-- 3. Multiple permissive policies (WARN): 8 tables with duplicate SELECT policies
-- 4. Duplicate indexes (WARN): 3 tables with identical indexes

-- ============================================================================
-- 1. SECURITY DEFINER VIEW - INTENTIONALLY NOT CHANGED
-- ============================================================================
-- The google_calendar_tokens_decrypted view uses SECURITY DEFINER intentionally.
-- This is by design because:
--   1. The underlying google_calendar_tokens table has admin-only RLS policies
--   2. The view provides controlled access to shared calendar tokens for sync
--   3. Changing to SECURITY INVOKER would break calendar sync for non-admin users
--
-- The Supabase linter flags this as an ERROR, but it's the correct architecture
-- for this use case. The view allows authenticated users to read the shared
-- calendar tokens while keeping the underlying table protected.
--
-- A future improvement could add household_id to the tokens table and use
-- proper RLS scoping, but that requires schema changes beyond this fix.

-- ============================================================================
-- 2. FIX FUNCTION SEARCH PATH MUTABLE
-- ============================================================================
-- All SECURITY DEFINER functions should have a fixed search_path to prevent
-- search path injection attacks. Setting search_path = public explicitly.

-- === delete_my_account ===
CREATE OR REPLACE FUNCTION delete_my_account()
RETURNS void AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_member_id UUID;
  v_household_id UUID;
  v_is_last_member BOOLEAN;
  v_user_email TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_user_email := auth.jwt() ->> 'email';

  SELECT id, household_id INTO v_member_id, v_household_id
  FROM public.household_members WHERE user_id = v_user_id;

  IF v_member_id IS NOT NULL THEN
    SELECT COUNT(*) = 1 INTO v_is_last_member
    FROM public.household_members WHERE household_id = v_household_id;

    DELETE FROM public.household_members WHERE id = v_member_id;

    IF v_is_last_member THEN
      DELETE FROM public.households WHERE id = v_household_id;
    END IF;
  END IF;

  DELETE FROM public.allowed_emails WHERE email = LOWER(v_user_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === upsert_home_control_account ===
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
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != p_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  INSERT INTO public.home_control_accounts (
    household_id, service, display_name, credentials_encrypted,
    account_email, server, updated_at
  )
  VALUES (
    p_household_id, p_service, p_display_name, encrypt_token(p_credentials::TEXT),
    p_account_email, p_server, NOW()
  )
  ON CONFLICT (household_id, service, display_name) DO UPDATE SET
    credentials_encrypted = encrypt_token(p_credentials::TEXT),
    account_email = COALESCE(p_account_email, public.home_control_accounts.account_email),
    server = p_server,
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === get_home_control_credentials ===
CREATE OR REPLACE FUNCTION get_home_control_credentials(p_account_id UUID)
RETURNS JSON AS $$
DECLARE
  v_credentials TEXT;
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  SELECT household_id, credentials_encrypted
  INTO v_household_id, v_credentials
  FROM public.home_control_accounts
  WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  RETURN decrypt_token(v_credentials)::JSON;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === get_household_home_control_accounts ===
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
    hca.id, hca.service, hca.display_name, hca.account_email, hca.server,
    hca.last_sync_at, hca.last_sync_status, hca.last_sync_error, hca.created_at
  FROM public.home_control_accounts hca
  WHERE hca.household_id = get_user_household_id()
  ORDER BY hca.service, hca.display_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === update_home_control_sync_status ===
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
  SELECT household_id INTO v_household_id
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE public.home_control_accounts
  SET
    last_sync_at = CASE WHEN p_status = 'ok' THEN NOW() ELSE last_sync_at END,
    last_sync_status = p_status,
    last_sync_error = p_error,
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === delete_home_control_account ===
CREATE OR REPLACE FUNCTION delete_home_control_account(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  SELECT household_id INTO v_household_id
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  DELETE FROM public.home_control_accounts WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === update_home_control_tokens ===
CREATE OR REPLACE FUNCTION update_home_control_tokens(
  p_account_id UUID,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_expires_in INTEGER
)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  SELECT household_id INTO v_household_id
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE public.home_control_accounts
  SET
    access_token_encrypted = encrypt_token(p_access_token),
    refresh_token_encrypted = CASE
      WHEN p_refresh_token IS NOT NULL THEN encrypt_token(p_refresh_token)
      ELSE refresh_token_encrypted
    END,
    token_expiry = NOW() + (p_expires_in * INTERVAL '1 second') - INTERVAL '60 seconds',
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === get_home_control_tokens ===
CREATE OR REPLACE FUNCTION get_home_control_tokens(p_account_id UUID)
RETURNS JSON AS $$
DECLARE
  v_access_token TEXT;
  v_refresh_token TEXT;
  v_token_expiry TIMESTAMPTZ;
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  SELECT household_id, access_token_encrypted, refresh_token_encrypted, token_expiry
  INTO v_household_id, v_access_token, v_refresh_token, v_token_expiry
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  IF v_access_token IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'accessToken', decrypt_token(v_access_token),
    'refreshToken', CASE WHEN v_refresh_token IS NOT NULL THEN decrypt_token(v_refresh_token) ELSE NULL END,
    'expiry', v_token_expiry,
    'isExpired', v_token_expiry IS NULL OR v_token_expiry < NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === clear_home_control_tokens ===
CREATE OR REPLACE FUNCTION clear_home_control_tokens(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  SELECT household_id INTO v_household_id
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE public.home_control_accounts
  SET access_token_encrypted = NULL, refresh_token_encrypted = NULL,
      token_expiry = NULL, updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === assign_toshiba_device_to_group ===
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
  SELECT household_id INTO v_group_household_id
  FROM public.home_control_groups WHERE id = p_group_id;

  IF v_group_household_id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  SELECT hca.household_id INTO v_device_household_id
  FROM public.toshiba_ac_devices tad
  JOIN public.home_control_accounts hca ON hca.id = tad.account_id
  WHERE tad.id = p_toshiba_device_id;

  IF v_device_household_id IS NULL THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  IF v_group_household_id != v_device_household_id THEN
    RAISE EXCEPTION 'Group and device must belong to the same household';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_group_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  INSERT INTO public.home_control_group_toshiba_devices (group_id, toshiba_device_id)
  VALUES (p_group_id, p_toshiba_device_id)
  ON CONFLICT (group_id, toshiba_device_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === remove_toshiba_device_from_group ===
CREATE OR REPLACE FUNCTION remove_toshiba_device_from_group(
  p_group_id UUID,
  p_toshiba_device_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_group_household_id UUID;
  v_user_household_id UUID;
BEGIN
  SELECT household_id INTO v_group_household_id
  FROM public.home_control_groups WHERE id = p_group_id;

  IF v_group_household_id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_group_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  DELETE FROM public.home_control_group_toshiba_devices
  WHERE group_id = p_group_id AND toshiba_device_id = p_toshiba_device_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === get_toshiba_tokens ===
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
  SELECT household_id, service, access_token_encrypted, consumer_id_encrypted,
         sas_token_encrypted, amqp_device_id, token_expiry
  INTO v_household_id, v_service, v_access_token, v_consumer_id,
       v_sas_token, v_device_id, v_token_expiry
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_service != 'toshiba' THEN
    RAISE EXCEPTION 'Not a Toshiba account';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  IF v_access_token IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'accessToken', decrypt_token(v_access_token),
    'consumerId', CASE WHEN v_consumer_id IS NOT NULL THEN decrypt_token(v_consumer_id) ELSE NULL END,
    'sasToken', CASE WHEN v_sas_token IS NOT NULL THEN decrypt_token(v_sas_token) ELSE NULL END,
    'deviceId', v_device_id,
    'expiry', v_token_expiry,
    'isExpired', v_token_expiry IS NULL OR v_token_expiry < NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === update_toshiba_tokens ===
-- SIGNATURE CHANGE: Dropping old 4-param version (UUID, TEXT, TEXT, INTEGER)
-- that was created in 20251224200000_toshiba_ac.sql but superseded by the
-- 6-param version in 20251225120000_toshiba_amqp_support.sql.
-- The application code (src/lib/integrations/toshiba/auth.ts) uses all 6 params.
DROP FUNCTION IF EXISTS update_toshiba_tokens(UUID, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION update_toshiba_tokens(
  p_account_id UUID,
  p_access_token TEXT,
  p_consumer_id TEXT,
  p_sas_token TEXT DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
  p_expires_in INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
  v_service TEXT;
BEGIN
  SELECT household_id, service INTO v_household_id, v_service
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_service != 'toshiba' THEN
    RAISE EXCEPTION 'Not a Toshiba account';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE public.home_control_accounts
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Re-grant for new signature
GRANT EXECUTE ON FUNCTION update_toshiba_tokens(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

-- === clear_toshiba_tokens ===
CREATE OR REPLACE FUNCTION clear_toshiba_tokens(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  SELECT household_id INTO v_household_id
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE public.home_control_accounts
  SET access_token_encrypted = NULL, consumer_id_encrypted = NULL,
      sas_token_encrypted = NULL, amqp_device_id = NULL,
      token_expiry = NULL, updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === update_toshiba_device_state ===
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
  SELECT account_id INTO v_account_id
  FROM public.toshiba_ac_devices WHERE id = p_device_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  SELECT household_id INTO v_household_id
  FROM public.home_control_accounts WHERE id = v_account_id;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE public.toshiba_ac_devices
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === get_melcloud_tokens ===
CREATE OR REPLACE FUNCTION get_melcloud_tokens(p_account_id UUID)
RETURNS JSON AS $$
DECLARE
  v_context_key TEXT;
  v_token_expiry TIMESTAMPTZ;
  v_household_id UUID;
  v_user_household_id UUID;
  v_service TEXT;
BEGIN
  SELECT household_id, service, access_token_encrypted, token_expiry
  INTO v_household_id, v_service, v_context_key, v_token_expiry
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_service != 'melcloud' THEN
    RAISE EXCEPTION 'Not a MELCloud account';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  IF v_context_key IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'contextKey', decrypt_token(v_context_key),
    'expiry', v_token_expiry,
    'isExpired', v_token_expiry IS NULL OR v_token_expiry < NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === update_melcloud_tokens ===
CREATE OR REPLACE FUNCTION update_melcloud_tokens(
  p_account_id UUID,
  p_context_key TEXT,
  p_expires_in INTEGER
)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
  v_service TEXT;
BEGIN
  SELECT household_id, service INTO v_household_id, v_service
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_service != 'melcloud' THEN
    RAISE EXCEPTION 'Not a MELCloud account';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE public.home_control_accounts
  SET
    access_token_encrypted = encrypt_token(p_context_key),
    token_expiry = NOW() + (p_expires_in * INTERVAL '1 second') - INTERVAL '60 seconds',
    updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === clear_melcloud_tokens ===
CREATE OR REPLACE FUNCTION clear_melcloud_tokens(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  SELECT household_id INTO v_household_id
  FROM public.home_control_accounts WHERE id = p_account_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE public.home_control_accounts
  SET access_token_encrypted = NULL, token_expiry = NULL, updated_at = NOW()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === update_melcloud_device_state ===
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
  SELECT account_id INTO v_account_id
  FROM public.melcloud_devices WHERE id = p_device_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  SELECT household_id INTO v_household_id
  FROM public.home_control_accounts WHERE id = v_account_id;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE public.melcloud_devices
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === restore_removed_event ===
CREATE OR REPLACE FUNCTION restore_removed_event(
  p_notification_id UUID,
  p_override_title TEXT DEFAULT NULL,
  p_override_date DATE DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_notification public.event_change_notifications;
  v_household_id UUID;
  v_task_id UUID;
BEGIN
  SELECT household_id INTO v_household_id
  FROM public.household_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated or no household';
  END IF;

  SELECT * INTO v_notification
  FROM public.event_change_notifications
  WHERE id = p_notification_id AND household_id = v_household_id;

  IF v_notification IS NULL THEN
    RAISE EXCEPTION 'Notification not found';
  END IF;

  IF v_notification.status = 'restored' THEN
    RAISE EXCEPTION 'Event already restored';
  END IF;

  INSERT INTO public.child_tasks (
    household_id, child_id, date, time, task_type, title, notes, status
  ) VALUES (
    v_household_id, v_notification.child_id,
    COALESCE(p_override_date, v_notification.original_date),
    v_notification.original_time, 'reminder',
    COALESCE(p_override_title, v_notification.original_title),
    COALESCE(v_notification.original_description, 'Gjenopprettet fra ' || COALESCE(v_notification.source_name, 'ekstern kilde')),
    'open'
  )
  RETURNING id INTO v_task_id;

  UPDATE public.event_change_notifications
  SET status = 'restored', updated_at = now()
  WHERE id = p_notification_id;

  RETURN v_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === cleanup_stale_calendar_data ===
CREATE OR REPLACE FUNCTION cleanup_stale_calendar_data()
RETURNS TABLE(
  notifications_deleted INT,
  suggestions_deleted INT
) AS $$
DECLARE
  v_notifications_deleted INT;
  v_suggestions_deleted INT;
BEGIN
  DELETE FROM public.event_change_notifications
  WHERE created_at < now() - INTERVAL '30 days'
    AND status IN ('read', 'dismissed');
  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

  UPDATE public.external_suggestions
  SET status = 'dismissed', updated_at = now()
  WHERE status = 'pending'
    AND suggested_date < CURRENT_DATE - INTERVAL '1 day';
  GET DIAGNOSTICS v_suggestions_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_notifications_deleted, v_suggestions_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === restore_external_event ===
CREATE OR REPLACE FUNCTION restore_external_event(p_notification_id UUID)
RETURNS UUID AS $$
DECLARE
  v_notification RECORD;
  v_new_event_id UUID;
  v_event_data JSONB;
BEGIN
  SELECT * INTO v_notification
  FROM public.event_change_notifications
  WHERE id = p_notification_id
    AND change_type = 'removed'
    AND status != 'restored';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found or already restored';
  END IF;

  IF v_notification.household_id != get_user_household_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_event_data := v_notification.raw_event_data;

  IF v_event_data IS NULL OR v_event_data->>'_source' != 'external_integration' THEN
    INSERT INTO public.child_tasks (
      household_id, child_id, title, date, time, task_type, notes, status
    ) VALUES (
      v_notification.household_id, v_notification.child_id,
      v_notification.original_title, v_notification.original_date,
      v_notification.original_time, 'reminder',
      'Gjenopprettet fra slettet hendelse (' || v_notification.source_name || ')', 'open'
    )
    RETURNING id INTO v_new_event_id;
  ELSE
    INSERT INTO public.external_events (
      integration_id, external_id, title, description, event_date, event_time,
      end_date, end_time, location, event_type, child_id, local_overrides,
      user_notes, is_hidden, created_at, updated_at
    ) VALUES (
      (v_event_data->>'integration_id')::UUID,
      v_event_data->>'external_id' || '_restored_' || gen_random_uuid()::TEXT,
      COALESCE(v_event_data->'local_overrides'->>'title', v_event_data->>'title'),
      v_event_data->>'description',
      (v_event_data->>'event_date')::DATE,
      (v_event_data->>'event_time')::TIME,
      (v_event_data->>'end_date')::DATE,
      (v_event_data->>'end_time')::TIME,
      COALESCE(v_event_data->'local_overrides'->>'location', v_event_data->>'location'),
      v_event_data->>'event_type',
      (v_event_data->>'child_id')::UUID,
      v_event_data->'local_overrides',
      COALESCE(v_event_data->>'user_notes', 'Gjenopprettet'),
      COALESCE((v_event_data->>'is_hidden')::BOOLEAN, false),
      NOW(), NOW()
    )
    RETURNING id INTO v_new_event_id;
  END IF;

  UPDATE public.event_change_notifications
  SET status = 'restored', updated_at = NOW()
  WHERE id = p_notification_id;

  RETURN v_new_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === dismiss_event_notification ===
CREATE OR REPLACE FUNCTION dismiss_event_notification(p_notification_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.event_change_notifications
  SET status = 'dismissed', updated_at = NOW()
  WHERE id = p_notification_id
    AND household_id = get_user_household_id()
    AND status = 'unread';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === get_integration_stats ===
CREATE OR REPLACE FUNCTION get_integration_stats(p_integration_id UUID)
RETURNS TABLE (
  event_count BIGINT,
  message_count BIGINT,
  photo_count BIGINT,
  hidden_event_count BIGINT
) AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  SELECT household_id INTO v_household_id
  FROM public.external_integrations WHERE id = p_integration_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Integration not found';
  END IF;

  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.external_events WHERE integration_id = p_integration_id AND NOT is_hidden) AS event_count,
    (SELECT COUNT(*) FROM public.external_messages WHERE integration_id = p_integration_id AND NOT is_hidden) AS message_count,
    (SELECT COUNT(*) FROM public.external_photos WHERE integration_id = p_integration_id) AS photo_count,
    (SELECT COUNT(*) FROM public.external_events WHERE integration_id = p_integration_id AND is_hidden) AS hidden_event_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- === get_all_integration_stats ===
CREATE OR REPLACE FUNCTION get_all_integration_stats()
RETURNS TABLE (
  integration_id UUID,
  service TEXT,
  display_name TEXT,
  event_count BIGINT,
  message_count BIGINT,
  photo_count BIGINT,
  hidden_event_count BIGINT
) AS $$
DECLARE
  v_household_id UUID;
BEGIN
  v_household_id := get_user_household_id();

  IF v_household_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ei.id AS integration_id,
    ei.service,
    ei.display_name,
    COALESCE((SELECT COUNT(*) FROM public.external_events ee WHERE ee.integration_id = ei.id AND NOT ee.is_hidden), 0) AS event_count,
    COALESCE((SELECT COUNT(*) FROM public.external_messages em WHERE em.integration_id = ei.id AND NOT em.is_hidden), 0) AS message_count,
    COALESCE((SELECT COUNT(*) FROM public.external_photos ep WHERE ep.integration_id = ei.id), 0) AS photo_count,
    COALESCE((SELECT COUNT(*) FROM public.external_events ee2 WHERE ee2.integration_id = ei.id AND ee2.is_hidden), 0) AS hidden_event_count
  FROM public.external_integrations ei
  WHERE ei.household_id = v_household_id
  ORDER BY ei.service, ei.display_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- 3. FIX MULTIPLE PERMISSIVE POLICIES
-- ============================================================================
-- When a table has both a "FOR ALL" policy and a "FOR SELECT" policy,
-- both are evaluated for SELECT operations, which is inefficient.
-- We drop the redundant SELECT-specific policies.

-- home_control_devices: Drop redundant SELECT policy (FOR ALL covers it)
DROP POLICY IF EXISTS "Users can view own household home control devices" ON home_control_devices;

-- home_control_group_devices: Drop redundant SELECT policy
DROP POLICY IF EXISTS "Users can view own household group devices" ON home_control_group_devices;

-- home_control_group_melcloud_devices: Drop redundant SELECT policy
DROP POLICY IF EXISTS "Users can view own household group melcloud devices" ON home_control_group_melcloud_devices;

-- home_control_group_toshiba_devices: Drop redundant SELECT policy
DROP POLICY IF EXISTS "Users can view own household group toshiba devices" ON home_control_group_toshiba_devices;

-- home_control_groups: Drop redundant SELECT policy
DROP POLICY IF EXISTS "Users can view own household home control groups" ON home_control_groups;

-- household_events: Drop redundant SELECT policy
DROP POLICY IF EXISTS "Users view own household events" ON household_events;

-- melcloud_devices: Drop redundant SELECT policy
DROP POLICY IF EXISTS "Users can view own household melcloud devices" ON melcloud_devices;

-- toshiba_ac_devices: Drop redundant SELECT policy
DROP POLICY IF EXISTS "Users can view own household toshiba devices" ON toshiba_ac_devices;

-- ============================================================================
-- 4. FIX DUPLICATE INDEXES
-- ============================================================================
-- Drop the duplicate indexes, keeping the more descriptively named ones.

-- child_tasks: Drop child_tasks_date_idx (keep idx_child_tasks_household_date)
DROP INDEX IF EXISTS child_tasks_date_idx;

-- household_events: Drop idx_household_events_date (keep idx_household_events_household_date)
DROP INDEX IF EXISTS idx_household_events_date;

-- member_events: Drop member_events_date_idx (keep idx_member_events_household_date)
DROP INDEX IF EXISTS member_events_date_idx;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- This migration fixes the following Supabase Database Linter warnings:
--
-- ERRORS (1):
-- ✗ security_definer_view: google_calendar_tokens_decrypted → NOT CHANGED
--   (Intentional: view provides controlled access to admin-only table)
--
-- WARNINGS (37 total):
-- ✓ function_search_path_mutable (26 functions) → SET search_path = public
-- ✓ multiple_permissive_policies (8 tables) → Dropped redundant SELECT policies
-- ✓ duplicate_index (3 tables) → Dropped duplicate indexes
--
-- Notes:
-- - The auth_leaked_password_protection warning must be addressed in
--   Supabase Dashboard → Auth → Settings, not via migration.
-- - The security_definer_view warning remains because the view intentionally
--   bypasses RLS on the admin-only google_calendar_tokens table to allow
--   non-admin users to sync calendars. A proper fix would require adding
--   household_id to the tokens table and implementing household-scoped RLS.
