-- Migration: Fix external_events RLS policy to support source_url_id
-- The existing policy only checks integration_id, but calendar source events use source_url_id

-- Update INSERT policy to check EITHER integration_id OR source_url_id
DROP POLICY IF EXISTS "Users can insert own household external events" ON external_events;
CREATE POLICY "Users can insert own household external events"
  ON external_events FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if integration_id matches user's household
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
    OR
    -- Allow if source_url_id matches user's household
    EXISTS (
      SELECT 1 FROM external_source_urls esu
      WHERE esu.id = source_url_id
      AND esu.household_id = get_user_household_id()
    )
  );

-- Update SELECT policy to also check source_url_id
DROP POLICY IF EXISTS "Users can view own household external events" ON external_events;
CREATE POLICY "Users can view own household external events"
  ON external_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
    OR
    EXISTS (
      SELECT 1 FROM external_source_urls esu
      WHERE esu.id = source_url_id
      AND esu.household_id = get_user_household_id()
    )
  );

-- Update UPDATE policy to also check source_url_id
DROP POLICY IF EXISTS "Users can update own household external events" ON external_events;
CREATE POLICY "Users can update own household external events"
  ON external_events FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
    OR
    EXISTS (
      SELECT 1 FROM external_source_urls esu
      WHERE esu.id = source_url_id
      AND esu.household_id = get_user_household_id()
    )
  );

-- Add DELETE policy (was missing)
DROP POLICY IF EXISTS "Users can delete own household external events" ON external_events;
CREATE POLICY "Users can delete own household external events"
  ON external_events FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_integrations ei
      WHERE ei.id = integration_id
      AND ei.household_id = get_user_household_id()
    )
    OR
    EXISTS (
      SELECT 1 FROM external_source_urls esu
      WHERE esu.id = source_url_id
      AND esu.household_id = get_user_household_id()
    )
  );
