-- ============================================
-- Add notes column to pickups table
-- ============================================
-- Required by Family API for external AI assistants to add context
-- Example: "Emma har med gummistøvler" (Emma needs to bring rain boots)

ALTER TABLE pickups
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add length constraint to prevent abuse
ALTER TABLE pickups
  ADD CONSTRAINT pickups_notes_length CHECK (notes IS NULL OR length(notes) <= 1000);
