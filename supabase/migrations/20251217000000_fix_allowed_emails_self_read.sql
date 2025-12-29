-- Fix: Allow users to read their OWN entry in allowed_emails
-- Previously, users with can_create_household=true couldn't read their permission
-- because they weren't admins and didn't have a household yet.
-- This blocked them from creating households.

-- Drop all existing SELECT policies (some were overly permissive with qual=true)
DROP POLICY IF EXISTS "Admins can view all emails" ON allowed_emails;
DROP POLICY IF EXISTS "View allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Authenticated can read allowed_emails" ON allowed_emails;
DROP POLICY IF EXISTS "Users can read allowed_emails" ON allowed_emails;

-- Remove duplicate ALL policy
DROP POLICY IF EXISTS "Admins can manage emails" ON allowed_emails;

-- Create new SELECT policy that includes self-read
CREATE POLICY "View allowed emails"
  ON allowed_emails FOR SELECT
  TO authenticated
  USING (
    is_admin()  -- Global admin sees all
    OR invited_by_household_id = get_user_household_id()  -- See emails invited to your household
    OR email = LOWER((SELECT email FROM auth.users WHERE id = auth.uid()))  -- See your own entry
  );

-- Add comment for documentation
COMMENT ON POLICY "View allowed emails" ON allowed_emails IS
'Users can view their own email entry (for checking can_create_household),
emails they invited via their household, or all emails if admin.';

-- Final expected policies on allowed_emails:
-- 1. "View allowed emails" (SELECT) - self, invited, or admin
-- 2. "Admin manages allowed_emails" (ALL) - admin only
-- 3. "Insert allowed emails" (INSERT) - admin or household admin
-- 4. "Delete allowed emails" (DELETE) - admin or household admin
