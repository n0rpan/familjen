-- Migration: Add allergies field for household members (parents)
-- Used by AI meal suggestions to avoid allergens for the whole family

ALTER TABLE household_members
ADD COLUMN IF NOT EXISTS allergies TEXT[] DEFAULT '{}';

COMMENT ON COLUMN household_members.allergies IS 'List of allergies/dietary restrictions for the household member';
