-- Migration: Google Calendar Tokens
-- Stores OAuth tokens for the shared Google Calendar account

CREATE TABLE google_calendar_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,  -- The Gmail account email
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  expiry_date BIGINT,  -- Token expiry timestamp in milliseconds
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Only one row expected (single shared account), but allow for future expansion
CREATE UNIQUE INDEX google_calendar_tokens_email_unique ON google_calendar_tokens(email);

-- RLS - only admins can access tokens
ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view tokens"
  ON google_calendar_tokens FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Only admins can insert tokens"
  ON google_calendar_tokens FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Only admins can update tokens"
  ON google_calendar_tokens FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Only admins can delete tokens"
  ON google_calendar_tokens FOR DELETE
  TO authenticated
  USING (is_admin());

-- Audit trigger
CREATE TRIGGER set_google_calendar_tokens_audit
  BEFORE INSERT OR UPDATE ON google_calendar_tokens
  FOR EACH ROW
  EXECUTE FUNCTION set_audit_columns();
