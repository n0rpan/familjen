-- Push Notifications Infrastructure
-- Supports PWA push notifications for household events

-- ============================================================================
-- Push Subscriptions Table
-- ============================================================================
-- Stores web push subscriptions per user per device

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one subscription per endpoint per user
  UNIQUE(user_id, endpoint)
);

-- Index for quick lookup by user
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- RLS Policies
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own subscriptions
CREATE POLICY "Users manage own push subscriptions"
  ON push_subscriptions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- Notification Preferences
-- ============================================================================
-- Add columns to household_members for notification preferences

ALTER TABLE household_members
  ADD COLUMN IF NOT EXISTS notify_pickup_assigned BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_meal_changed BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_task_added BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_event_affects_me BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT false;

-- Comment for documentation
COMMENT ON COLUMN household_members.notify_pickup_assigned IS 'Send push when a pickup is assigned to this member';
COMMENT ON COLUMN household_members.notify_meal_changed IS 'Send push when a meal is added/changed for today or tomorrow';
COMMENT ON COLUMN household_members.notify_task_added IS 'Send push when a task is added for their assigned children';
COMMENT ON COLUMN household_members.notify_event_affects_me IS 'Send push when an event is added that affects this member';
COMMENT ON COLUMN household_members.notifications_enabled IS 'Master toggle for all notifications';

-- ============================================================================
-- Helper function to get push subscriptions for household members
-- ============================================================================
-- Used by the notification API to find who to notify

CREATE OR REPLACE FUNCTION get_household_push_subscriptions(p_household_id UUID)
RETURNS TABLE (
  user_id UUID,
  member_id UUID,
  member_name TEXT,
  endpoint TEXT,
  p256dh_key TEXT,
  auth_key TEXT,
  notify_pickup_assigned BOOLEAN,
  notify_meal_changed BOOLEAN,
  notify_task_added BOOLEAN,
  notify_event_affects_me BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ps.user_id,
    hm.id AS member_id,
    hm.name AS member_name,
    ps.endpoint,
    ps.p256dh_key,
    ps.auth_key,
    hm.notify_pickup_assigned,
    hm.notify_meal_changed,
    hm.notify_task_added,
    hm.notify_event_affects_me
  FROM push_subscriptions ps
  JOIN household_members hm ON hm.user_id = ps.user_id
  WHERE hm.household_id = p_household_id
    AND hm.notifications_enabled = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_household_push_subscriptions(UUID) TO authenticated;

COMMENT ON FUNCTION get_household_push_subscriptions(UUID) IS
'Returns push subscriptions for all members of a household who have notifications enabled.
Used by the notification API to determine who to send push notifications to.';
