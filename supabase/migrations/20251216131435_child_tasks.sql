-- Child Tasks: reminders and appointments for kids
-- Examples: "Ta med bleier", "Legetime kl 14:30", "Turdag - husk tursekk"

CREATE TABLE child_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TIME,  -- Optional, for appointments
  task_type TEXT NOT NULL DEFAULT 'reminder',  -- 'bring' | 'appointment' | 'reminder' | 'other'
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'done'
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  CONSTRAINT child_tasks_type_check CHECK (task_type IN ('bring', 'appointment', 'reminder', 'other')),
  CONSTRAINT child_tasks_status_check CHECK (status IN ('open', 'done')),
  CONSTRAINT child_tasks_title_length CHECK (char_length(title) <= 100)
);

-- Indexes for common queries
CREATE INDEX child_tasks_date_idx ON child_tasks(household_id, date);
CREATE INDEX child_tasks_child_idx ON child_tasks(child_id, date);
CREATE INDEX child_tasks_status_idx ON child_tasks(household_id, status, date) WHERE status = 'open';

-- RLS policies
ALTER TABLE child_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own household tasks"
  ON child_tasks FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can create tasks in own household"
  ON child_tasks FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update own household tasks"
  ON child_tasks FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can delete own household tasks"
  ON child_tasks FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- Simple updated_at trigger (no updated_by to avoid audit issues)
CREATE TRIGGER set_child_tasks_updated_at
  BEFORE UPDATE ON child_tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
