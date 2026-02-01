-- ============================================
-- Fix Webhook Failure Count Race Condition
-- ============================================
--
-- Problem: Two concurrent failing requests can both read failure_count = 9,
-- causing race condition in the auto-disable logic.
--
-- Solution: Use FOR UPDATE to lock the row during the read-modify-write cycle.
-- This serializes concurrent updates to the same webhook.
-- ============================================

CREATE OR REPLACE FUNCTION record_webhook_delivery(
  p_webhook_id UUID,
  p_event_type TEXT,
  p_payload JSONB,
  p_status INTEGER DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_delivery_id UUID DEFAULT NULL  -- For idempotency
)
RETURNS UUID AS $$
DECLARE
  v_delivery_id UUID;
  v_current_failure_count INTEGER;
BEGIN
  -- Use provided ID or generate new one
  v_delivery_id := COALESCE(p_delivery_id, gen_random_uuid());

  INSERT INTO webhook_deliveries (
    id, webhook_id, event_type, payload, status, error,
    delivered_at
  )
  VALUES (
    v_delivery_id, p_webhook_id, p_event_type, p_payload, p_status, p_error,
    CASE WHEN p_status IS NOT NULL AND p_status < 400 THEN NOW() ELSE NULL END
  )
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    error = EXCLUDED.error,
    delivered_at = EXCLUDED.delivered_at,
    attempts = webhook_deliveries.attempts + 1;

  -- Get current failure count with row lock to prevent race conditions
  -- FOR UPDATE ensures only one transaction can modify this webhook at a time
  SELECT failure_count INTO v_current_failure_count
  FROM household_webhooks
  WHERE id = p_webhook_id
  FOR UPDATE;

  -- Update webhook stats
  UPDATE household_webhooks
  SET
    last_triggered_at = NOW(),
    last_status = p_status,
    failure_count = CASE
      WHEN p_status IS NULL OR p_status >= 400 THEN failure_count + 1
      ELSE 0  -- Reset on success
    END,
    -- Auto-disable after 10 consecutive failures
    -- Check uses pre-increment value: if currently 9 and this is a failure, disable
    disabled_at = CASE
      WHEN v_current_failure_count >= 9 AND (p_status IS NULL OR p_status >= 400) THEN NOW()
      ELSE disabled_at
    END
  WHERE id = p_webhook_id;

  RETURN v_delivery_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Only service role should use this
REVOKE EXECUTE ON FUNCTION record_webhook_delivery(UUID, TEXT, JSONB, INTEGER, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_webhook_delivery(UUID, TEXT, JSONB, INTEGER, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION record_webhook_delivery(UUID, TEXT, JSONB, INTEGER, TEXT, UUID) FROM authenticated;
