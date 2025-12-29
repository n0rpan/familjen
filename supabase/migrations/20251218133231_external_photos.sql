-- Migration: External Photos table for Kidplan/iSkole photo sync
-- Photos are downloaded, compressed to max 1200px, stored in Supabase Storage
-- with 1-year retention policy for automatic cleanup

-- ============================================================================
-- External Photos table
-- ============================================================================
CREATE TABLE IF NOT EXISTS external_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES external_integrations(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE SET NULL,
  member_id UUID REFERENCES household_members(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  title TEXT,
  taken_at TIMESTAMPTZ,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  width INT,
  height INT,
  file_size INT,
  mime_type TEXT DEFAULT 'image/jpeg',
  expires_at TIMESTAMPTZ NOT NULL,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(integration_id, external_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_external_photos_integration
  ON external_photos(integration_id);
CREATE INDEX IF NOT EXISTS idx_external_photos_child
  ON external_photos(child_id)
  WHERE child_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_photos_member
  ON external_photos(member_id)
  WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_photos_expires
  ON external_photos(expires_at);
CREATE INDEX IF NOT EXISTS idx_external_photos_taken
  ON external_photos(taken_at DESC);

-- ============================================================================
-- Add source_type to external_messages for filtering
-- ============================================================================
ALTER TABLE external_messages
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'message';

COMMENT ON COLUMN external_messages.source_type IS 'Type of message: message, board_post, conversation, etc.';

-- Index for filtering by source_type
CREATE INDEX IF NOT EXISTS idx_external_messages_source_type
  ON external_messages(integration_id, source_type);

-- ============================================================================
-- RLS Policies for external_photos
-- ============================================================================
ALTER TABLE external_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own household photos" ON external_photos;
CREATE POLICY "Users can view own household photos"
  ON external_photos FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

DROP POLICY IF EXISTS "Users can insert own household photos" ON external_photos;
CREATE POLICY "Users can insert own household photos"
  ON external_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

DROP POLICY IF EXISTS "Users can delete own household photos" ON external_photos;
CREATE POLICY "Users can delete own household photos"
  ON external_photos FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
  );

-- ============================================================================
-- Helper function to get recent photos for a household
-- ============================================================================
CREATE OR REPLACE FUNCTION get_recent_photos(
  p_limit INT DEFAULT 10,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  integration_id UUID,
  child_id UUID,
  member_id UUID,
  external_id TEXT,
  title TEXT,
  taken_at TIMESTAMPTZ,
  storage_path TEXT,
  thumbnail_path TEXT,
  width INT,
  height INT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ep.id,
    ep.integration_id,
    ep.child_id,
    ep.member_id,
    ep.external_id,
    ep.title,
    ep.taken_at,
    ep.storage_path,
    ep.thumbnail_path,
    ep.width,
    ep.height,
    ep.created_at
  FROM external_photos ep
  JOIN external_integrations ei ON ei.id = ep.integration_id
  WHERE ei.household_id = get_user_household_id()
    AND ep.expires_at > NOW()
  ORDER BY COALESCE(ep.taken_at, ep.created_at) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_recent_photos(INT, INT) TO authenticated;

-- ============================================================================
-- Helper function to cleanup expired photos
-- Called by cron job - returns deleted photo paths for storage cleanup
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_expired_photos()
RETURNS TABLE (
  storage_path TEXT,
  thumbnail_path TEXT
) AS $$
BEGIN
  RETURN QUERY
  DELETE FROM external_photos
  WHERE expires_at < NOW()
  RETURNING
    external_photos.storage_path,
    external_photos.thumbnail_path;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only service role should call this (via cron)
GRANT EXECUTE ON FUNCTION cleanup_expired_photos() TO service_role;

-- ============================================================================
-- Storage bucket setup (run manually in Supabase Dashboard)
-- ============================================================================
-- NOTE: Create bucket 'external-photos' in Supabase Dashboard with:
--   - Public: false
--   - File size limit: 5MB
--   - Allowed MIME types: image/jpeg, image/png, image/webp
--
-- RLS Policy for storage.objects:
-- CREATE POLICY "Users can access own household photos"
-- ON storage.objects FOR SELECT TO authenticated
-- USING (
--   bucket_id = 'external-photos' AND
--   EXISTS (
--     SELECT 1 FROM external_photos ep
--     JOIN external_integrations ei ON ei.id = ep.integration_id
--     WHERE ep.storage_path = name AND ei.household_id = get_user_household_id()
--   )
-- );
