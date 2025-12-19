-- Fix remaining RLS linter warnings:
-- 1. allowed_emails_select: wrap auth.jwt() in (select ...)
-- 2. household_members: drop old DELETE policy with singular name
-- 3. households: drop old DELETE policy "Household admin can delete household"

-- Drop old policies that weren't caught by previous migration
DROP POLICY IF EXISTS "Users can delete household member" ON household_members;
DROP POLICY IF EXISTS "Household admin can delete household" ON households;

-- Fix allowed_emails_select to wrap auth.jwt() properly
DROP POLICY IF EXISTS "allowed_emails_select" ON allowed_emails;
CREATE POLICY "allowed_emails_select" ON allowed_emails FOR SELECT TO authenticated
USING (
  is_admin()
  OR invited_by_household_id = (select get_user_household_id())
  OR LOWER(email) = LOWER((select auth.jwt()) ->> 'email')
);
