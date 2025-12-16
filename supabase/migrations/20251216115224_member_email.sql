-- Migration: Add email field to household_members
-- This allows specifying a login email when adding a member
-- The email will also be added to allowed_emails for login access

ALTER TABLE household_members
ADD COLUMN IF NOT EXISTS email TEXT;

-- Add unique constraint on email (only one member per email)
CREATE UNIQUE INDEX IF NOT EXISTS household_members_email_unique
ON household_members(email)
WHERE email IS NOT NULL;

COMMENT ON COLUMN household_members.email IS 'Login email for this member - also added to allowed_emails';
