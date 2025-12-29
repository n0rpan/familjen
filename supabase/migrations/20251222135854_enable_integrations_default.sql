-- Enable external integrations by default for all households
-- Previously required admin to manually enable per household
-- Now enabled by default, admin can disable if needed

-- Change default for new households
ALTER TABLE households
  ALTER COLUMN external_integrations_enabled SET DEFAULT true;

-- Enable for existing households
UPDATE households SET external_integrations_enabled = true
WHERE external_integrations_enabled = false;
