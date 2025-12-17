-- Fix: Household creation flow and calendar email hint
--
-- This migration fixes several issues discovered during testing:
-- 1. RLS policy on allowed_emails used auth.users subquery (users can't SELECT from auth.users)
-- 2. create_household_with_admin passed TEXT but allergies column is TEXT[]
-- 3. Added get_connected_calendar_email() for non-admin users to see connected calendar

-- ============================================================================
-- Fix 1: allowed_emails RLS policy using auth.jwt() instead of subquery
-- ============================================================================
-- The previous policy used (SELECT email FROM auth.users WHERE id = auth.uid())
-- but regular users cannot SELECT from auth.users, causing 403 errors.
-- Using auth.jwt() ->> 'email' gets the email from the JWT token directly.

DROP POLICY IF EXISTS "View allowed emails" ON allowed_emails;

CREATE POLICY "View allowed emails" ON allowed_emails
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR invited_by_household_id = get_user_household_id()
    OR LOWER(email) = LOWER(auth.jwt() ->> 'email')
  );

-- ============================================================================
-- Fix 2: create_household_with_admin with proper allergies type handling
-- ============================================================================
-- The household_members.allergies column is TEXT[] (array), but the function
-- was trying to insert a TEXT value directly. Now converts comma-separated
-- text to array using string_to_array().

-- Drop old function signatures to avoid conflicts
DROP FUNCTION IF EXISTS create_household_with_admin(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_household_with_admin(TEXT, TEXT, TEXT, DATE, TEXT);

-- Recreate with proper allergies handling
CREATE OR REPLACE FUNCTION create_household_with_admin(
  p_household_name TEXT,
  p_member_name TEXT,
  p_member_email TEXT,
  p_birth_date DATE DEFAULT NULL,
  p_allergies TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_household_id UUID;
  v_user_id UUID;
  v_allergies TEXT[];
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user already has a household
  IF EXISTS (SELECT 1 FROM household_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'User already belongs to a household';
  END IF;

  -- Convert comma-separated allergies to array
  IF p_allergies IS NOT NULL AND TRIM(p_allergies) != '' THEN
    v_allergies := string_to_array(TRIM(p_allergies), ',');
    -- Trim each element
    SELECT array_agg(TRIM(elem))
    INTO v_allergies
    FROM unnest(v_allergies) AS elem;
  END IF;

  -- Create household
  INSERT INTO households (name)
  VALUES (p_household_name)
  RETURNING id INTO v_household_id;

  -- Create member as household admin
  INSERT INTO household_members (
    household_id,
    user_id,
    name,
    short_name,
    email,
    is_parent,
    is_household_admin,
    birth_date,
    allergies
  ) VALUES (
    v_household_id,
    v_user_id,
    p_member_name,
    LEFT(p_member_name, 3),
    LOWER(p_member_email),
    true,
    true,
    p_birth_date,
    v_allergies
  );

  RETURN v_household_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION create_household_with_admin(TEXT, TEXT, TEXT, DATE, TEXT) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION create_household_with_admin(TEXT, TEXT, TEXT, DATE, TEXT) IS
'Creates a new household and adds the current user as the household admin.
Uses SECURITY DEFINER to bypass RLS during atomic creation.
p_allergies accepts comma-separated values which are converted to TEXT[] array.';

-- ============================================================================
-- Fix 3: get_connected_calendar_email() for non-admin users
-- ============================================================================
-- All household members should be able to see the connected calendar email
-- so they know where to send calendar invites. Previously only admins could
-- see this information.

CREATE OR REPLACE FUNCTION get_connected_calendar_email()
RETURNS TEXT AS $$
DECLARE
  v_household_id UUID;
  v_email TEXT;
BEGIN
  -- Get user's household
  SELECT household_id INTO v_household_id
  FROM household_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_household_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get connected calendar email (shared across household)
  SELECT email INTO v_email
  FROM google_calendar_tokens
  WHERE household_id = v_household_id
  LIMIT 1;

  RETURN v_email;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_connected_calendar_email() TO authenticated;

-- Add comment
COMMENT ON FUNCTION get_connected_calendar_email() IS
'Returns the connected Google Calendar email for the user''s household.
Used to show users where to send calendar invites for sync.
Uses SECURITY DEFINER to bypass RLS on google_calendar_tokens.';
