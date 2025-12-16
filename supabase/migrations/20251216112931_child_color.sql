-- Migration: Add color field for children
-- Allows visual distinction of children in the UI

ALTER TABLE children
ADD COLUMN IF NOT EXISTS color TEXT DEFAULT 'sky';

-- Common colors that work well with the app theme
COMMENT ON COLUMN children.color IS 'Color theme for the child: sky, coral, sage, honey, lavender, mint';
