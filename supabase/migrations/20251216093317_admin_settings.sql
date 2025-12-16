-- Allowed emails table
CREATE TABLE IF NOT EXISTS allowed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  added_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- App settings table (key-value store)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE allowed_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Admin email constant (you!)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT (SELECT email FROM auth.users WHERE id = auth.uid()) = 'oscar.nordstrom@gmail.com';
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Only admin can manage allowed_emails
CREATE POLICY "Admin can manage allowed emails"
  ON allowed_emails FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Only admin can manage app_settings
CREATE POLICY "Admin can manage app settings"
  ON app_settings FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Anyone authenticated can read app_settings (for LLM config etc)
CREATE POLICY "Users can read app settings"
  ON app_settings FOR SELECT
  TO authenticated
  USING (true);

-- Insert default settings
INSERT INTO app_settings (key, value) VALUES 
  ('openrouter_model', 'anthropic/claude-3.5-sonnet'),
  ('admin_email', 'oscar.nordstrom@gmail.com')
ON CONFLICT (key) DO NOTHING;

-- Insert your email as first allowed email
INSERT INTO allowed_emails (email, is_admin, can_create_household) VALUES
  ('oscar.nordstrom@gmail.com', true, true)
ON CONFLICT (email) DO NOTHING;

-- Function to check if email is allowed (for auth hook)
CREATE OR REPLACE FUNCTION is_email_allowed(check_email TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM allowed_emails WHERE email = check_email);
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
