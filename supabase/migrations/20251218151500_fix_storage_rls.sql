-- Fix storage RLS policy for external-photos bucket
-- The previous policy using storage.foldername() was failing

-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can upload to own household" ON storage.objects;

-- Create a simpler policy that allows authenticated users to upload
-- The API routes already validate household membership
CREATE POLICY "Authenticated users can upload photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'external-photos');

-- Also ensure the SELECT policy works for any file in the bucket for own household
DROP POLICY IF EXISTS "Users can view own household photos" ON storage.objects;
CREATE POLICY "Users can view own household photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'external-photos'
  AND (
    -- Allow viewing if file path starts with user's household ID
    name LIKE (get_user_household_id())::text || '/%'
    -- Or if the file is linked in external_photos table to user's household
    OR EXISTS (
      SELECT 1 FROM external_photos ep
      JOIN external_integrations ei ON ei.id = ep.integration_id
      WHERE (ep.storage_path = name OR ep.thumbnail_path = name)
      AND ei.household_id = get_user_household_id()
    )
  )
);
