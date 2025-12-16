-- Add language preference to household_members
ALTER TABLE household_members
ADD COLUMN IF NOT EXISTS language_preference TEXT DEFAULT 'nb';

-- Add check constraint for valid languages
ALTER TABLE household_members
ADD CONSTRAINT valid_language_preference
CHECK (language_preference IN ('nb', 'sv', 'en'));

COMMENT ON COLUMN household_members.language_preference IS 'User preferred language: nb (Norwegian), sv (Swedish), en (English)';
