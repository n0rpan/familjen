-- Self-service account deletion function
-- Allows users to delete their own account and data

CREATE OR REPLACE FUNCTION delete_my_account()
RETURNS void AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_member_id UUID;
  v_household_id UUID;
  v_is_last_member BOOLEAN;
  v_user_email TEXT;
BEGIN
  -- Must be authenticated
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get user email from JWT
  v_user_email := auth.jwt() ->> 'email';

  -- Get membership info
  SELECT id, household_id INTO v_member_id, v_household_id
  FROM household_members WHERE user_id = v_user_id;

  -- If user has a household membership
  IF v_member_id IS NOT NULL THEN
    -- Check if last member in household
    SELECT COUNT(*) = 1 INTO v_is_last_member
    FROM household_members WHERE household_id = v_household_id;

    -- Remove from household
    DELETE FROM household_members WHERE id = v_member_id;

    -- If last member, delete household (cascades all data via foreign keys)
    IF v_is_last_member THEN
      DELETE FROM households WHERE id = v_household_id;
    END IF;
  END IF;

  -- Remove from allowlist (so they can re-register fresh if needed)
  DELETE FROM allowed_emails WHERE email = LOWER(v_user_email);

  -- Note: The actual auth.users record cannot be deleted from SQL
  -- The client must call supabase.auth.admin.deleteUser() or the user
  -- will be logged out but their auth account will remain (they can re-register)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION delete_my_account() TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION delete_my_account() IS
'Self-service account deletion. Removes the user from their household,
deletes household data if they are the last member, and removes them
from the allowed_emails list.';
