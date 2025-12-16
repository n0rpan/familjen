-- Migration: Household Admin Features
-- Enables multi-household support with household admins who can manage their own household

-- 1. Add is_household_admin to household_members
ALTER TABLE household_members
ADD COLUMN IF NOT EXISTS is_household_admin BOOLEAN DEFAULT false;

-- 2. Add invited_by_household_id to allowed_emails (to track invites)
ALTER TABLE allowed_emails
ADD COLUMN IF NOT EXISTS invited_by_household_id UUID REFERENCES households(id) ON DELETE SET NULL;

-- 3. Create a function to check if user is a household admin
CREATE OR REPLACE FUNCTION is_household_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM household_members
    WHERE user_id = auth.uid()
    AND is_household_admin = true
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- 4. Create a function to get the household ID where user is admin
CREATE OR REPLACE FUNCTION get_admin_household_id()
RETURNS UUID AS $$
  SELECT household_id
  FROM household_members
  WHERE user_id = auth.uid()
  AND is_household_admin = true
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- 5. Update RLS policies for allowed_emails
-- Drop existing policies
DROP POLICY IF EXISTS "Admin can view allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Admin can manage allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Admin can insert allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Admin can delete allowed emails" ON allowed_emails;

-- Household admins can view emails they invited
CREATE POLICY "View allowed emails"
  ON allowed_emails FOR SELECT
  TO authenticated
  USING (
    is_admin()  -- Global admin sees all
    OR invited_by_household_id = get_user_household_id()  -- See emails invited to your household
  );

-- Household admins can invite to their household
CREATE POLICY "Insert allowed emails"
  ON allowed_emails FOR INSERT
  TO authenticated
  WITH CHECK (
    is_admin()  -- Global admin can add anyone
    OR (is_household_admin() AND invited_by_household_id = get_admin_household_id())  -- Household admin invites to their household
  );

-- Household admins can remove invites from their household
CREATE POLICY "Delete allowed emails"
  ON allowed_emails FOR DELETE
  TO authenticated
  USING (
    is_admin()  -- Global admin can delete any
    OR (is_household_admin() AND invited_by_household_id = get_admin_household_id())  -- Household admin removes from their household
  );

-- 6. Update RLS for household_members - allow household admins to manage their members
DROP POLICY IF EXISTS "Users can create household member" ON household_members;
DROP POLICY IF EXISTS "Users can update household member" ON household_members;
DROP POLICY IF EXISTS "Users can delete household member" ON household_members;

-- Users can create a member for themselves (first setup) OR household admin can add
CREATE POLICY "Users can create household member"
  ON household_members FOR INSERT
  TO authenticated
  WITH CHECK (
    -- First-time setup: user creates their own member record
    (get_user_household_id() IS NULL AND user_id = auth.uid())
    -- OR adding to own household
    OR household_id = get_user_household_id()
    -- OR household admin adding to their household
    OR (is_household_admin() AND household_id = get_admin_household_id())
    -- OR global admin
    OR is_admin()
  );

-- Users can update own member record, household admin can update their members
CREATE POLICY "Users can update household member"
  ON household_members FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()  -- Own record
    OR (is_household_admin() AND household_id = get_admin_household_id())  -- Household admin
    OR is_admin()  -- Global admin
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (is_household_admin() AND household_id = get_admin_household_id())
    OR is_admin()
  );

-- Household admin can delete members (except themselves), global admin can delete any
CREATE POLICY "Users can delete household member"
  ON household_members FOR DELETE
  TO authenticated
  USING (
    (is_household_admin() AND household_id = get_admin_household_id() AND user_id != auth.uid())  -- Household admin can't delete self
    OR is_admin()
  );

-- 7. Allow authenticated users to create households (for new user flow)
DROP POLICY IF EXISTS "Users can create household" ON households;

CREATE POLICY "Users can create household"
  ON households FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Only allow if user doesn't already have a household
    get_user_household_id() IS NULL
    OR is_admin()
  );

-- 8. Household admins can update their own household
DROP POLICY IF EXISTS "Users can update household" ON households;

CREATE POLICY "Users can update household"
  ON households FOR UPDATE
  TO authenticated
  USING (
    id = get_user_household_id()
    OR is_admin()
  )
  WITH CHECK (
    id = get_user_household_id()
    OR is_admin()
  );

-- 9. Household admins can delete their own household (with cascade)
DROP POLICY IF EXISTS "Users can delete household" ON households;

CREATE POLICY "Household admin can delete household"
  ON households FOR DELETE
  TO authenticated
  USING (
    (is_household_admin() AND id = get_admin_household_id())
    OR is_admin()
  );

-- 10. Mark current user as household admin if they're the only parent
-- (This is a one-time setup for existing data)
UPDATE household_members
SET is_household_admin = true
WHERE is_parent = true
AND user_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM household_members hm2
  WHERE hm2.household_id = household_members.household_id
  AND hm2.is_household_admin = true
);
