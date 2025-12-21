-- Fix: Handle suggestions without valid target gracefully
-- Instead of raising exception, mark as dismissed when no child/member target
-- Also add p_child_id parameter to allow user override of AI suggestion
-- And map suggested_type to valid child_tasks types

CREATE OR REPLACE FUNCTION accept_household_ics_suggestion(
  p_suggestion_id UUID,
  p_title TEXT DEFAULT NULL,
  p_date DATE DEFAULT NULL,
  p_time TIME DEFAULT NULL,
  p_child_id UUID DEFAULT NULL,
  p_member_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_suggestion external_suggestions%ROWTYPE;
  v_created_id UUID;
  v_household_id UUID;
  v_user_id UUID;
  v_reviewer_id UUID;
  v_event_id UUID;
  v_final_child_id UUID;
  v_final_member_id UUID;
  v_task_type TEXT;
BEGIN
  v_user_id := auth.uid();
  v_household_id := get_user_household_id();

  -- Get reviewer member id
  SELECT id INTO v_reviewer_id FROM household_members WHERE user_id = v_user_id LIMIT 1;

  -- Get the suggestion (must be household_ics type and belong to user's household)
  SELECT * INTO v_suggestion
  FROM external_suggestions
  WHERE id = p_suggestion_id
    AND household_id = v_household_id
    AND source_type = 'household_ics';

  IF v_suggestion.id IS NULL THEN
    RAISE EXCEPTION 'Suggestion not found';
  END IF;

  IF v_suggestion.status != 'pending' THEN
    RAISE EXCEPTION 'Suggestion already processed';
  END IF;

  -- Find the current event (may have been re-synced with new ID)
  IF v_suggestion.source_ics_uid IS NOT NULL THEN
    SELECT id INTO v_event_id
    FROM household_events
    WHERE household_id = v_household_id
      AND ics_uid = v_suggestion.source_ics_uid
    LIMIT 1;
  ELSE
    v_event_id := v_suggestion.source_household_event_id;
  END IF;

  -- Determine final child_id and member_id (user override takes precedence)
  -- If user explicitly selected a child, use that; if they selected a member, child is null
  v_final_child_id := CASE
    WHEN p_member_id IS NOT NULL THEN NULL  -- User chose member, clear child
    ELSE COALESCE(p_child_id, v_suggestion.suggested_child_id)
  END;
  v_final_member_id := COALESCE(p_member_id, v_suggestion.target_member_id);

  -- Map suggested_type to valid child_tasks type
  -- AI uses: 'task', 'event', 'reminder'
  -- child_tasks expects: 'bring', 'appointment', 'reminder', 'activity', 'closure', 'other'
  v_task_type := CASE v_suggestion.suggested_type
    WHEN 'task' THEN 'other'
    WHEN 'event' THEN 'closure'  -- Calendar events like "stengt" are typically closures
    WHEN 'reminder' THEN 'reminder'
    ELSE 'other'
  END;

  -- Create child_task or member_event based on target
  IF v_final_child_id IS NOT NULL THEN
    -- Create child task
    INSERT INTO child_tasks (household_id, child_id, date, time, task_type, title, status, source)
    VALUES (
      v_household_id,
      v_final_child_id,
      COALESCE(p_date, v_suggestion.suggested_date),
      COALESCE(p_time, v_suggestion.suggested_time),
      v_task_type,
      COALESCE(p_title, v_suggestion.suggested_title),
      'open',
      'ai_suggested'
    ) RETURNING id INTO v_created_id;

    UPDATE external_suggestions SET
      status = 'accepted',
      reviewed_by = v_reviewer_id,
      reviewed_at = NOW(),
      created_task_id = v_created_id
    WHERE id = p_suggestion_id;

  ELSIF v_final_member_id IS NOT NULL THEN
    -- Create member event
    INSERT INTO member_events (household_id, member_id, date, title, event_type, source)
    VALUES (
      v_household_id,
      v_final_member_id,
      COALESCE(p_date, v_suggestion.suggested_date),
      COALESCE(p_title, v_suggestion.suggested_title),
      'other',
      'manual'
    ) RETURNING id INTO v_created_id;

    UPDATE external_suggestions SET
      status = 'accepted',
      reviewed_by = v_reviewer_id,
      reviewed_at = NOW()
    WHERE id = p_suggestion_id;
  ELSE
    -- No valid target - mark as dismissed instead of raising exception
    UPDATE external_suggestions SET
      status = 'dismissed',
      reviewed_by = v_reviewer_id,
      reviewed_at = NOW()
    WHERE id = p_suggestion_id;

    RETURN NULL;
  END IF;

  -- Mark source household event as redistributed (if it exists)
  IF v_event_id IS NOT NULL THEN
    UPDATE household_events SET is_redistributed = true
    WHERE id = v_event_id;
  END IF;

  RETURN v_created_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION accept_household_ics_suggestion(UUID, TEXT, DATE, TIME, UUID, UUID) TO authenticated;
