-- Function to create household with admin member atomically
-- Uses SECURITY DEFINER to bypass RLS during creation
CREATE OR REPLACE FUNCTION create_household_with_admin(
  p_household_name TEXT,
  p_member_name TEXT,
  p_member_email TEXT
)
RETURNS UUID AS $$
DECLARE
  v_household_id UUID;
  v_user_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Check if user already has a household
  IF EXISTS (SELECT 1 FROM household_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'User already belongs to a household';
  END IF;

  -- Create the household
  INSERT INTO households (name)
  VALUES (p_household_name)
  RETURNING id INTO v_household_id;

  -- Create the admin member
  INSERT INTO household_members (
    household_id,
    user_id,
    name,
    short_name,
    email,
    is_parent,
    is_household_admin
  ) VALUES (
    v_household_id,
    v_user_id,
    p_member_name,
    LEFT(p_member_name, 3),
    LOWER(p_member_email),
    true,
    true
  );

  RETURN v_household_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION create_household_with_admin(TEXT, TEXT, TEXT) TO authenticated;
