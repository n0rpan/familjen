-- Fix: Remove audit trigger from google_calendar_tokens
-- This table doesn't need full audit (updated_by) - just updated_at

DROP TRIGGER IF EXISTS set_google_calendar_tokens_audit ON google_calendar_tokens;

-- Simple trigger that only sets updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_google_calendar_tokens_updated_at
  BEFORE UPDATE ON google_calendar_tokens
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
