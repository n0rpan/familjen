-- Allow any authenticated user to check if their email is allowed
CREATE POLICY "Users can check own email"
  ON allowed_emails FOR SELECT
  TO authenticated
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));
