-- Remove duplicate household_members, keeping only the first one per user_id
DELETE FROM household_members a
USING household_members b
WHERE a.user_id = b.user_id 
  AND a.household_id = b.household_id
  AND a.created_at > b.created_at;
