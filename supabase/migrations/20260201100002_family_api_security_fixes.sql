-- ============================================
-- Family API Security Fixes
-- Addresses code review findings
-- ============================================

-- Note: validate_api_key already includes key_id in base migration

-- ============================================
-- 1. Add input length constraints
-- ============================================
ALTER TABLE household_api_keys
  ADD CONSTRAINT api_key_name_length CHECK (length(name) <= 100);

ALTER TABLE household_webhooks
  ADD CONSTRAINT webhook_name_length CHECK (name IS NULL OR length(name) <= 100),
  ADD CONSTRAINT webhook_url_length CHECK (length(url) <= 2000);

-- ============================================
-- 2. Add API audit log table
-- ============================================
CREATE TABLE IF NOT EXISTS api_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id UUID REFERENCES household_api_keys(id) ON DELETE SET NULL,
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,               -- 'read' or 'write'
  endpoint TEXT NOT NULL,                -- '/api/family/pickups'
  method TEXT NOT NULL,                  -- 'GET', 'POST', 'DELETE'
  ip_address TEXT,
  user_agent TEXT,
  request_id TEXT,                       -- For correlating requests
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by key or household
CREATE INDEX idx_api_audit_key ON api_audit_log(key_id, created_at DESC);
CREATE INDEX idx_api_audit_household ON api_audit_log(household_id, created_at DESC);

-- Auto-cleanup: keep logs for 90 days
CREATE INDEX idx_api_audit_cleanup ON api_audit_log(created_at) WHERE created_at < NOW() - INTERVAL '90 days';

-- RLS - only admins can view audit logs
ALTER TABLE api_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household admins can view audit logs"
  ON api_audit_log FOR SELECT TO authenticated
  USING (
    household_id = get_user_household_id()
    AND is_household_admin()
  );

-- Function to log API access
CREATE OR REPLACE FUNCTION log_api_access(
  p_key_id UUID,
  p_household_id UUID,
  p_operation TEXT,
  p_endpoint TEXT,
  p_method TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  -- Note: Use public. prefix because SET search_path = '' clears default schema
  INSERT INTO public.api_audit_log (
    key_id, household_id, operation, endpoint, method,
    ip_address, user_agent, request_id
  ) VALUES (
    p_key_id, p_household_id, p_operation, p_endpoint, p_method,
    p_ip_address,
    -- Truncate user agent to prevent abuse
    LEFT(p_user_agent, 500),
    p_request_id
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Only service role should use this
REVOKE EXECUTE ON FUNCTION log_api_access(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION log_api_access(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION log_api_access(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;

-- ============================================
-- 3. Fix webhook failure count logic (off-by-one fix)
-- ============================================
-- BUG FIX: The original migration (20260201100000) had `failure_count >= 9`
-- which would disable at the 9th failure (only allowing 8 failures).
-- This fix changes to `(v_current_failure_count + 1) >= 10` which:
-- - Reads the LOCKED failure_count value (prevents race conditions)
-- - Checks if the NEW count (after this failure) will reach 10
-- - Correctly allows 9 failures before disabling at the 10th
CREATE OR REPLACE FUNCTION record_webhook_delivery(
  p_webhook_id UUID,
  p_event_type TEXT,
  p_payload JSONB,
  p_status INTEGER DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_delivery_id UUID DEFAULT NULL  -- For idempotency
)
RETURNS UUID AS $$
DECLARE
  v_delivery_id UUID;
  v_current_failure_count INTEGER;
BEGIN
  -- Use provided ID or generate new one
  v_delivery_id := COALESCE(p_delivery_id, gen_random_uuid());

  -- Note: Use public. prefix because SET search_path = '' clears default schema
  INSERT INTO public.webhook_deliveries (
    id, webhook_id, event_type, payload, status, error,
    delivered_at
  )
  VALUES (
    v_delivery_id, p_webhook_id, p_event_type, p_payload, p_status, p_error,
    CASE WHEN p_status IS NOT NULL AND p_status < 400 THEN NOW() ELSE NULL END
  )
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    error = EXCLUDED.error,
    delivered_at = EXCLUDED.delivered_at,
    attempts = public.webhook_deliveries.attempts + 1;

  -- Get current failure count with row lock to prevent race conditions
  -- FOR UPDATE ensures only one transaction can modify this webhook at a time
  SELECT failure_count INTO v_current_failure_count
  FROM public.household_webhooks
  WHERE id = p_webhook_id
  FOR UPDATE;

  -- Update webhook stats using the locked failure count to prevent race conditions
  UPDATE public.household_webhooks
  SET
    last_triggered_at = NOW(),
    last_status = p_status,
    -- Use v_current_failure_count + 1 (not failure_count + 1) to prevent lost updates
    -- This ensures we use the locked value from the SELECT FOR UPDATE
    failure_count = CASE
      WHEN p_status IS NULL OR p_status >= 400 THEN v_current_failure_count + 1
      ELSE 0  -- Reset on success
    END,
    -- Auto-disable webhook at the 10th consecutive failure
    -- When v_current_failure_count=9, the next failure makes it 10, so we disable
    -- This means: failures 1-9 are allowed, failure 10 triggers disable
    disabled_at = CASE
      WHEN (v_current_failure_count + 1) >= 10 AND (p_status IS NULL OR p_status >= 400) THEN NOW()
      ELSE disabled_at
    END
  WHERE id = p_webhook_id;

  RETURN v_delivery_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Only service role should use this
REVOKE EXECUTE ON FUNCTION record_webhook_delivery(UUID, TEXT, JSONB, INTEGER, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_webhook_delivery(UUID, TEXT, JSONB, INTEGER, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION record_webhook_delivery(UUID, TEXT, JSONB, INTEGER, TEXT, UUID) FROM authenticated;

-- ============================================
-- 4. Fix create_api_key to require at least one scope
-- ============================================
CREATE OR REPLACE FUNCTION create_api_key(
  p_name TEXT,
  p_scopes TEXT[]
)
RETURNS JSONB AS $$
DECLARE
  v_household_id UUID;
  v_user_id UUID;
  v_key_data JSONB;
  v_key_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check household admin
  -- Note: Use public. prefix because SET search_path = '' clears default schema
  IF NOT public.is_household_admin() THEN
    RAISE EXCEPTION 'Must be household admin to create API keys';
  END IF;

  v_household_id := public.get_user_household_id();
  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'No household found';
  END IF;

  -- Validate name length
  IF length(p_name) > 100 THEN
    RAISE EXCEPTION 'Name must be 100 characters or less';
  END IF;

  -- SECURITY FIX: Require at least one scope (fail-closed)
  IF p_scopes IS NULL OR array_length(p_scopes, 1) IS NULL OR array_length(p_scopes, 1) = 0 THEN
    RAISE EXCEPTION 'At least one scope is required. Empty scopes would create a useless key.';
  END IF;

  -- Generate key
  v_key_data := public.generate_api_key();

  -- Insert key record
  -- Note: Use public. prefix because SET search_path = '' clears default schema
  INSERT INTO public.household_api_keys (
    household_id, key_hash, key_prefix, name, scopes, created_by
  )
  VALUES (
    v_household_id,
    v_key_data->>'hash',
    v_key_data->>'prefix',
    p_name,
    p_scopes,
    v_user_id
  )
  RETURNING id INTO v_key_id;

  -- Return key (only time it's shown!)
  RETURN jsonb_build_object(
    'id', v_key_id,
    'key', v_key_data->>'key',
    'prefix', v_key_data->>'prefix',
    'name', p_name,
    'scopes', p_scopes
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION create_api_key(TEXT, TEXT[]) TO authenticated;

-- ============================================
-- 5. Cleanup function for audit logs
-- ============================================
-- IMPORTANT: This function must be scheduled to run automatically.
-- Without scheduling, audit logs will grow unbounded.
--
-- Option 1: Supabase pg_cron (recommended for Supabase projects)
--   SELECT cron.schedule(
--     'cleanup-api-audit-logs',
--     '0 3 * * *',  -- Daily at 3 AM UTC
--     'SELECT cleanup_old_audit_logs();'
--   );
--
-- Option 2: External cron (e.g., GitHub Actions, Vercel cron)
--   Call: POST /api/admin/cleanup-audit-logs (create this endpoint if needed)
--
-- Option 3: Manual cleanup (not recommended for production)
--   SELECT cleanup_old_audit_logs();
--
-- Data retention: 90 days (compliance/debugging), then deleted.
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- Note: Use public. prefix because SET search_path = '' clears default schema
  DELETE FROM public.api_audit_log
  WHERE created_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
