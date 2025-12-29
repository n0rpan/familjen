-- Fix RLS policies to allow new users to create households

-- Allow anyone authenticated to create a household
CREATE POLICY "Users can create household"
  ON households FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow first household member to be created (before get_user_household_id returns anything)
-- This is needed for the initial setup
DROP POLICY IF EXISTS "Users can insert household members" ON household_members;

CREATE POLICY "Users can insert household members"
  ON household_members FOR INSERT
  WITH CHECK (
    -- Either joining existing household OR creating first member for new household
    household_id = get_user_household_id()
    OR
    (
      -- Allow inserting into a household if user has no household yet
      -- and the user_id matches the authenticated user
      get_user_household_id() IS NULL
      AND user_id = auth.uid()
    )
  );
