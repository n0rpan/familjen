-- Migration: Create storage bucket for external photos
-- This creates the 'external-photos' bucket and RLS policies

-- ============================================================================
-- Create the storage bucket
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'external-photos',
  'external-photos',
  false,
  5242880,  -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- RLS Policies for storage.objects
-- ============================================================================

-- Allow authenticated users to read photos from their household
DROP POLICY IF EXISTS "Users can view own household photos" ON storage.objects;
CREATE POLICY "Users can view own household photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'external-photos'
  AND EXISTS (
    SELECT 1 FROM external_photos ep
    JOIN external_integrations ei ON ei.id = ep.integration_id
    WHERE (ep.storage_path = name OR ep.thumbnail_path = name)
    AND ei.household_id = get_user_household_id()
  )
);

-- Allow service role to insert photos (used by sync endpoints)
DROP POLICY IF EXISTS "Service role can insert photos" ON storage.objects;
CREATE POLICY "Service role can insert photos"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'external-photos');

-- Allow service role to delete photos (used by cleanup cron)
DROP POLICY IF EXISTS "Service role can delete photos" ON storage.objects;
CREATE POLICY "Service role can delete photos"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'external-photos');

-- Also allow authenticated users to insert (for manual uploads if needed)
DROP POLICY IF EXISTS "Users can upload to own household" ON storage.objects;
CREATE POLICY "Users can upload to own household"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'external-photos'
  AND (storage.foldername(name))[1] = (get_user_household_id())::text
);
