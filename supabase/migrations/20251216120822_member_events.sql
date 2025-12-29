-- Migration: Member Events
-- Stores calendar events for household members (work trips, dinners, etc.)
-- Used for visibility in week planning and later for Google Calendar sync

CREATE TABLE member_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  end_date DATE,  -- for multi-day events (null = single day)
  title TEXT NOT NULL,
  event_type TEXT DEFAULT 'other',  -- 'work' | 'travel' | 'family' | 'other'
  source TEXT DEFAULT 'manual',  -- 'manual' | 'google_calendar'
  source_email TEXT,  -- email that sent the invite (for google sync)
  google_event_id TEXT,  -- for deduplication with Google Calendar
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Index for efficient week queries
CREATE INDEX member_events_date_idx ON member_events(household_id, date);
CREATE INDEX member_events_member_idx ON member_events(member_id, date);

-- Unique constraint to prevent duplicate Google Calendar events
CREATE UNIQUE INDEX member_events_google_unique
ON member_events(household_id, member_id, date, google_event_id)
WHERE google_event_id IS NOT NULL;

-- RLS policies
ALTER TABLE member_events ENABLE ROW LEVEL SECURITY;

-- Users can view events in their household
CREATE POLICY "View member events"
  ON member_events FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id() OR is_admin());

-- Users can create events in their household
CREATE POLICY "Create member events"
  ON member_events FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id() OR is_admin());

-- Users can update events in their household
CREATE POLICY "Update member events"
  ON member_events FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id() OR is_admin())
  WITH CHECK (household_id = get_user_household_id() OR is_admin());

-- Users can delete events in their household
CREATE POLICY "Delete member events"
  ON member_events FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id() OR is_admin());

-- Audit trigger
CREATE TRIGGER set_member_events_audit
  BEFORE INSERT OR UPDATE ON member_events
  FOR EACH ROW
  EXECUTE FUNCTION set_audit_columns();
