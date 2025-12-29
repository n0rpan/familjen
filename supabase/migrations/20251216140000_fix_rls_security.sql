-- Fix RLS security leak: remove permissive "OR get_user_household_id() IS NULL" patterns
-- This was allowing new users to see ALL households and members

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view own household" ON households;
DROP POLICY IF EXISTS "Users can create household" ON households;
DROP POLICY IF EXISTS "Users can update own household" ON households;

DROP POLICY IF EXISTS "Users can view household members" ON household_members;
DROP POLICY IF EXISTS "Users can create household member" ON household_members;
DROP POLICY IF EXISTS "Users can update household members" ON household_members;
DROP POLICY IF EXISTS "Users can delete household members" ON household_members;

-- ===========================================
-- HOUSEHOLDS - Fixed policies
-- ===========================================

-- Users can only view households they're a member of
CREATE POLICY "Users can view own household"
  ON households FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT household_id FROM household_members
      WHERE user_id = auth.uid()
    )
  );

-- Any authenticated user can create a household (for initial setup)
CREATE POLICY "Users can create household"
  ON households FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Users can only update households they're a member of
CREATE POLICY "Users can update own household"
  ON households FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT household_id FROM household_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT household_id FROM household_members
      WHERE user_id = auth.uid()
    )
  );

-- ===========================================
-- HOUSEHOLD_MEMBERS - Fixed policies
-- ===========================================

-- Users can view members of households they belong to, OR their own membership
CREATE POLICY "Users can view household members"
  ON household_members FOR SELECT
  TO authenticated
  USING (
    household_id IN (
      SELECT hm.household_id FROM household_members hm
      WHERE hm.user_id = auth.uid()
    )
    OR user_id = auth.uid()
  );

-- Users can create a member in their household, OR create themselves as a member of a new household
CREATE POLICY "Users can create household member"
  ON household_members FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Either: Adding to a household you're already a member of
    household_id IN (
      SELECT hm.household_id FROM household_members hm
      WHERE hm.user_id = auth.uid()
    )
    -- Or: Adding yourself to any household (for initial setup when creating a new household)
    OR user_id = auth.uid()
  );

-- Users can update members in their household
CREATE POLICY "Users can update household members"
  ON household_members FOR UPDATE
  TO authenticated
  USING (
    household_id IN (
      SELECT hm.household_id FROM household_members hm
      WHERE hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    household_id IN (
      SELECT hm.household_id FROM household_members hm
      WHERE hm.user_id = auth.uid()
    )
  );

-- Users can delete members in their household (except themselves maybe - handled in app)
CREATE POLICY "Users can delete household members"
  ON household_members FOR DELETE
  TO authenticated
  USING (
    household_id IN (
      SELECT hm.household_id FROM household_members hm
      WHERE hm.user_id = auth.uid()
    )
  );

-- ===========================================
-- Add unique constraint on user_id for one-household-per-user design
-- ===========================================
-- First clean up any duplicates
DELETE FROM household_members a
USING household_members b
WHERE a.user_id = b.user_id
  AND a.user_id IS NOT NULL
  AND a.created_at > b.created_at;

-- Add unique constraint (only one household membership per user)
ALTER TABLE household_members
  DROP CONSTRAINT IF EXISTS household_members_user_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS household_members_user_id_unique
  ON household_members(user_id)
  WHERE user_id IS NOT NULL;

-- ===========================================
-- Update is_admin() to use allowed_emails.is_admin column
-- ===========================================

-- Add is_admin column to allowed_emails if not exists
ALTER TABLE allowed_emails
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Set admin email as admin (customize this!)
-- IMPORTANT: Replace 'admin@example.com' with your actual admin email
UPDATE allowed_emails
SET is_admin = true
WHERE email = 'admin@example.com';

-- Redefine is_admin() function to check the database instead of hardcoded email
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM allowed_emails
    WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND is_admin = true
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ===========================================
-- Add audit columns to core tables
-- ===========================================

-- Add updated_at and updated_by to households
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- Add updated_at and updated_by to household_members
ALTER TABLE household_members
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- Add updated_at and updated_by to children
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- Add updated_at and updated_by to pickups
ALTER TABLE pickups
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- Add updated_at and updated_by to meals
ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- Add updated_at and updated_by to recipes
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- ===========================================
-- Create triggers to auto-update audit columns
-- ===========================================

-- Function to set audit columns
CREATE OR REPLACE FUNCTION set_audit_columns()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply triggers to all tables with audit columns
DROP TRIGGER IF EXISTS set_audit_households ON households;
CREATE TRIGGER set_audit_households
  BEFORE INSERT OR UPDATE ON households
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

DROP TRIGGER IF EXISTS set_audit_household_members ON household_members;
CREATE TRIGGER set_audit_household_members
  BEFORE INSERT OR UPDATE ON household_members
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

DROP TRIGGER IF EXISTS set_audit_children ON children;
CREATE TRIGGER set_audit_children
  BEFORE INSERT OR UPDATE ON children
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

DROP TRIGGER IF EXISTS set_audit_pickups ON pickups;
CREATE TRIGGER set_audit_pickups
  BEFORE INSERT OR UPDATE ON pickups
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

DROP TRIGGER IF EXISTS set_audit_meals ON meals;
CREATE TRIGGER set_audit_meals
  BEFORE INSERT OR UPDATE ON meals
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

DROP TRIGGER IF EXISTS set_audit_recipes ON recipes;
CREATE TRIGGER set_audit_recipes
  BEFORE INSERT OR UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();
