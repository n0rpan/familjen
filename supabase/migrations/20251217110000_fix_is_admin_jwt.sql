-- Fix: is_admin() function reads from JWT instead of querying allowed_emails
--
-- Problem: SECURITY DEFINER doesn't bypass RLS in Supabase's managed environment
-- because the `postgres` role is not a superuser. This caused a circular dependency:
-- 1. RLS policy on allowed_emails calls is_admin()
-- 2. is_admin() queries allowed_emails
-- 3. That query triggers RLS which calls is_admin() again → returns false
--
-- Solution: Read is_admin from JWT app_metadata instead of querying the database.
-- The app_metadata.is_admin is set during login by syncUserAdminStatus().

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'is_admin')::boolean,
    false
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;
