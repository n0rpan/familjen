-- Fix: Case-insensitive email comparison in allowed_emails RLS policy
-- The previous policy compared email column directly to lowercase auth.users email,
-- but if allowed_emails.email is stored with mixed case, the comparison fails.

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "View allowed emails" ON allowed_emails;

-- Create new SELECT policy with case-insensitive self-read
CREATE POLICY "View allowed emails"
  ON allowed_emails FOR SELECT
  TO authenticated
  USING (
    is_admin()  -- Global admin sees all
    OR invited_by_household_id = get_user_household_id()  -- See emails invited to your household
    OR LOWER(email) = LOWER((SELECT email FROM auth.users WHERE id = auth.uid()))  -- See your own entry (case-insensitive)
  );

-- Add comment for documentation
COMMENT ON POLICY "View allowed emails" ON allowed_emails IS
'Users can view their own email entry (case-insensitive), emails invited by their household, or all emails if admin.';

-- Also normalize existing emails to lowercase for consistency
UPDATE allowed_emails SET email = LOWER(email) WHERE email != LOWER(email);
