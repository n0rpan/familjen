-- Add AI privacy setting to households
-- When true: send real names to AI ("Emma", "Oliver")
-- When false: anonymize ("Barn 1", "Barn 2") but still send ages and allergies

ALTER TABLE households
ADD COLUMN IF NOT EXISTS share_names_with_ai BOOLEAN DEFAULT true;

-- Default to true for existing households (maintains current behavior)
-- New households will also default to true, but users can change it

COMMENT ON COLUMN households.share_names_with_ai IS
  'When true, children names are sent to AI for personalized suggestions. When false, uses "Barn 1", "Barn 2" etc.';
