-- Migration: External Integrations (Spond, Kidplan, iSkole)
-- Adds tables for syncing events and messages from external services

-- ============================================================================
-- Admin control flag on households
-- ============================================================================
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS external_integrations_enabled BOOLEAN DEFAULT false;

-- ============================================================================
-- External Integrations (credentials storage)
-- ============================================================================
CREATE TABLE IF NOT EXISTS external_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('spond', 'kidplan', 'iskole')),
  credentials_encrypted TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_email TEXT, -- The email used to login (for display purposes)
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT DEFAULT 'pending' CHECK (last_sync_status IN ('pending', 'ok', 'auth_failed', 'error')),
  last_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(household_id, service, display_name)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_external_integrations_household
  ON external_integrations(household_id);
CREATE INDEX IF NOT EXISTS idx_external_integrations_service
  ON external_integrations(household_id, service);

-- ============================================================================
-- Child-to-Integration mapping (which children belong to which groups)
-- ============================================================================
CREATE TABLE IF NOT EXISTS external_integration_children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES external_integrations(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  external_group_id TEXT,
  external_group_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(integration_id, child_id, external_group_id)
);

CREATE INDEX IF NOT EXISTS idx_external_integration_children_integration
  ON external_integration_children(integration_id);
CREATE INDEX IF NOT EXISTS idx_external_integration_children_child
  ON external_integration_children(child_id);

-- ============================================================================
-- External Events (synced from Spond etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES external_integrations(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  external_group_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  event_time TIME,
  end_date DATE,
  end_time TIME,
  location TEXT,
  event_type TEXT,
  raw_data JSONB,
  -- Local modifications (not synced back)
  is_hidden BOOLEAN DEFAULT false,
  user_notes TEXT,
  modified_by UUID REFERENCES household_members(id),
  modified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(integration_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_events_integration
  ON external_events(integration_id);
CREATE INDEX IF NOT EXISTS idx_external_events_child
  ON external_events(child_id);
CREATE INDEX IF NOT EXISTS idx_external_events_date
  ON external_events(event_date);
CREATE INDEX IF NOT EXISTS idx_external_events_lookup
  ON external_events(integration_id, event_date) WHERE NOT is_hidden;

-- ============================================================================
-- External Messages (synced from Spond chats etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS external_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES external_integrations(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  external_group_id TEXT,
  chat_id TEXT,
  sender_name TEXT,
  title TEXT,
  body TEXT NOT NULL,
  message_date TIMESTAMPTZ NOT NULL,
  is_processed BOOLEAN DEFAULT false, -- Has AI analyzed this message?
  -- Local modifications
  is_hidden BOOLEAN DEFAULT false,
  user_notes TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(integration_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_messages_integration
  ON external_messages(integration_id);
CREATE INDEX IF NOT EXISTS idx_external_messages_child
  ON external_messages(child_id);
CREATE INDEX IF NOT EXISTS idx_external_messages_date
  ON external_messages(message_date);
CREATE INDEX IF NOT EXISTS idx_external_messages_unprocessed
  ON external_messages(integration_id, is_processed) WHERE NOT is_processed;

-- ============================================================================
-- External Suggestions (AI-extracted action items awaiting review)
-- ============================================================================
CREATE TABLE IF NOT EXISTS external_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES external_integrations(id) ON DELETE CASCADE,
  source_message_id UUID REFERENCES external_messages(id) ON DELETE CASCADE,
  source_event_id UUID REFERENCES external_events(id) ON DELETE CASCADE,
  suggested_type TEXT NOT NULL CHECK (suggested_type IN ('task', 'event', 'reminder')),
  suggested_child_id UUID REFERENCES children(id) ON DELETE SET NULL,
  suggested_date DATE,
  suggested_time TIME,
  suggested_title TEXT NOT NULL,
  suggested_description TEXT,
  confidence_score FLOAT CHECK (confidence_score >= 0 AND confidence_score <= 1),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  reviewed_by UUID REFERENCES household_members(id),
  reviewed_at TIMESTAMPTZ,
  created_task_id UUID REFERENCES child_tasks(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  -- Either source_message_id or source_event_id should be set
  CHECK (source_message_id IS NOT NULL OR source_event_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_external_suggestions_household
  ON external_suggestions(household_id);
CREATE INDEX IF NOT EXISTS idx_external_suggestions_pending
  ON external_suggestions(household_id, status) WHERE status = 'pending';

-- ============================================================================
-- RLS Policies
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE external_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_integration_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_suggestions ENABLE ROW LEVEL SECURITY;

-- external_integrations policies
CREATE POLICY "Users can view own household integrations"
  ON external_integrations FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert integrations for own household"
  ON external_integrations FOR INSERT
  TO authenticated
  WITH CHECK (
    household_id = get_user_household_id()
    AND EXISTS (
      SELECT 1 FROM households
      WHERE id = household_id
      AND external_integrations_enabled = true
    )
  );

CREATE POLICY "Users can update own household integrations"
  ON external_integrations FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can delete own household integrations"
  ON external_integrations FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- external_integration_children policies
CREATE POLICY "Users can view own household integration children"
  ON external_integration_children FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

CREATE POLICY "Users can manage own household integration children"
  ON external_integration_children FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

-- external_events policies
CREATE POLICY "Users can view own household external events"
  ON external_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

CREATE POLICY "Users can update own household external events"
  ON external_events FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

CREATE POLICY "Users can insert own household external events"
  ON external_events FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

-- external_messages policies
CREATE POLICY "Users can view own household external messages"
  ON external_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

CREATE POLICY "Users can update own household external messages"
  ON external_messages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

CREATE POLICY "Users can insert own household external messages"
  ON external_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

-- external_suggestions policies
CREATE POLICY "Users can view own household suggestions"
  ON external_suggestions FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can update own household suggestions"
  ON external_suggestions FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id());

-- ============================================================================
-- RPC Functions
-- ============================================================================

-- Upsert external integration with encrypted credentials
CREATE OR REPLACE FUNCTION upsert_external_integration(
  p_household_id UUID,
  p_service TEXT,
  p_display_name TEXT,
  p_credentials JSON,
  p_account_email TEXT DEFAULT NULL
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

  -- Verify household has integrations enabled
  IF NOT EXISTS (
    SELECT 1 FROM households
    WHERE id = p_household_id
    AND external_integrations_enabled = true
  ) THEN
    RAISE EXCEPTION 'External integrations not enabled for this household';
  END IF;

  INSERT INTO external_integrations (
    household_id,
    service,
    display_name,
    credentials_encrypted,
    account_email,
    updated_at
  )
  VALUES (
    p_household_id,
    p_service,
    p_display_name,
    encrypt_token(p_credentials::TEXT),
    p_account_email,
    NOW()
  )
  ON CONFLICT (household_id, service, display_name) DO UPDATE SET
    credentials_encrypted = encrypt_token(p_credentials::TEXT),
    account_email = COALESCE(p_account_email, external_integrations.account_email),
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get decrypted credentials for an integration (for sync service)
CREATE OR REPLACE FUNCTION get_integration_credentials(p_integration_id UUID)
RETURNS JSON AS $$
DECLARE
  v_credentials TEXT;
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Get the integration's household
  SELECT household_id, credentials_encrypted
  INTO v_household_id, v_credentials
  FROM external_integrations
  WHERE id = p_integration_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Integration not found';
  END IF;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  RETURN decrypt_token(v_credentials)::JSON;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get all integrations for a household (without credentials)
CREATE OR REPLACE FUNCTION get_household_integrations()
RETURNS TABLE (
  id UUID,
  service TEXT,
  display_name TEXT,
  account_email TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ei.id,
    ei.service,
    ei.display_name,
    ei.account_email,
    ei.last_sync_at,
    ei.last_sync_status,
    ei.last_sync_error,
    ei.created_at
  FROM external_integrations ei
  WHERE ei.household_id = get_user_household_id()
  ORDER BY ei.service, ei.display_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update sync status (called by sync service)
CREATE OR REPLACE FUNCTION update_integration_sync_status(
  p_integration_id UUID,
  p_status TEXT,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_household_id UUID;
BEGIN
  -- Get the integration's household
  SELECT household_id INTO v_household_id
  FROM external_integrations
  WHERE id = p_integration_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Integration not found';
  END IF;

  -- Verify user belongs to this household
  v_user_household_id := get_user_household_id();
  IF v_user_household_id IS NULL OR v_user_household_id != v_household_id THEN
    RAISE EXCEPTION 'Access denied: not a member of this household';
  END IF;

  UPDATE external_integrations
  SET
    last_sync_at = CASE WHEN p_status = 'ok' THEN NOW() ELSE last_sync_at END,
    last_sync_status = p_status,
    last_sync_error = p_error,
    updated_at = NOW()
  WHERE id = p_integration_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get pending suggestion count for household
CREATE OR REPLACE FUNCTION get_pending_suggestions_count()
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM external_suggestions
    WHERE household_id = get_user_household_id()
    AND status = 'pending'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Accept a suggestion (creates a child_task)
CREATE OR REPLACE FUNCTION accept_suggestion(
  p_suggestion_id UUID,
  p_title TEXT DEFAULT NULL,
  p_date DATE DEFAULT NULL,
  p_time TIME DEFAULT NULL,
  p_child_id UUID DEFAULT NULL,
  p_type TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_suggestion external_suggestions%ROWTYPE;
  v_task_id UUID;
  v_household_id UUID;
  v_user_id UUID;
  v_task_type TEXT;
BEGIN
  v_user_id := auth.uid();
  v_household_id := get_user_household_id();

  -- Get the suggestion
  SELECT * INTO v_suggestion
  FROM external_suggestions
  WHERE id = p_suggestion_id
  AND household_id = v_household_id;

  IF v_suggestion.id IS NULL THEN
    RAISE EXCEPTION 'Suggestion not found';
  END IF;

  IF v_suggestion.status != 'pending' THEN
    RAISE EXCEPTION 'Suggestion already processed';
  END IF;

  -- Determine task type from parameter or suggestion
  v_task_type := CASE
    WHEN p_type = 'task' THEN 'bring'
    WHEN p_type = 'reminder' THEN 'reminder'
    WHEN p_type = 'event' THEN 'activity'
    WHEN v_suggestion.suggested_type = 'task' THEN 'bring'
    WHEN v_suggestion.suggested_type = 'reminder' THEN 'reminder'
    ELSE 'other'
  END;

  -- Create the child_task
  INSERT INTO child_tasks (
    household_id,
    child_id,
    date,
    time,
    task_type,
    title,
    notes,
    status,
    source
  )
  VALUES (
    v_household_id,
    COALESCE(p_child_id, v_suggestion.suggested_child_id),
    COALESCE(p_date, v_suggestion.suggested_date, CURRENT_DATE),
    COALESCE(p_time, v_suggestion.suggested_time),
    v_task_type,
    COALESCE(p_title, v_suggestion.suggested_title),
    v_suggestion.suggested_description,
    'open',
    'imported'
  )
  RETURNING id INTO v_task_id;

  -- Update the suggestion
  UPDATE external_suggestions
  SET
    status = 'accepted',
    reviewed_by = (SELECT id FROM household_members WHERE user_id = v_user_id LIMIT 1),
    reviewed_at = NOW(),
    created_task_id = v_task_id
  WHERE id = p_suggestion_id;

  RETURN v_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dismiss a suggestion
CREATE OR REPLACE FUNCTION dismiss_suggestion(p_suggestion_id UUID)
RETURNS VOID AS $$
DECLARE
  v_household_id UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  v_household_id := get_user_household_id();

  UPDATE external_suggestions
  SET
    status = 'dismissed',
    reviewed_by = (SELECT id FROM household_members WHERE user_id = v_user_id LIMIT 1),
    reviewed_at = NOW()
  WHERE id = p_suggestion_id
  AND household_id = v_household_id
  AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Suggestion not found or already processed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Grant execute permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION upsert_external_integration(UUID, TEXT, TEXT, JSON, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_integration_credentials(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_household_integrations() TO authenticated;
GRANT EXECUTE ON FUNCTION update_integration_sync_status(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_suggestions_count() TO authenticated;
GRANT EXECUTE ON FUNCTION accept_suggestion(UUID, TEXT, DATE, TIME, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dismiss_suggestion(UUID) TO authenticated;

-- ============================================================================
-- Add 'source' column to child_tasks if not exists (for tracking origin)
-- ============================================================================
ALTER TABLE child_tasks
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

COMMENT ON COLUMN child_tasks.source IS 'Where the task came from: manual, external_integration, etc.';
