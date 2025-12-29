-- Create central audit_log table for tracking all changes
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID REFERENCES auth.users(id),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  row_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  changes JSONB  -- Only the fields that changed (for UPDATE)
);

-- Create indexes for efficient querying
CREATE INDEX audit_log_household_id_idx ON audit_log(household_id);
CREATE INDEX audit_log_created_at_idx ON audit_log(created_at DESC);
CREATE INDEX audit_log_table_name_idx ON audit_log(table_name);
CREATE INDEX audit_log_actor_idx ON audit_log(actor_user_id);

-- Enable RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can view their household's audit log
CREATE POLICY "Users can view own household audit log"
  ON audit_log FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

-- RLS policy: Admins can view all audit logs
CREATE POLICY "Admins can view all audit logs"
  ON audit_log FOR SELECT
  TO authenticated
  USING (is_admin());

-- Function to compute changes between old and new JSONB
CREATE OR REPLACE FUNCTION compute_jsonb_changes(old_data JSONB, new_data JSONB)
RETURNS JSONB AS $$
DECLARE
  result JSONB := '{}';
  key TEXT;
BEGIN
  -- Iterate over all keys in new_data
  FOR key IN SELECT jsonb_object_keys(new_data)
  LOOP
    -- Skip internal fields
    IF key IN ('id', 'created_at', 'updated_at', 'updated_by') THEN
      CONTINUE;
    END IF;

    -- Check if value changed
    IF old_data->key IS DISTINCT FROM new_data->key THEN
      result := result || jsonb_build_object(
        key,
        jsonb_build_object(
          'old', old_data->key,
          'new', new_data->key
        )
      );
    END IF;
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Generic audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
  audit_row_id UUID;
  audit_household_id UUID;
  audit_old_data JSONB;
  audit_new_data JSONB;
  audit_changes JSONB;
BEGIN
  -- Determine row ID and household_id based on operation
  IF TG_OP = 'DELETE' THEN
    audit_row_id := OLD.id;
    audit_household_id := OLD.household_id;
    audit_old_data := to_jsonb(OLD);
    audit_new_data := NULL;
    audit_changes := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    audit_row_id := NEW.id;
    audit_household_id := NEW.household_id;
    audit_old_data := NULL;
    audit_new_data := to_jsonb(NEW);
    audit_changes := NULL;
  ELSE -- UPDATE
    audit_row_id := NEW.id;
    audit_household_id := NEW.household_id;
    audit_old_data := to_jsonb(OLD);
    audit_new_data := to_jsonb(NEW);
    audit_changes := compute_jsonb_changes(to_jsonb(OLD), to_jsonb(NEW));

    -- Skip if nothing actually changed (besides updated_at/updated_by)
    IF audit_changes = '{}' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Insert audit log entry
  INSERT INTO audit_log (
    actor_user_id,
    household_id,
    table_name,
    row_id,
    action,
    old_data,
    new_data,
    changes
  ) VALUES (
    auth.uid(),
    audit_household_id,
    TG_TABLE_NAME,
    audit_row_id,
    TG_OP,
    audit_old_data,
    audit_new_data,
    audit_changes
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit triggers for main tables
-- Note: Using AFTER triggers to capture final state

-- Pickups audit trigger
DROP TRIGGER IF EXISTS audit_pickups ON pickups;
CREATE TRIGGER audit_pickups
  AFTER INSERT OR UPDATE OR DELETE ON pickups
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Meals audit trigger
DROP TRIGGER IF EXISTS audit_meals ON meals;
CREATE TRIGGER audit_meals
  AFTER INSERT OR UPDATE OR DELETE ON meals
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Children audit trigger
DROP TRIGGER IF EXISTS audit_children ON children;
CREATE TRIGGER audit_children
  AFTER INSERT OR UPDATE OR DELETE ON children
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Household members audit trigger
DROP TRIGGER IF EXISTS audit_household_members ON household_members;
CREATE TRIGGER audit_household_members
  AFTER INSERT OR UPDATE OR DELETE ON household_members
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Recipes audit trigger
DROP TRIGGER IF EXISTS audit_recipes ON recipes;
CREATE TRIGGER audit_recipes
  AFTER INSERT OR UPDATE OR DELETE ON recipes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Households audit trigger (special case - no household_id on the row itself)
CREATE OR REPLACE FUNCTION audit_households_func()
RETURNS TRIGGER AS $$
DECLARE
  audit_row_id UUID;
  audit_old_data JSONB;
  audit_new_data JSONB;
  audit_changes JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    audit_row_id := OLD.id;
    audit_old_data := to_jsonb(OLD);
    audit_new_data := NULL;
    audit_changes := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    audit_row_id := NEW.id;
    audit_old_data := NULL;
    audit_new_data := to_jsonb(NEW);
    audit_changes := NULL;
  ELSE -- UPDATE
    audit_row_id := NEW.id;
    audit_old_data := to_jsonb(OLD);
    audit_new_data := to_jsonb(NEW);
    audit_changes := compute_jsonb_changes(to_jsonb(OLD), to_jsonb(NEW));

    IF audit_changes = '{}' THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO audit_log (
    actor_user_id,
    household_id,
    table_name,
    row_id,
    action,
    old_data,
    new_data,
    changes
  ) VALUES (
    auth.uid(),
    audit_row_id,  -- For households table, the row itself IS the household
    'households',
    audit_row_id,
    TG_OP,
    audit_old_data,
    audit_new_data,
    audit_changes
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_households ON households;
CREATE TRIGGER audit_households
  AFTER INSERT OR UPDATE OR DELETE ON households
  FOR EACH ROW EXECUTE FUNCTION audit_households_func();
