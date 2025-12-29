-- Fix: Allow household members to access calendar tokens for sending invites
--
-- Problem: google_calendar_tokens RLS only allows admins, but any household
-- member should be able to send pickup invites to their work calendar.
--
-- Solution: SECURITY DEFINER function that verifies household membership
-- and returns decrypted tokens.

-- Function to get calendar tokens for the current user's household
CREATE OR REPLACE FUNCTION get_household_calendar_tokens()
RETURNS TABLE(
  id UUID,
  household_id UUID,
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  calendar_email TEXT
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

  -- Get user's household
  SELECT hm.household_id INTO v_household_id
  FROM household_members hm
  WHERE hm.user_id = v_user_id
  LIMIT 1;

  IF v_household_id IS NULL THEN
    -- User is not in any household
    RETURN;
  END IF;

  -- Return decrypted tokens for this household
  -- Uses the decrypted view which handles decryption
  RETURN QUERY
  SELECT
    t.id,
    t.household_id,
    t.access_token,
    t.refresh_token,
    t.token_expiry,
    t.calendar_email
  FROM google_calendar_tokens_decrypted t
  WHERE t.household_id = v_household_id
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_household_calendar_tokens() TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION get_household_calendar_tokens() IS
'Returns decrypted calendar tokens for the current user''s household.
Uses SECURITY DEFINER to bypass RLS on the tokens table.
Any authenticated household member can call this to enable calendar sync.';
