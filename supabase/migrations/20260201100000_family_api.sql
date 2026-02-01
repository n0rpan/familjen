-- ============================================
-- Family API: API Keys & Webhooks
-- Enables external AI assistants to read/write family data
-- ============================================

-- ============================================
-- 1. API Keys Table (Pull API)
-- ============================================
CREATE TABLE household_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,           -- SHA256 hash of full key (never store plaintext)
  key_prefix TEXT NOT NULL,         -- First 8 chars for display (e.g., "fam_abc1")
  name TEXT NOT NULL,               -- User-friendly name (e.g., "My AI Assistant")
  scopes TEXT[] NOT NULL DEFAULT '{}',  -- Permissions: ['pickups:read', 'pickups:write']
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ            -- NULL = active, set = revoked
);

-- Indexes
CREATE INDEX idx_api_keys_household ON household_api_keys(household_id);
CREATE INDEX idx_api_keys_hash ON household_api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_prefix ON household_api_keys(key_prefix);

-- RLS
ALTER TABLE household_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view their API keys"
  ON household_api_keys FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Household admins can insert API keys"
  ON household_api_keys FOR INSERT TO authenticated
  WITH CHECK (
    household_id = get_user_household_id()
    AND is_household_admin()
  );

CREATE POLICY "Household admins can update API keys"
  ON household_api_keys FOR UPDATE TO authenticated
  USING (
    household_id = get_user_household_id()
    AND is_household_admin()
  )
  WITH CHECK (
    household_id = get_user_household_id()
    AND is_household_admin()
  );

CREATE POLICY "Household admins can delete API keys"
  ON household_api_keys FOR DELETE TO authenticated
  USING (
    household_id = get_user_household_id()
    AND is_household_admin()
  );

-- ============================================
-- 2. Webhooks Table (Push API)
-- ============================================
CREATE TABLE household_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  url TEXT NOT NULL,                 -- Webhook endpoint URL
  secret_encrypted TEXT NOT NULL,    -- Encrypted HMAC secret for signing payloads
  events TEXT[] NOT NULL,            -- Events to subscribe to: ['pickup.*', 'meal.planned']
  name TEXT,                         -- User-friendly name
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_triggered_at TIMESTAMPTZ,
  last_status INTEGER,               -- HTTP status code from last delivery
  failure_count INTEGER NOT NULL DEFAULT 0,
  disabled_at TIMESTAMPTZ            -- Auto-disabled after too many failures
);

-- Indexes
CREATE INDEX idx_webhooks_household ON household_webhooks(household_id);
CREATE INDEX idx_webhooks_active ON household_webhooks(household_id)
  WHERE disabled_at IS NULL;

-- RLS
ALTER TABLE household_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view their webhooks"
  ON household_webhooks FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Household admins can insert webhooks"
  ON household_webhooks FOR INSERT TO authenticated
  WITH CHECK (
    household_id = get_user_household_id()
    AND is_household_admin()
  );

CREATE POLICY "Household admins can update webhooks"
  ON household_webhooks FOR UPDATE TO authenticated
  USING (
    household_id = get_user_household_id()
    AND is_household_admin()
  )
  WITH CHECK (
    household_id = get_user_household_id()
    AND is_household_admin()
  );

CREATE POLICY "Household admins can delete webhooks"
  ON household_webhooks FOR DELETE TO authenticated
  USING (
    household_id = get_user_household_id()
    AND is_household_admin()
  );

-- ============================================
-- 3. Webhook Deliveries Table (Audit Log)
-- ============================================
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES household_webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,          -- e.g., 'pickup.updated'
  payload JSONB NOT NULL,            -- Full payload sent
  status INTEGER,                    -- HTTP status code (NULL if not delivered yet)
  error TEXT,                        -- Error message if failed
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ           -- When successfully delivered
);

-- Indexes
CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_pending ON webhook_deliveries(webhook_id, created_at)
  WHERE status IS NULL OR (status >= 400 AND attempts < 3);
CREATE INDEX idx_webhook_deliveries_created ON webhook_deliveries(created_at);

-- RLS
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Users can view deliveries for webhooks they can see
CREATE POLICY "Household members can view webhook deliveries"
  ON webhook_deliveries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM household_webhooks w
      WHERE w.id = webhook_deliveries.webhook_id
        AND w.household_id = get_user_household_id()
    )
  );

-- No direct insert/update/delete for users - managed by system

-- ============================================
-- 4. Helper Functions
-- ============================================

-- Generate a secure random API key
-- Returns: { key: 'fam_xxxxx...', hash: 'sha256hash', prefix: 'fam_xxxx' }
CREATE OR REPLACE FUNCTION generate_api_key()
RETURNS JSONB AS $$
DECLARE
  v_random_bytes BYTEA;
  v_key TEXT;
  v_hash TEXT;
  v_prefix TEXT;
BEGIN
  -- Generate 24 random bytes (will be 32 chars in base64)
  v_random_bytes := extensions.gen_random_bytes(24);
  v_key := 'fam_' || encode(v_random_bytes, 'base64');
  -- Replace URL-unsafe characters
  v_key := replace(replace(v_key, '+', '-'), '/', '_');
  -- Remove padding
  v_key := replace(v_key, '=', '');

  -- Hash for storage
  v_hash := encode(extensions.digest(v_key, 'sha256'), 'hex');

  -- Prefix for display (first 8 chars after 'fam_')
  v_prefix := substring(v_key from 1 for 12);

  RETURN jsonb_build_object(
    'key', v_key,
    'hash', v_hash,
    'prefix', v_prefix
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Validate an API key and return household_id if valid
-- Updates last_used_at on successful validation
CREATE OR REPLACE FUNCTION validate_api_key(p_key TEXT)
RETURNS TABLE (
  household_id UUID,
  key_id UUID,
  scopes TEXT[]
) AS $$
DECLARE
  v_hash TEXT;
  v_record RECORD;
BEGIN
  IF p_key IS NULL OR NOT p_key LIKE 'fam_%' THEN
    RETURN;
  END IF;

  v_hash := encode(extensions.digest(p_key, 'sha256'), 'hex');

  SELECT ak.household_id, ak.id as key_id, ak.scopes
  INTO v_record
  FROM household_api_keys ak
  WHERE ak.key_hash = v_hash
    AND ak.revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Update last_used_at
  UPDATE household_api_keys
  SET last_used_at = NOW()
  WHERE id = v_record.key_id;

  RETURN QUERY SELECT v_record.household_id, v_record.key_id, v_record.scopes;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute to anon for API key validation (used before auth)
GRANT EXECUTE ON FUNCTION validate_api_key(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION validate_api_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_api_key() TO authenticated;

-- Create API key with automatic key generation
-- Returns the full key (only shown once!)
CREATE OR REPLACE FUNCTION create_api_key(
  p_name TEXT,
  p_scopes TEXT[] DEFAULT '{}'
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
  IF NOT is_household_admin() THEN
    RAISE EXCEPTION 'Must be household admin to create API keys';
  END IF;

  v_household_id := get_user_household_id();
  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'No household found';
  END IF;

  -- Generate key
  v_key_data := generate_api_key();

  -- Insert key record
  INSERT INTO household_api_keys (
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION create_api_key(TEXT, TEXT[]) TO authenticated;

-- Revoke an API key
CREATE OR REPLACE FUNCTION revoke_api_key(p_key_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_household_id UUID;
BEGIN
  IF NOT is_household_admin() THEN
    RAISE EXCEPTION 'Must be household admin to revoke API keys';
  END IF;

  v_household_id := get_user_household_id();

  UPDATE household_api_keys
  SET revoked_at = NOW()
  WHERE id = p_key_id
    AND household_id = v_household_id
    AND revoked_at IS NULL;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION revoke_api_key(UUID) TO authenticated;

-- ============================================
-- 5. Webhook Helper Functions
-- ============================================

-- Create webhook with encrypted secret
CREATE OR REPLACE FUNCTION create_webhook(
  p_url TEXT,
  p_events TEXT[],
  p_name TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_household_id UUID;
  v_user_id UUID;
  v_secret TEXT;
  v_webhook_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_household_admin() THEN
    RAISE EXCEPTION 'Must be household admin to create webhooks';
  END IF;

  v_household_id := get_user_household_id();
  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'No household found';
  END IF;

  -- Generate secret (32 random bytes, hex encoded = 64 chars)
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO household_webhooks (
    household_id, url, secret_encrypted, events, name, created_by
  )
  VALUES (
    v_household_id,
    p_url,
    encrypt_token(v_secret),
    p_events,
    p_name,
    v_user_id
  )
  RETURNING id INTO v_webhook_id;

  -- Return webhook info with secret (only shown once!)
  RETURN jsonb_build_object(
    'id', v_webhook_id,
    'url', p_url,
    'secret', v_secret,
    'events', p_events,
    'name', p_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION create_webhook(TEXT, TEXT[], TEXT) TO authenticated;

-- Get webhook secret (decrypted) for system use
CREATE OR REPLACE FUNCTION get_webhook_secret(p_webhook_id UUID)
RETURNS TEXT AS $$
  SELECT decrypt_token(secret_encrypted)
  FROM household_webhooks
  WHERE id = p_webhook_id;
$$ LANGUAGE SQL SECURITY DEFINER SET search_path = public;

-- Only service role should use this (not exposed to clients)
REVOKE EXECUTE ON FUNCTION get_webhook_secret(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_webhook_secret(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION get_webhook_secret(UUID) FROM authenticated;

-- Get active webhooks for a household that match an event
CREATE OR REPLACE FUNCTION get_matching_webhooks(
  p_household_id UUID,
  p_event_type TEXT
)
RETURNS TABLE (
  id UUID,
  url TEXT,
  secret TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id,
    w.url,
    decrypt_token(w.secret_encrypted) as secret
  FROM household_webhooks w
  WHERE w.household_id = p_household_id
    AND w.disabled_at IS NULL
    AND (
      -- Exact match
      p_event_type = ANY(w.events)
      -- Wildcard match (e.g., 'pickup.*' matches 'pickup.created')
      OR EXISTS (
        SELECT 1 FROM unnest(w.events) e
        WHERE e = '*'
          OR (e LIKE '%.*' AND p_event_type LIKE replace(e, '.*', '.%'))
      )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Only service role should use this
REVOKE EXECUTE ON FUNCTION get_matching_webhooks(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_matching_webhooks(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION get_matching_webhooks(UUID, TEXT) FROM authenticated;

-- Record webhook delivery attempt
CREATE OR REPLACE FUNCTION record_webhook_delivery(
  p_webhook_id UUID,
  p_event_type TEXT,
  p_payload JSONB,
  p_status INTEGER DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_delivery_id UUID;
BEGIN
  INSERT INTO webhook_deliveries (
    webhook_id, event_type, payload, status, error,
    delivered_at
  )
  VALUES (
    p_webhook_id, p_event_type, p_payload, p_status, p_error,
    CASE WHEN p_status IS NOT NULL AND p_status < 400 THEN NOW() ELSE NULL END
  )
  RETURNING id INTO v_delivery_id;

  -- Update webhook stats
  UPDATE household_webhooks
  SET
    last_triggered_at = NOW(),
    last_status = p_status,
    failure_count = CASE
      WHEN p_status IS NULL OR p_status >= 400 THEN failure_count + 1
      ELSE 0  -- Reset on success
    END,
    -- Auto-disable after 10 consecutive failures
    disabled_at = CASE
      WHEN failure_count >= 9 AND (p_status IS NULL OR p_status >= 400) THEN NOW()
      ELSE disabled_at
    END
  WHERE id = p_webhook_id;

  RETURN v_delivery_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Only service role should use this
REVOKE EXECUTE ON FUNCTION record_webhook_delivery(UUID, TEXT, JSONB, INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_webhook_delivery(UUID, TEXT, JSONB, INTEGER, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION record_webhook_delivery(UUID, TEXT, JSONB, INTEGER, TEXT) FROM authenticated;

-- ============================================
-- 6. API Data Access Functions
-- ============================================

-- Get pickups for API (bypasses RLS, uses API key validation)
CREATE OR REPLACE FUNCTION api_get_pickups(
  p_household_id UUID,
  p_from_date DATE,
  p_to_date DATE
)
RETURNS JSONB AS $$
BEGIN
  RETURN (
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
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant to anon for API access (validation happens in API route)
GRANT EXECUTE ON FUNCTION api_get_pickups(UUID, DATE, DATE) TO anon;
GRANT EXECUTE ON FUNCTION api_get_pickups(UUID, DATE, DATE) TO authenticated;

-- Get children for API
CREATE OR REPLACE FUNCTION api_get_children(p_household_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN (
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
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION api_get_children(UUID) TO anon;
GRANT EXECUTE ON FUNCTION api_get_children(UUID) TO authenticated;

-- Get household members for API
CREATE OR REPLACE FUNCTION api_get_members(p_household_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN (
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
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION api_get_members(UUID) TO anon;
GRANT EXECUTE ON FUNCTION api_get_members(UUID) TO authenticated;

-- Upsert pickup via API
CREATE OR REPLACE FUNCTION api_upsert_pickup(
  p_household_id UUID,
  p_child_id UUID,
  p_date DATE,
  p_picker_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_pickup_id UUID;
  v_is_insert BOOLEAN;
BEGIN
  -- Verify child belongs to household
  IF NOT EXISTS (
    SELECT 1 FROM children
    WHERE id = p_child_id AND household_id = p_household_id
  ) THEN
    RAISE EXCEPTION 'Child not found in household';
  END IF;

  -- Verify picker belongs to household (if provided)
  IF p_picker_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM household_members
    WHERE id = p_picker_id AND household_id = p_household_id
  ) THEN
    RAISE EXCEPTION 'Picker not found in household';
  END IF;

  -- Check if pickup exists
  SELECT id INTO v_pickup_id
  FROM pickups
  WHERE household_id = p_household_id
    AND child_id = p_child_id
    AND date = p_date;

  v_is_insert := v_pickup_id IS NULL;

  -- Upsert
  INSERT INTO pickups (household_id, child_id, date, picker_id, notes)
  VALUES (p_household_id, p_child_id, p_date, p_picker_id, p_notes)
  ON CONFLICT (household_id, child_id, date)
  DO UPDATE SET
    picker_id = EXCLUDED.picker_id,
    notes = EXCLUDED.notes,
    updated_at = NOW()
  RETURNING id INTO v_pickup_id;

  RETURN jsonb_build_object(
    'id', v_pickup_id,
    'operation', CASE WHEN v_is_insert THEN 'created' ELSE 'updated' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION api_upsert_pickup(UUID, UUID, DATE, UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION api_upsert_pickup(UUID, UUID, DATE, UUID, TEXT) TO authenticated;

-- Delete pickup via API
CREATE OR REPLACE FUNCTION api_delete_pickup(
  p_household_id UUID,
  p_pickup_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM pickups
  WHERE id = p_pickup_id
    AND household_id = p_household_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION api_delete_pickup(UUID, UUID) TO anon;
GRANT EXECUTE ON FUNCTION api_delete_pickup(UUID, UUID) TO authenticated;

-- ============================================
-- 7. Cleanup: Auto-delete old webhook deliveries
-- ============================================

-- Keep deliveries for 30 days
CREATE OR REPLACE FUNCTION cleanup_old_webhook_deliveries()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM webhook_deliveries
  WHERE created_at < NOW() - INTERVAL '30 days'
  RETURNING 1 INTO v_deleted;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
