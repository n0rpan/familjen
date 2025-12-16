-- Fix: Allow invited users to claim their pending membership
--
-- Problem: RLS policies on household_members block invited users from seeing
-- or updating their own pending invite row (where user_id IS NULL), creating
-- a chicken-and-egg situation where they can't join the household.
--
-- Solution: A SECURITY DEFINER function that runs with elevated privileges
-- to claim the invite in a controlled way.

-- Function to claim an invite for the currently logged-in user
CREATE OR REPLACE FUNCTION claim_invite_for_current_user()
RETURNS TABLE(
  member_id UUID,
  household_id UUID,
  member_name TEXT
) AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_member_record RECORD;
BEGIN
  -- Get current user info
  v_user_id := auth.uid();
  v_user_email := auth.email();

  IF v_user_id IS NULL OR v_user_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Lowercase for consistent matching
  v_user_email := LOWER(v_user_email);

  -- Check if user already has a membership (with user_id set)
  IF EXISTS (
    SELECT 1 FROM household_members hm
    WHERE hm.user_id = v_user_id
  ) THEN
    -- Already has a membership, nothing to claim
    RETURN;
  END IF;

  -- Find pending invite by email (user_id is NULL)
  SELECT hm.id, hm.household_id, hm.name INTO v_member_record
  FROM household_members hm
  WHERE LOWER(hm.email) = v_user_email
    AND hm.user_id IS NULL
  LIMIT 1;

  IF v_member_record IS NULL THEN
    -- No pending invite found
    RETURN;
  END IF;

  -- Claim the invite by setting user_id
  UPDATE household_members
  SET user_id = v_user_id
  WHERE id = v_member_record.id;

  -- Return the claimed membership
  RETURN QUERY SELECT
    v_member_record.id AS member_id,
    v_member_record.household_id AS household_id,
    v_member_record.name AS member_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION claim_invite_for_current_user() TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION claim_invite_for_current_user() IS
'Claims a pending household membership invite for the currently logged-in user.
Matches by email address and sets user_id on the membership row.
Returns the claimed membership info or empty if no invite found or already has membership.';
