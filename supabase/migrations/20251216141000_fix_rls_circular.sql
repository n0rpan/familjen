-- Fix RLS circular dependency issue
-- The problem: household_members policy queries household_members, causing recursion

-- Create a SECURITY DEFINER function to get user's household_id without RLS
CREATE OR REPLACE FUNCTION get_user_household_id()
RETURNS UUID AS $$
  SELECT household_id
  FROM household_members
  WHERE user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Drop existing policies that have circular dependencies
DROP POLICY IF EXISTS "Users can view own household" ON households;
DROP POLICY IF EXISTS "Users can update own household" ON households;
DROP POLICY IF EXISTS "Users can view household members" ON household_members;
DROP POLICY IF EXISTS "Users can create household member" ON household_members;
DROP POLICY IF EXISTS "Users can update household members" ON household_members;
DROP POLICY IF EXISTS "Users can delete household members" ON household_members;

-- ===========================================
-- HOUSEHOLDS - Using helper function
-- ===========================================

-- Users can only view their household
CREATE POLICY "Users can view own household"
  ON households FOR SELECT
  TO authenticated
  USING (id = get_user_household_id());

-- Users can update their household
CREATE POLICY "Users can update own household"
  ON households FOR UPDATE
  TO authenticated
  USING (id = get_user_household_id())
  WITH CHECK (id = get_user_household_id());

-- ===========================================
-- HOUSEHOLD_MEMBERS - Using helper function
-- ===========================================

-- Users can view members of their household OR see their own membership (for new users)
CREATE POLICY "Users can view household members"
  ON household_members FOR SELECT
  TO authenticated
  USING (
    household_id = get_user_household_id()
    OR user_id = auth.uid()
  );

-- Users can create members in their household OR add themselves to a new household
CREATE POLICY "Users can create household member"
  ON household_members FOR INSERT
  TO authenticated
  WITH CHECK (
    household_id = get_user_household_id()
    OR (get_user_household_id() IS NULL AND user_id = auth.uid())
  );

-- Users can update members in their household
CREATE POLICY "Users can update household members"
  ON household_members FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

-- Users can delete members in their household
CREATE POLICY "Users can delete household members"
  ON household_members FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- ===========================================
-- Fix CHILDREN policies to use helper function
-- ===========================================
DROP POLICY IF EXISTS "Users can view children" ON children;
DROP POLICY IF EXISTS "Users can insert children" ON children;
DROP POLICY IF EXISTS "Users can update children" ON children;
DROP POLICY IF EXISTS "Users can delete children" ON children;

CREATE POLICY "Users can view children"
  ON children FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert children"
  ON children FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update children"
  ON children FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can delete children"
  ON children FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- ===========================================
-- Fix PICKUPS policies
-- ===========================================
DROP POLICY IF EXISTS "Users can view pickups" ON pickups;
DROP POLICY IF EXISTS "Users can insert pickups" ON pickups;
DROP POLICY IF EXISTS "Users can update pickups" ON pickups;
DROP POLICY IF EXISTS "Users can delete pickups" ON pickups;

CREATE POLICY "Users can view pickups"
  ON pickups FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert pickups"
  ON pickups FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update pickups"
  ON pickups FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can delete pickups"
  ON pickups FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- ===========================================
-- Fix MEALS policies
-- ===========================================
DROP POLICY IF EXISTS "Users can view meals" ON meals;
DROP POLICY IF EXISTS "Users can insert meals" ON meals;
DROP POLICY IF EXISTS "Users can update meals" ON meals;
DROP POLICY IF EXISTS "Users can delete meals" ON meals;

CREATE POLICY "Users can view meals"
  ON meals FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert meals"
  ON meals FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update meals"
  ON meals FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can delete meals"
  ON meals FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- ===========================================
-- Fix RECIPES policies
-- ===========================================
DROP POLICY IF EXISTS "Users can view recipes" ON recipes;
DROP POLICY IF EXISTS "Users can insert recipes" ON recipes;
DROP POLICY IF EXISTS "Users can update recipes" ON recipes;
DROP POLICY IF EXISTS "Users can delete recipes" ON recipes;

CREATE POLICY "Users can view recipes"
  ON recipes FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert recipes"
  ON recipes FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update recipes"
  ON recipes FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can delete recipes"
  ON recipes FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());
