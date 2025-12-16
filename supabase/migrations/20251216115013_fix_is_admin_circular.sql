-- Migration: Fix circular dependency in is_admin() function
-- The is_admin() function queries allowed_emails, but allowed_emails RLS uses is_admin()
-- This creates a circular dependency. Fix by making is_admin() SECURITY DEFINER to bypass RLS.

-- Recreate is_admin() function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM allowed_emails
    WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND is_admin = true
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Also ensure is_household_admin() is SECURITY DEFINER
CREATE OR REPLACE FUNCTION is_household_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM household_members
    WHERE user_id = auth.uid()
    AND is_household_admin = true
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
