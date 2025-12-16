-- More aggressive duplicate cleanup - keep only one entry per user_id
WITH duplicates AS (
  SELECT id, user_id, household_id,
         ROW_NUMBER() OVER (PARTITION BY user_id, household_id ORDER BY created_at ASC, id ASC) as rn
  FROM household_members
  WHERE user_id IS NOT NULL
)
DELETE FROM household_members
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
