-- Enable Supabase Realtime for collaboration tables
-- This allows live sync between family members using the app simultaneously

-- Enable realtime for shopping list items (grocery store scenario)
ALTER PUBLICATION supabase_realtime ADD TABLE shopping_list_items;
ALTER PUBLICATION supabase_realtime ADD TABLE shopping_lists;

-- Enable realtime for week planner tables (planning sessions)
ALTER PUBLICATION supabase_realtime ADD TABLE pickups;
ALTER PUBLICATION supabase_realtime ADD TABLE meals;
ALTER PUBLICATION supabase_realtime ADD TABLE child_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE member_events;

-- Enable realtime for household settings (less frequent but still useful)
ALTER PUBLICATION supabase_realtime ADD TABLE children;
ALTER PUBLICATION supabase_realtime ADD TABLE household_members;

-- Note: RLS policies already filter by household_id, and Supabase Realtime respects RLS
-- This means users will only receive events for their own household's data

-- Optional: Add updated_by column for tracking who made changes
-- This enables better toast messages like "Anna checked off Milk"
-- The column references auth.users(id) to track the user who made the change

-- Add updated_by to shopping_list_items if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shopping_list_items' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE shopping_list_items ADD COLUMN updated_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- Add updated_by to pickups if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pickups' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE pickups ADD COLUMN updated_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- Add updated_by to meals if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'meals' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE meals ADD COLUMN updated_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- Add updated_by to child_tasks if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'child_tasks' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE child_tasks ADD COLUMN updated_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- Add updated_by to member_events if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'member_events' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE member_events ADD COLUMN updated_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- Create a trigger function to automatically set updated_by on changes
CREATE OR REPLACE FUNCTION set_updated_by()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers to auto-set updated_by (drop first to avoid duplicates)
DROP TRIGGER IF EXISTS set_shopping_list_items_updated_by ON shopping_list_items;
CREATE TRIGGER set_shopping_list_items_updated_by
  BEFORE INSERT OR UPDATE ON shopping_list_items
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_by();

DROP TRIGGER IF EXISTS set_pickups_updated_by ON pickups;
CREATE TRIGGER set_pickups_updated_by
  BEFORE INSERT OR UPDATE ON pickups
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_by();

DROP TRIGGER IF EXISTS set_meals_updated_by ON meals;
CREATE TRIGGER set_meals_updated_by
  BEFORE INSERT OR UPDATE ON meals
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_by();

DROP TRIGGER IF EXISTS set_child_tasks_updated_by ON child_tasks;
CREATE TRIGGER set_child_tasks_updated_by
  BEFORE INSERT OR UPDATE ON child_tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_by();

DROP TRIGGER IF EXISTS set_member_events_updated_by ON member_events;
CREATE TRIGGER set_member_events_updated_by
  BEFORE INSERT OR UPDATE ON member_events
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_by();

-- Grant execute on function to authenticated users
GRANT EXECUTE ON FUNCTION set_updated_by() TO authenticated;
