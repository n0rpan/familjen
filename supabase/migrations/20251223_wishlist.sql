-- ============================================
-- Wishlist Feature
-- Gift wishes for household members and children
-- ============================================

-- Wishlist items table
CREATE TABLE IF NOT EXISTS wishlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,
  member_id UUID REFERENCES household_members(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT,
  link TEXT,                          -- URL to store/product
  price NUMERIC(10, 2),               -- Price with 2 decimal places
  image_path TEXT,                    -- Storage path for uploaded image

  occasion TEXT NOT NULL DEFAULT 'general' CHECK (occasion IN ('birthday', 'christmas', 'general')),
  priority INT NOT NULL DEFAULT 0 CHECK (priority >= 0 AND priority <= 5),  -- 0-5 stars
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reserved', 'bought')),

  reserved_by TEXT,                   -- member_id (UUID) or external name (for share links)
  reserved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,

  -- Either child_id or member_id must be set, but not both
  CONSTRAINT wishlist_owner_check CHECK (
    (child_id IS NOT NULL AND member_id IS NULL) OR
    (child_id IS NULL AND member_id IS NOT NULL)
  )
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_wishlist_items_household ON wishlist_items(household_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_child ON wishlist_items(child_id) WHERE child_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wishlist_items_member ON wishlist_items(member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wishlist_items_occasion ON wishlist_items(occasion);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_status ON wishlist_items(status);

-- Updated_at trigger (use set_updated_at function from base schema)
DROP TRIGGER IF EXISTS wishlist_items_updated_at ON wishlist_items;
CREATE TRIGGER wishlist_items_updated_at
  BEFORE UPDATE ON wishlist_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================
-- Share tokens for public wishlist links
-- ============================================

CREATE TABLE IF NOT EXISTS wishlist_share_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,
  member_id UUID REFERENCES household_members(id) ON DELETE CASCADE,

  token TEXT NOT NULL UNIQUE,         -- Short random token for URL
  occasion TEXT,                      -- Optional: limit to specific occasion

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,             -- Optional expiration

  -- Either child_id or member_id must be set, but not both
  CONSTRAINT share_token_owner_check CHECK (
    (child_id IS NOT NULL AND member_id IS NULL) OR
    (child_id IS NULL AND member_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_wishlist_share_tokens_token ON wishlist_share_tokens(token);
CREATE INDEX IF NOT EXISTS idx_wishlist_share_tokens_child ON wishlist_share_tokens(child_id) WHERE child_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wishlist_share_tokens_member ON wishlist_share_tokens(member_id) WHERE member_id IS NOT NULL;

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishlist_share_tokens ENABLE ROW LEVEL SECURITY;

-- Wishlist items: household members can CRUD their household's items
DROP POLICY IF EXISTS "Household members can view wishlist items" ON wishlist_items;
CREATE POLICY "Household members can view wishlist items"
  ON wishlist_items FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Household members can insert wishlist items" ON wishlist_items;
CREATE POLICY "Household members can insert wishlist items"
  ON wishlist_items FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Household members can update wishlist items" ON wishlist_items;
CREATE POLICY "Household members can update wishlist items"
  ON wishlist_items FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Household members can delete wishlist items" ON wishlist_items;
CREATE POLICY "Household members can delete wishlist items"
  ON wishlist_items FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- Share tokens: household members can manage tokens
DROP POLICY IF EXISTS "Household members can view share tokens" ON wishlist_share_tokens;
CREATE POLICY "Household members can view share tokens"
  ON wishlist_share_tokens FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Household members can insert share tokens" ON wishlist_share_tokens;
CREATE POLICY "Household members can insert share tokens"
  ON wishlist_share_tokens FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

DROP POLICY IF EXISTS "Household members can delete share tokens" ON wishlist_share_tokens;
CREATE POLICY "Household members can delete share tokens"
  ON wishlist_share_tokens FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- ============================================
-- Public access function for shared wishlists
-- ============================================

-- Function to get wishlist items by share token (for anonymous users)
CREATE OR REPLACE FUNCTION get_shared_wishlist(p_token TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  link TEXT,
  price NUMERIC,
  image_path TEXT,
  occasion TEXT,
  priority INT,
  status TEXT,
  reserved_by TEXT,
  person_name TEXT,
  person_type TEXT
) AS $$
DECLARE
  v_token_record RECORD;
BEGIN
  -- Find the token
  SELECT t.*,
         c.name as child_name,
         m.name as member_name
  INTO v_token_record
  FROM wishlist_share_tokens t
  LEFT JOIN children c ON t.child_id = c.id
  LEFT JOIN household_members m ON t.member_id = m.id
  WHERE t.token = p_token
    AND (t.expires_at IS NULL OR t.expires_at > now());

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Return matching wishlist items
  RETURN QUERY
  SELECT
    wi.id,
    wi.name,
    wi.description,
    wi.link,
    wi.price,
    wi.image_path,
    wi.occasion,
    wi.priority,
    wi.status,
    wi.reserved_by,
    COALESCE(v_token_record.child_name, v_token_record.member_name) as person_name,
    CASE
      WHEN v_token_record.child_id IS NOT NULL THEN 'child'
      ELSE 'member'
    END as person_type
  FROM wishlist_items wi
  WHERE (
    (v_token_record.child_id IS NOT NULL AND wi.child_id = v_token_record.child_id) OR
    (v_token_record.member_id IS NOT NULL AND wi.member_id = v_token_record.member_id)
  )
  AND (v_token_record.occasion IS NULL OR wi.occasion = v_token_record.occasion)
  ORDER BY wi.priority DESC, wi.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute to anonymous users
GRANT EXECUTE ON FUNCTION get_shared_wishlist(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_shared_wishlist(TEXT) TO authenticated;

-- Function to reserve an item via share link (for anonymous users)
CREATE OR REPLACE FUNCTION reserve_shared_wishlist_item(
  p_token TEXT,
  p_item_id UUID,
  p_reserver_name TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_token_record RECORD;
  v_item RECORD;
BEGIN
  -- Validate token
  SELECT t.*
  INTO v_token_record
  FROM wishlist_share_tokens t
  WHERE t.token = p_token
    AND (t.expires_at IS NULL OR t.expires_at > now());

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Check item exists and belongs to the right person
  SELECT wi.* INTO v_item
  FROM wishlist_items wi
  WHERE wi.id = p_item_id
    AND wi.status = 'open'
    AND (
      (v_token_record.child_id IS NOT NULL AND wi.child_id = v_token_record.child_id) OR
      (v_token_record.member_id IS NOT NULL AND wi.member_id = v_token_record.member_id)
    );

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Reserve the item
  UPDATE wishlist_items
  SET status = 'reserved',
      reserved_by = p_reserver_name,
      reserved_at = now()
  WHERE id = p_item_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION reserve_shared_wishlist_item(TEXT, UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION reserve_shared_wishlist_item(TEXT, UUID, TEXT) TO authenticated;

-- ============================================
-- Storage bucket for wishlist images
-- ============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wishlist-images', 'wishlist-images', true, 5242880, -- 5MB
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies for wishlist images
DROP POLICY IF EXISTS "Authenticated users can upload wishlist images" ON storage.objects;
CREATE POLICY "Authenticated users can upload wishlist images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'wishlist-images');

DROP POLICY IF EXISTS "Anyone can view wishlist images" ON storage.objects;
CREATE POLICY "Anyone can view wishlist images"
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'wishlist-images');

DROP POLICY IF EXISTS "Authenticated users can delete their wishlist images" ON storage.objects;
CREATE POLICY "Authenticated users can delete their wishlist images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'wishlist-images');

-- ============================================
-- Realtime subscriptions (optional)
-- ============================================

-- Enable realtime for wishlist_items (idempotent check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wishlist_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE wishlist_items;
  END IF;
END $$;
