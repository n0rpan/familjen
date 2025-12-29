-- Migration: Add allergies field for children
-- Used by AI meal suggestions to avoid allergens

ALTER TABLE children
ADD COLUMN IF NOT EXISTS allergies TEXT[] DEFAULT '{}';

COMMENT ON COLUMN children.allergies IS 'List of allergies/dietary restrictions for the child';
