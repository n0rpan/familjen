-- Fix: calendar tokens function schema mismatch
--
-- The get_household_calendar_tokens function referenced columns that don't exist:
-- - household_id (doesn't exist - calendar is shared, not per-household)
-- - token_expiry (should be expiry_date)
-- - calendar_email (should be email)
--
-- This is a shared calendar setup, so any authenticated household member
-- can access the tokens to send calendar invites.

DROP FUNCTION IF EXISTS get_household_calendar_tokens();

-- Recreate with correct schema matching google_calendar_tokens_decrypted view
CREATE OR REPLACE FUNCTION get_household_calendar_tokens()
RETURNS TABLE(
  id UUID,
  email TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_type TEXT,
  expiry_date BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_user_id UUID;
  v_household_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify user is in a household (authorization check)
  SELECT hm.household_id INTO v_household_id
  FROM household_members hm
  WHERE hm.user_id = v_user_id
  LIMIT 1;

  IF v_household_id IS NULL THEN
    -- User is not in any household - no access
    RETURN;
  END IF;

  -- Return decrypted tokens (shared calendar - single row)
  RETURN QUERY
  SELECT
    t.id,
    t.email,
    t.access_token,
    t.refresh_token,
    t.token_type,
    t.expiry_date,
    t.created_at,
    t.updated_at
  FROM google_calendar_tokens_decrypted t
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_household_calendar_tokens() TO authenticated;

-- Update comment
COMMENT ON FUNCTION get_household_calendar_tokens() IS
'Returns decrypted calendar tokens for authenticated household members.
Shared calendar model - any household member can access tokens for calendar sync.
Uses SECURITY DEFINER to bypass RLS on the tokens table.';
