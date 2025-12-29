-- Add admin policies to view all households, members, and children
-- Admins need to see all data for the admin panel

-- Allow admins to view all households
CREATE POLICY "Admins can view all households"
  ON households FOR SELECT
  TO authenticated
  USING (is_admin());

-- Allow admins to view all household members
CREATE POLICY "Admins can view all household members"
  ON household_members FOR SELECT
  TO authenticated
  USING (is_admin());

-- Allow admins to view all children
CREATE POLICY "Admins can view all children"
  ON children FOR SELECT
  TO authenticated
  USING (is_admin());

-- Allow admins to update household members (for linking users)
CREATE POLICY "Admins can update all household members"
  ON household_members FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
