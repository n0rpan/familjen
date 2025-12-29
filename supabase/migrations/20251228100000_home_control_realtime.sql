-- Enable Supabase Realtime for home control tables
-- This allows live sync between family members on the /styring page

-- Enable realtime for home control device state changes
ALTER PUBLICATION supabase_realtime ADD TABLE home_control_devices;
ALTER PUBLICATION supabase_realtime ADD TABLE home_control_groups;

-- Enable realtime for Toshiba AC devices
ALTER PUBLICATION supabase_realtime ADD TABLE toshiba_ac_devices;

-- Enable realtime for MelCloud (Mitsubishi) AC devices
ALTER PUBLICATION supabase_realtime ADD TABLE melcloud_devices;

-- Add updated_by column to track who made the change
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'home_control_devices' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE home_control_devices ADD COLUMN updated_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'toshiba_ac_devices' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE toshiba_ac_devices ADD COLUMN updated_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'melcloud_devices' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE melcloud_devices ADD COLUMN updated_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- Create triggers to auto-set updated_by
-- Note: set_updated_by() function is defined in 20251217212452_enable_realtime.sql
DROP TRIGGER IF EXISTS set_home_control_devices_updated_by ON home_control_devices;
CREATE TRIGGER set_home_control_devices_updated_by
  BEFORE INSERT OR UPDATE ON home_control_devices
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_by();

DROP TRIGGER IF EXISTS set_toshiba_ac_devices_updated_by ON toshiba_ac_devices;
CREATE TRIGGER set_toshiba_ac_devices_updated_by
  BEFORE INSERT OR UPDATE ON toshiba_ac_devices
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_by();

DROP TRIGGER IF EXISTS set_melcloud_devices_updated_by ON melcloud_devices;
CREATE TRIGGER set_melcloud_devices_updated_by
  BEFORE INSERT OR UPDATE ON melcloud_devices
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_by();
