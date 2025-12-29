-- Phase 1: Data model additions for AI meals, shopping lists, calendar events
-- ==========================================================================

-- 1. Add birth_date to household_members and children
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS work_email TEXT;
ALTER TABLE children ADD COLUMN IF NOT EXISTS birth_date DATE;

-- 2. Add is_favorite to recipes
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false;

-- 3. Add AI meal context to households (default preferences)
ALTER TABLE households ADD COLUMN IF NOT EXISTS ai_meal_context TEXT;

-- 4. Shopping lists
CREATE TABLE IF NOT EXISTS shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity TEXT,
  is_bought BOOLEAN DEFAULT false,
  source_recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Calendar events (holidays, birthdays, family events)
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,  -- NULL for system-wide holidays
  date DATE NOT NULL,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'holiday',  -- 'holiday', 'birthday', 'family'
  is_annual BOOLEAN DEFAULT true,  -- repeats every year on same date
  source_member_id UUID REFERENCES household_members(id) ON DELETE CASCADE,  -- for birthdays
  source_child_id UUID REFERENCES children(id) ON DELETE CASCADE,  -- for birthdays
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Week-specific AI context
CREATE TABLE IF NOT EXISTS week_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,  -- Monday of the week
  context TEXT NOT NULL,  -- User's notes for this specific week
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, week_start)
);

-- Enable RLS on new tables
ALTER TABLE shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_contexts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shopping_lists
CREATE POLICY "Users can view own household shopping lists"
  ON shopping_lists FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can create shopping lists in own household"
  ON shopping_lists FOR INSERT TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update own household shopping lists"
  ON shopping_lists FOR UPDATE TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can delete own household shopping lists"
  ON shopping_lists FOR DELETE TO authenticated
  USING (household_id = get_user_household_id());

-- RLS Policies for shopping_list_items (through list ownership)
CREATE POLICY "Users can view shopping list items"
  ON shopping_list_items FOR SELECT TO authenticated
  USING (list_id IN (SELECT id FROM shopping_lists WHERE household_id = get_user_household_id()));

CREATE POLICY "Users can create shopping list items"
  ON shopping_list_items FOR INSERT TO authenticated
  WITH CHECK (list_id IN (SELECT id FROM shopping_lists WHERE household_id = get_user_household_id()));

CREATE POLICY "Users can update shopping list items"
  ON shopping_list_items FOR UPDATE TO authenticated
  USING (list_id IN (SELECT id FROM shopping_lists WHERE household_id = get_user_household_id()));

CREATE POLICY "Users can delete shopping list items"
  ON shopping_list_items FOR DELETE TO authenticated
  USING (list_id IN (SELECT id FROM shopping_lists WHERE household_id = get_user_household_id()));

-- RLS Policies for calendar_events
CREATE POLICY "Users can view own household events and system holidays"
  ON calendar_events FOR SELECT TO authenticated
  USING (household_id IS NULL OR household_id = get_user_household_id());

CREATE POLICY "Users can create events in own household"
  ON calendar_events FOR INSERT TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update own household events"
  ON calendar_events FOR UPDATE TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can delete own household events"
  ON calendar_events FOR DELETE TO authenticated
  USING (household_id = get_user_household_id());

-- RLS Policies for week_contexts
CREATE POLICY "Users can view own household week contexts"
  ON week_contexts FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can manage own household week contexts"
  ON week_contexts FOR ALL TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

-- Admin policies for new tables
CREATE POLICY "Admin can view all shopping lists"
  ON shopping_lists FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Admin can view all shopping list items"
  ON shopping_list_items FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Admin can view all calendar events"
  ON calendar_events FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Admin can view all week contexts"
  ON week_contexts FOR SELECT TO authenticated
  USING (is_admin());

-- Indexes for performance
CREATE INDEX IF NOT EXISTS shopping_lists_household_id_idx ON shopping_lists(household_id);
CREATE INDEX IF NOT EXISTS shopping_list_items_list_id_idx ON shopping_list_items(list_id);
CREATE INDEX IF NOT EXISTS shopping_list_items_is_bought_idx ON shopping_list_items(is_bought);
CREATE INDEX IF NOT EXISTS calendar_events_household_id_idx ON calendar_events(household_id);
CREATE INDEX IF NOT EXISTS calendar_events_date_idx ON calendar_events(date);
CREATE INDEX IF NOT EXISTS week_contexts_household_week_idx ON week_contexts(household_id, week_start);

-- ==========================================================================
-- Norwegian Holidays (system-wide, household_id = NULL)
-- ==========================================================================

INSERT INTO calendar_events (household_id, date, name, event_type, is_annual) VALUES
  -- Fixed date holidays
  (NULL, '2025-01-01', 'Første nyttårsdag', 'holiday', true),
  (NULL, '2025-05-01', 'Arbeidernes dag', 'holiday', true),
  (NULL, '2025-05-17', 'Grunnlovsdag', 'holiday', true),
  (NULL, '2025-12-24', 'Julaften', 'holiday', true),
  (NULL, '2025-12-25', 'Første juledag', 'holiday', true),
  (NULL, '2025-12-26', 'Andre juledag', 'holiday', true),
  (NULL, '2025-12-31', 'Nyttårsaften', 'holiday', true),

  -- 2025 Easter dates (moveable)
  (NULL, '2025-04-13', 'Palmesøndag', 'holiday', false),
  (NULL, '2025-04-17', 'Skjærtorsdag', 'holiday', false),
  (NULL, '2025-04-18', 'Langfredag', 'holiday', false),
  (NULL, '2025-04-20', 'Første påskedag', 'holiday', false),
  (NULL, '2025-04-21', 'Andre påskedag', 'holiday', false),

  -- 2025 other moveable holidays
  (NULL, '2025-05-29', 'Kristi himmelfartsdag', 'holiday', false),
  (NULL, '2025-06-08', 'Første pinsedag', 'holiday', false),
  (NULL, '2025-06-09', 'Andre pinsedag', 'holiday', false),

  -- 2026 Easter dates
  (NULL, '2026-03-29', 'Palmesøndag', 'holiday', false),
  (NULL, '2026-04-02', 'Skjærtorsdag', 'holiday', false),
  (NULL, '2026-04-03', 'Langfredag', 'holiday', false),
  (NULL, '2026-04-05', 'Første påskedag', 'holiday', false),
  (NULL, '2026-04-06', 'Andre påskedag', 'holiday', false),
  (NULL, '2026-05-14', 'Kristi himmelfartsdag', 'holiday', false),
  (NULL, '2026-05-24', 'Første pinsedag', 'holiday', false),
  (NULL, '2026-05-25', 'Andre pinsedag', 'holiday', false)
ON CONFLICT DO NOTHING;
