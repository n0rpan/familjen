-- Fix RLS performance issues
-- 1. Remove duplicate index on google_calendar_tokens.email
-- 2. Wrap auth.uid() and auth.jwt() in (select ...) to cache values

-- ============================================================================
-- 1. Remove duplicate index
-- ============================================================================
DROP INDEX IF EXISTS google_calendar_tokens_email_unique;
-- Keep google_calendar_tokens_email_key (the unique constraint)

-- ============================================================================
-- 2. Fix household_members policies - wrap auth.uid() in (select ...)
-- ============================================================================

-- Fix "Users can view household members"
DROP POLICY IF EXISTS "Users can view household members" ON household_members;
CREATE POLICY "Users can view household members"
  ON household_members FOR SELECT
  TO authenticated
  USING (
    household_id = get_user_household_id()
    OR user_id = (select auth.uid())
  );

-- Fix "Users can insert household members"
DROP POLICY IF EXISTS "Users can insert household members" ON household_members;
CREATE POLICY "Users can insert household members"
  ON household_members FOR INSERT
  TO authenticated
  WITH CHECK (
    household_id = get_user_household_id()
    OR get_user_household_id() IS NULL
    OR user_id = (select auth.uid())
  );

-- Fix "Users can update household member"
DROP POLICY IF EXISTS "Users can update household member" ON household_members;
CREATE POLICY "Users can update household member"
  ON household_members FOR UPDATE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    OR (is_household_admin() AND household_id = get_admin_household_id())
  )
  WITH CHECK (
    user_id = (select auth.uid())
    OR (is_household_admin() AND household_id = get_admin_household_id())
  );

-- Fix "Users can delete household member"
DROP POLICY IF EXISTS "Users can delete household member" ON household_members;
CREATE POLICY "Users can delete household member"
  ON household_members FOR DELETE
  TO authenticated
  USING (
    (is_household_admin() AND household_id = get_admin_household_id() AND user_id != (select auth.uid()))
    OR is_admin()
  );

-- ============================================================================
-- 3. Fix allowed_emails policy - wrap auth.jwt() in (select ...)
-- ============================================================================

DROP POLICY IF EXISTS "View allowed emails" ON allowed_emails;
CREATE POLICY "View allowed emails"
  ON allowed_emails FOR SELECT
  TO authenticated
  USING (
    is_admin()
    OR invited_by_household_id = get_user_household_id()
    OR LOWER(email) = LOWER((select auth.jwt() ->> 'email'))
  );

-- ============================================================================
-- 4. Fix push_subscriptions policy - wrap auth.uid() in (select ...)
-- ============================================================================

DROP POLICY IF EXISTS "Users manage own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users manage own push subscriptions"
  ON push_subscriptions
  FOR ALL
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));
