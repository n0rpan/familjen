-- CI Events Table
-- Stores events from GitHub Actions for the admin CI dashboard

CREATE TABLE IF NOT EXISTS ci_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- pr_opened, review_started, review_completed, verdict, labels_applied
  pr_number INTEGER NOT NULL,
  pr_title TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_ci_events_created_at ON ci_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ci_events_pr_number ON ci_events(pr_number);
CREATE INDEX IF NOT EXISTS idx_ci_events_type ON ci_events(type);

-- Enable RLS
ALTER TABLE ci_events ENABLE ROW LEVEL SECURITY;

-- Only admins can read CI events
CREATE POLICY "Admins can view CI events" ON ci_events
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- Service role can insert (for webhook)
-- No policy needed - service role bypasses RLS

-- Comment for documentation
COMMENT ON TABLE ci_events IS 'Stores CI/CD events from GitHub Actions for admin dashboard';
COMMENT ON COLUMN ci_events.type IS 'Event type: pr_opened, review_started, review_completed, verdict, labels_applied';
COMMENT ON COLUMN ci_events.data IS 'Event-specific data: verdict, cost_usd, labels, summary, etc.';
