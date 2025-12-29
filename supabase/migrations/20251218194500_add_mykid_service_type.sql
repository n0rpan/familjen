-- Add 'mykid' to the external_integrations service check constraint
-- This is idempotent - safe to run multiple times

-- Drop the old constraint if it exists
ALTER TABLE external_integrations 
DROP CONSTRAINT IF EXISTS external_integrations_service_check;

-- Add new constraint including 'mykid'
ALTER TABLE external_integrations 
ADD CONSTRAINT external_integrations_service_check 
CHECK (service = ANY (ARRAY['spond'::text, 'kidplan'::text, 'iskole'::text, 'mykid'::text]));
