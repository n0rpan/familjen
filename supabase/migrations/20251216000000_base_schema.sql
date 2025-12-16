-- Base Schema for Familjen
-- This migration creates all core tables before other migrations run

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- HOUSEHOLDS
-- ============================================
CREATE TABLE IF NOT EXISTS households (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  ai_meal_context TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by UUID
);

-- ============================================
-- HOUSEHOLD MEMBERS (Adults)
-- ============================================
CREATE TABLE IF NOT EXISTS household_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  work_email TEXT,
  phone TEXT,
  birth_date DATE,
  is_parent BOOLEAN DEFAULT true,
  is_household_admin BOOLEAN DEFAULT false,
  allergies TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by UUID
);

-- ============================================
-- CHILDREN
-- ============================================
CREATE TABLE IF NOT EXISTS children (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  birth_date DATE,
  color TEXT DEFAULT 'sky',
  location_name TEXT,
  location_type TEXT DEFAULT 'kindergarten',
  allergies TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by UUID
);

-- ============================================
-- PICKUPS
-- ============================================
CREATE TABLE IF NOT EXISTS pickups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,
  picker_id UUID REFERENCES household_members(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  sync_to_work_calendar BOOLEAN DEFAULT false,
  work_calendar_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by UUID,
  UNIQUE(child_id, date)
);

-- ============================================
-- RECIPES
-- ============================================
CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  ingredients JSONB DEFAULT '[]',
  instructions TEXT,
  url TEXT,
  is_favorite BOOLEAN DEFAULT false,
  is_quick BOOLEAN DEFAULT false,
  is_kid_friendly BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by UUID
);

-- ============================================
-- MEALS
-- ============================================
CREATE TABLE IF NOT EXISTS meals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
  custom_meal TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by UUID,
  UNIQUE(household_id, date)
);

-- ============================================
-- SHOPPING LIST
-- ============================================
CREATE TABLE IF NOT EXISTS shopping_list (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  quantity TEXT,
  checked BOOLEAN DEFAULT false,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ALLOWED EMAILS (Access Control)
-- ============================================
CREATE TABLE IF NOT EXISTS allowed_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  added_by UUID REFERENCES auth.users(id),
  is_admin BOOLEAN DEFAULT false,
  can_create_household BOOLEAN DEFAULT false,
  invited_by_household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- APP SETTINGS
-- ============================================
CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ============================================
-- CALENDAR EVENTS (Holidays)
-- ============================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  event_type TEXT DEFAULT 'holiday',
  is_annual BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- MEMBER EVENTS (Parent schedules)
-- ============================================
CREATE TABLE IF NOT EXISTS member_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  member_id UUID REFERENCES household_members(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'other',
  title TEXT,
  notes TEXT,
  source TEXT DEFAULT 'manual',
  google_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE(household_id, member_id, date, google_event_id)
);

-- ============================================
-- WEEK CONTEXTS (AI context per week)
-- ============================================
CREATE TABLE IF NOT EXISTS week_contexts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  context TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE(household_id, week_start)
);

-- ============================================
-- CHILD TASKS
-- ============================================
CREATE TABLE IF NOT EXISTS child_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TIME,
  task_type TEXT NOT NULL DEFAULT 'reminder',
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES household_members(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT child_tasks_type_check CHECK (task_type IN ('bring', 'appointment', 'reminder', 'other')),
  CONSTRAINT child_tasks_status_check CHECK (status IN ('open', 'done')),
  CONSTRAINT child_tasks_title_length CHECK (char_length(title) <= 100)
);

-- ============================================
-- GOOGLE CALENDAR TOKENS
-- ============================================
CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_type TEXT DEFAULT 'Bearer',
  expiry_date BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ============================================
-- AUDIT LOG
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name TEXT NOT NULL,
  record_id UUID,
  action TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_by UUID,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_household_members_household ON household_members(household_id);
CREATE INDEX IF NOT EXISTS idx_household_members_user ON household_members(user_id);
CREATE INDEX IF NOT EXISTS idx_children_household ON children(household_id);
CREATE INDEX IF NOT EXISTS idx_pickups_date ON pickups(date);
CREATE INDEX IF NOT EXISTS idx_pickups_household ON pickups(household_id);
CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(date);
CREATE INDEX IF NOT EXISTS idx_meals_household ON meals(household_id);
CREATE INDEX IF NOT EXISTS idx_recipes_household ON recipes(household_id);
CREATE INDEX IF NOT EXISTS idx_child_tasks_date ON child_tasks(date);
CREATE INDEX IF NOT EXISTS idx_child_tasks_child ON child_tasks(child_id);
CREATE INDEX IF NOT EXISTS idx_child_tasks_status ON child_tasks(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_member_events_date ON member_events(date);
CREATE INDEX IF NOT EXISTS idx_member_events_member ON member_events(member_id);

-- ============================================
-- HELPER FUNCTIONS (needed before RLS policies)
-- ============================================

-- Get user's household ID (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION get_user_household_id()
RETURNS UUID AS $$
  SELECT household_id
  FROM household_members
  WHERE user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Check if user is app admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM allowed_emails
    WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND is_admin = true
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Check if user is household admin
CREATE OR REPLACE FUNCTION is_household_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM household_members
    WHERE user_id = auth.uid()
    AND is_household_admin = true
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Set updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ENABLE RLS ON ALL TABLES
-- ============================================
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickups ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE allowed_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================
-- BASE RLS POLICIES
-- ============================================

-- Households: Users can see their own household
CREATE POLICY "Users can view own household" ON households
  FOR SELECT TO authenticated
  USING (id = get_user_household_id() OR get_user_household_id() IS NULL);

CREATE POLICY "Users can create household" ON households
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update own household" ON households
  FOR UPDATE TO authenticated
  USING (id = get_user_household_id());

-- Household Members
CREATE POLICY "Users can view household members" ON household_members
  FOR SELECT TO authenticated
  USING (household_id = get_user_household_id() OR user_id = auth.uid());

CREATE POLICY "Users can insert household members" ON household_members
  FOR INSERT TO authenticated
  WITH CHECK (household_id = get_user_household_id() OR get_user_household_id() IS NULL);

CREATE POLICY "Users can update household members" ON household_members
  FOR UPDATE TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can delete household members" ON household_members
  FOR DELETE TO authenticated
  USING (household_id = get_user_household_id());

-- Children
CREATE POLICY "Users can view children" ON children
  FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can manage children" ON children
  FOR ALL TO authenticated
  USING (household_id = get_user_household_id());

-- Pickups
CREATE POLICY "Users can view pickups" ON pickups
  FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can manage pickups" ON pickups
  FOR ALL TO authenticated
  USING (household_id = get_user_household_id());

-- Recipes
CREATE POLICY "Users can view recipes" ON recipes
  FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can manage recipes" ON recipes
  FOR ALL TO authenticated
  USING (household_id = get_user_household_id());

-- Meals
CREATE POLICY "Users can view meals" ON meals
  FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can manage meals" ON meals
  FOR ALL TO authenticated
  USING (household_id = get_user_household_id());

-- Shopping List
CREATE POLICY "Users can view shopping list" ON shopping_list
  FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can manage shopping list" ON shopping_list
  FOR ALL TO authenticated
  USING (household_id = get_user_household_id());

-- Allowed Emails
CREATE POLICY "Admins can view all emails" ON allowed_emails
  FOR SELECT TO authenticated
  USING (is_admin() OR invited_by_household_id = get_user_household_id());

CREATE POLICY "Admins can manage emails" ON allowed_emails
  FOR ALL TO authenticated
  USING (is_admin());

-- App Settings
CREATE POLICY "Admins can manage settings" ON app_settings
  FOR ALL TO authenticated
  USING (is_admin());

CREATE POLICY "Users can view settings" ON app_settings
  FOR SELECT TO authenticated
  USING (true);

-- Calendar Events
CREATE POLICY "Users can view calendar events" ON calendar_events
  FOR SELECT TO authenticated
  USING (household_id = get_user_household_id() OR household_id IS NULL);

CREATE POLICY "Users can manage calendar events" ON calendar_events
  FOR ALL TO authenticated
  USING (household_id = get_user_household_id());

-- Member Events
CREATE POLICY "Users can view member events" ON member_events
  FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can manage member events" ON member_events
  FOR ALL TO authenticated
  USING (household_id = get_user_household_id());

-- Week Contexts
CREATE POLICY "Users can view week contexts" ON week_contexts
  FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can manage week contexts" ON week_contexts
  FOR ALL TO authenticated
  USING (household_id = get_user_household_id());

-- Child Tasks
CREATE POLICY "Users can view child tasks" ON child_tasks
  FOR SELECT TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can manage child tasks" ON child_tasks
  FOR ALL TO authenticated
  USING (household_id = get_user_household_id());

-- Google Calendar Tokens (admin only)
CREATE POLICY "Admins can manage calendar tokens" ON google_calendar_tokens
  FOR ALL TO authenticated
  USING (is_admin());

-- Audit Log (admin only)
CREATE POLICY "Admins can view audit log" ON audit_log
  FOR SELECT TO authenticated
  USING (is_admin());

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER set_households_updated_at
  BEFORE UPDATE ON households
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_household_members_updated_at
  BEFORE UPDATE ON household_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_children_updated_at
  BEFORE UPDATE ON children
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_pickups_updated_at
  BEFORE UPDATE ON pickups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_recipes_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_meals_updated_at
  BEFORE UPDATE ON meals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_child_tasks_updated_at
  BEFORE UPDATE ON child_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_google_calendar_tokens_updated_at
  BEFORE UPDATE ON google_calendar_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
