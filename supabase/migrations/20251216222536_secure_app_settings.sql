-- Fix: Restrict app_settings so users can only read non-sensitive keys
--
-- Problem: Any authenticated user can read all app_settings, including
-- the encryption_key which undermines token encryption security.
--
-- Solution: Change the RLS policy to only allow reading specific safe keys.

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Users can view settings" ON app_settings;
DROP POLICY IF EXISTS "Users can read app settings" ON app_settings;

-- Create a more restrictive policy that only allows reading safe keys
CREATE POLICY "Users can read safe settings" ON app_settings
  FOR SELECT TO authenticated
  USING (
    key IN ('openrouter_model', 'admin_email')
    OR is_admin()
  );

-- Add comment for documentation
COMMENT ON POLICY "Users can read safe settings" ON app_settings IS
'Users can only read non-sensitive settings (openrouter_model, admin_email).
Sensitive keys like encryption_key are only readable by admins.
The get_encryption_key() SECURITY DEFINER function can still access it internally.';
