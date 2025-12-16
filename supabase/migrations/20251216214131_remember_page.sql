-- Remember Page: Huskeliste feature
-- Extends child_tasks, adds household_reminders, wishlists, and wishlist_items

-- ============================================
-- PART 1: Extend child_tasks table
-- ============================================

-- Add new task types: activity (fritidsaktiviteter) and closure (stengt barnehage/skole)
ALTER TABLE child_tasks DROP CONSTRAINT IF EXISTS child_tasks_type_check;
ALTER TABLE child_tasks ADD CONSTRAINT child_tasks_type_check
  CHECK (task_type IN ('bring', 'appointment', 'reminder', 'activity', 'closure', 'other'));

-- Add source tracking for AI suggestions and imports
ALTER TABLE child_tasks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE child_tasks ADD CONSTRAINT child_tasks_source_check
  CHECK (source IN ('manual', 'ai_suggested', 'imported', 'recurring'));

-- Add recurrence pattern for recurring tasks (JSONB for flexibility)
-- Pattern examples:
-- { "type": "weekly", "days": [1, 3, 5] }  -- Mon, Wed, Fri
-- { "type": "monthly", "dayOfMonth": 15 }
-- { "type": "daily", "interval": 1 }
ALTER TABLE child_tasks ADD COLUMN IF NOT EXISTS recurrence_pattern JSONB;

-- Add parent_task_id for linking recurring instances to their template
ALTER TABLE child_tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES child_tasks(id) ON DELETE SET NULL;

-- Index for finding recurring task templates
CREATE INDEX IF NOT EXISTS child_tasks_parent_idx ON child_tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS child_tasks_source_idx ON child_tasks(source) WHERE source = 'recurring';

-- ============================================
-- PART 2: Create household_reminders table
-- ============================================
-- Household-level reminders not tied to a specific child
-- Examples: "Betale strømregning", "Fornye forsikring", "Service bil"

CREATE TABLE household_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TIME,  -- Optional, for timed reminders
  title TEXT NOT NULL,
  notes TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  snoozed_until DATE,  -- For snoozed reminders
  assigned_to UUID REFERENCES household_members(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  recurrence_pattern JSONB,
  parent_reminder_id UUID REFERENCES household_reminders(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  CONSTRAINT household_reminders_category_check CHECK (category IN ('bill', 'insurance', 'car', 'home', 'health', 'subscription', 'other')),
  CONSTRAINT household_reminders_status_check CHECK (status IN ('open', 'done', 'snoozed')),
  CONSTRAINT household_reminders_priority_check CHECK (priority IN ('low', 'normal', 'high')),
  CONSTRAINT household_reminders_source_check CHECK (source IN ('manual', 'ai_suggested', 'imported', 'recurring')),
  CONSTRAINT household_reminders_title_length CHECK (char_length(title) <= 150)
);

-- Indexes for common queries
CREATE INDEX household_reminders_date_idx ON household_reminders(household_id, date);
CREATE INDEX household_reminders_status_idx ON household_reminders(household_id, status, date) WHERE status = 'open';
CREATE INDEX household_reminders_category_idx ON household_reminders(household_id, category);
CREATE INDEX household_reminders_assigned_idx ON household_reminders(assigned_to) WHERE assigned_to IS NOT NULL;

-- RLS policies
ALTER TABLE household_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own household reminders"
  ON household_reminders FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can create reminders in own household"
  ON household_reminders FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update own household reminders"
  ON household_reminders FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can delete own household reminders"
  ON household_reminders FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- Updated_at trigger
CREATE TRIGGER set_household_reminders_updated_at
  BEFORE UPDATE ON household_reminders
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================
-- PART 3: Create wishlists table
-- ============================================
-- Wishlists for household members and children
-- Each person can have multiple wishlists for different occasions

CREATE TABLE wishlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id UUID REFERENCES household_members(id) ON DELETE CASCADE,  -- For adult wishlists
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,            -- For child wishlists
  name TEXT NOT NULL,  -- "Bursdag 2025", "Jul 2025", "Generelt"
  occasion TEXT,       -- birthday, christmas, anniversary, general, other
  occasion_date DATE,  -- When is the occasion (for sorting/reminders)
  description TEXT,
  is_public BOOLEAN DEFAULT true,  -- Visible to other household members
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  -- Either member_id or child_id should be set, but not both
  CONSTRAINT wishlists_owner_check CHECK (
    (member_id IS NOT NULL AND child_id IS NULL) OR
    (member_id IS NULL AND child_id IS NOT NULL) OR
    (member_id IS NULL AND child_id IS NULL)  -- Household-level wishlist
  ),
  CONSTRAINT wishlists_name_length CHECK (char_length(name) <= 100),
  CONSTRAINT wishlists_occasion_check CHECK (occasion IS NULL OR occasion IN ('birthday', 'christmas', 'anniversary', 'general', 'other'))
);

-- Indexes
CREATE INDEX wishlists_household_idx ON wishlists(household_id);
CREATE INDEX wishlists_member_idx ON wishlists(member_id) WHERE member_id IS NOT NULL;
CREATE INDEX wishlists_child_idx ON wishlists(child_id) WHERE child_id IS NOT NULL;
CREATE INDEX wishlists_occasion_idx ON wishlists(occasion, occasion_date);

-- RLS policies
ALTER TABLE wishlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own household wishlists"
  ON wishlists FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can create wishlists in own household"
  ON wishlists FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update own household wishlists"
  ON wishlists FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can delete own household wishlists"
  ON wishlists FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- Updated_at trigger
CREATE TRIGGER set_wishlists_updated_at
  BEFORE UPDATE ON wishlists
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================
-- PART 4: Create wishlist_items table
-- ============================================

CREATE TABLE wishlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id UUID NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  link TEXT,                    -- URL to product
  price DECIMAL(10, 2),         -- Price in local currency
  currency TEXT DEFAULT 'NOK',
  image_url TEXT,
  priority INT DEFAULT 0,       -- 0-5, higher = more wanted
  quantity INT DEFAULT 1,       -- How many wanted
  status TEXT NOT NULL DEFAULT 'open',
  reserved_by UUID REFERENCES household_members(id) ON DELETE SET NULL,
  reserved_at TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES household_members(id) ON DELETE SET NULL,
  fulfilled_at TIMESTAMPTZ,
  notes TEXT,                   -- Private notes (only visible to list owner)
  buyer_notes TEXT,             -- Notes visible to buyers (size, color preferences)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  CONSTRAINT wishlist_items_status_check CHECK (status IN ('open', 'reserved', 'fulfilled', 'dismissed')),
  CONSTRAINT wishlist_items_name_length CHECK (char_length(name) <= 200),
  CONSTRAINT wishlist_items_priority_check CHECK (priority >= 0 AND priority <= 5),
  CONSTRAINT wishlist_items_quantity_check CHECK (quantity >= 1)
);

-- Indexes
CREATE INDEX wishlist_items_list_idx ON wishlist_items(wishlist_id);
CREATE INDEX wishlist_items_status_idx ON wishlist_items(status) WHERE status = 'open';
CREATE INDEX wishlist_items_priority_idx ON wishlist_items(wishlist_id, priority DESC);

-- RLS policies (through wishlist ownership)
ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user has access to a wishlist
CREATE OR REPLACE FUNCTION user_has_wishlist_access(p_wishlist_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM wishlists
    WHERE id = p_wishlist_id
    AND household_id = get_user_household_id()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE POLICY "Users can view wishlist items in own household"
  ON wishlist_items FOR SELECT
  TO authenticated
  USING (user_has_wishlist_access(wishlist_id));

CREATE POLICY "Users can create wishlist items in own household"
  ON wishlist_items FOR INSERT
  TO authenticated
  WITH CHECK (user_has_wishlist_access(wishlist_id));

CREATE POLICY "Users can update wishlist items in own household"
  ON wishlist_items FOR UPDATE
  TO authenticated
  USING (user_has_wishlist_access(wishlist_id))
  WITH CHECK (user_has_wishlist_access(wishlist_id));

CREATE POLICY "Users can delete wishlist items in own household"
  ON wishlist_items FOR DELETE
  TO authenticated
  USING (user_has_wishlist_access(wishlist_id));

-- Updated_at trigger
CREATE TRIGGER set_wishlist_items_updated_at
  BEFORE UPDATE ON wishlist_items
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================
-- PART 5: Admin policies for new tables
-- ============================================

CREATE POLICY "Admins can view all household reminders"
  ON household_reminders FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admins can view all wishlists"
  ON wishlists FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admins can view all wishlist items"
  ON wishlist_items FOR SELECT
  TO authenticated
  USING (is_admin());
