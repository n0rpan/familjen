-- Add can_create_household flag to control who can create new households
-- Users with this flag can create their own household when they first log in
-- Users without this flag must be invited to an existing household

ALTER TABLE allowed_emails
ADD COLUMN IF NOT EXISTS can_create_household BOOLEAN DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN allowed_emails.can_create_household IS
'If true, user can create their own household. If false, they must be invited to one.';
