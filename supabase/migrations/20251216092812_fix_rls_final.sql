-- Fix the households SELECT policy to allow new users to see households during setup
DROP POLICY IF EXISTS "Users can view own household" ON households;
DROP POLICY IF EXISTS "Users can view their household" ON households;

-- Allow viewing household if: you're a member OR you're in setup mode (no household yet)
CREATE POLICY "Users can view own household"
  ON households FOR SELECT
  TO authenticated
  USING (
    id = get_user_household_id() 
    OR get_user_household_id() IS NULL
  );

-- Fix the households INSERT policy to include TO authenticated
DROP POLICY IF EXISTS "Users can create household" ON households;
CREATE POLICY "Users can create household"
  ON households FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Fix household_members INSERT to be more permissive during setup
DROP POLICY IF EXISTS "Users can insert household members" ON household_members;
CREATE POLICY "Users can insert household members"
  ON household_members FOR INSERT
  TO authenticated
  WITH CHECK (
    household_id = get_user_household_id()
    OR get_user_household_id() IS NULL
  );

-- Fix household_members SELECT to allow viewing during setup
DROP POLICY IF EXISTS "Users can view household members" ON household_members;
CREATE POLICY "Users can view household members"
  ON household_members FOR SELECT
  TO authenticated
  USING (
    household_id = get_user_household_id()
    OR user_id = auth.uid()
    OR get_user_household_id() IS NULL
  );
