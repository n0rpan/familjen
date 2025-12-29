-- Cleanup migration: Remove debug functions and consolidate RLS policies
--
-- This migration:
-- 1. Drops debug functions created during troubleshooting
-- 2. Ensures is_admin() reads from JWT (since admin page uses API route)
-- 3. Consolidates allowed_emails RLS policies

-- ===========================================
-- 1. Drop debug functions (created ad-hoc during troubleshooting)
-- ===========================================

DROP FUNCTION IF EXISTS debug_auth_context();
DROP FUNCTION IF EXISTS debug_is_admin();
DROP FUNCTION IF EXISTS debug_jwt();
DROP FUNCTION IF EXISTS debug_rls();

-- ===========================================
-- 2. Ensure is_admin() reads from JWT
-- ===========================================
-- This is the correct approach because:
-- - Admin status is synced to JWT on login (syncUserAdminStatus)
-- - Avoids circular RLS dependency (policy calls function, function queries table with RLS)
-- - SECURITY DEFINER doesn't bypass RLS in Supabase (postgres is not superuser)

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'is_admin')::boolean,
    false
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ===========================================
-- 3. Consolidate allowed_emails RLS policies
-- ===========================================
-- Clean slate: Drop all existing policies on allowed_emails

DROP POLICY IF EXISTS "View allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Admins can view all emails" ON allowed_emails;
DROP POLICY IF EXISTS "Authenticated can read allowed_emails" ON allowed_emails;
DROP POLICY IF EXISTS "Users can read allowed_emails" ON allowed_emails;
DROP POLICY IF EXISTS "Admin manages allowed_emails" ON allowed_emails;
DROP POLICY IF EXISTS "Admins can manage emails" ON allowed_emails;
DROP POLICY IF EXISTS "Insert allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Delete allowed emails" ON allowed_emails;

-- Recreate policies with clear purposes:

-- SELECT: Users can see their own entry, household invites, or all if admin
CREATE POLICY "View allowed emails"
  ON allowed_emails FOR SELECT
  TO authenticated
  USING (
    is_admin()  -- Admin sees all
    OR invited_by_household_id = get_user_household_id()  -- See emails you invited
    OR LOWER(email) = LOWER((SELECT email FROM auth.users WHERE id = auth.uid()))  -- See your own entry
  );

-- INSERT: Admin or household admin can add emails
CREATE POLICY "Insert allowed emails"
  ON allowed_emails FOR INSERT
  TO authenticated
  WITH CHECK (
    is_admin()  -- Admin can add anyone
    OR (
      is_household_admin()  -- Household admin can invite to their household
      AND invited_by_household_id = get_user_household_id()
    )
  );

-- UPDATE: Admin only (for setting is_admin, can_create_household)
CREATE POLICY "Update allowed emails"
  ON allowed_emails FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- DELETE: Admin or household admin can delete
CREATE POLICY "Delete allowed emails"
  ON allowed_emails FOR DELETE
  TO authenticated
  USING (
    is_admin()  -- Admin can delete anyone
    OR (
      is_household_admin()  -- Household admin can delete their invites
      AND invited_by_household_id = get_user_household_id()
    )
  );

-- ===========================================
-- 4. Add policy documentation
-- ===========================================

COMMENT ON POLICY "View allowed emails" ON allowed_emails IS
'Users can see: their own entry (for can_create_household check), emails invited by their household, or all if admin.';

COMMENT ON POLICY "Insert allowed emails" ON allowed_emails IS
'Admin can add anyone. Household admin can invite to their household.';

COMMENT ON POLICY "Update allowed emails" ON allowed_emails IS
'Only admin can update (modify is_admin, can_create_household flags).';

COMMENT ON POLICY "Delete allowed emails" ON allowed_emails IS
'Admin can delete anyone. Household admin can delete their invites.';

-- ===========================================
-- 5. Verify is_household_admin() is SECURITY DEFINER
-- ===========================================

CREATE OR REPLACE FUNCTION is_household_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM household_members
    WHERE user_id = auth.uid()
    AND is_household_admin = true
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ===========================================
-- 6. Verify get_user_household_id() is SECURITY DEFINER
-- ===========================================

CREATE OR REPLACE FUNCTION get_user_household_id()
RETURNS UUID AS $$
  SELECT household_id
  FROM household_members
  WHERE user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
