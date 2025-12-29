-- Fix function search_path security warnings
-- Setting search_path = 'public' prevents potential hijacking attacks
-- See: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

-- Core helper functions
ALTER FUNCTION public.is_admin() SET search_path = 'public';
ALTER FUNCTION public.is_household_admin() SET search_path = 'public';
ALTER FUNCTION public.get_user_household_id() SET search_path = 'public';
ALTER FUNCTION public.get_admin_household_id() SET search_path = 'public';

-- Audit functions
ALTER FUNCTION public.set_updated_at() SET search_path = 'public';
ALTER FUNCTION public.set_updated_by() SET search_path = 'public';
ALTER FUNCTION public.set_audit_columns() SET search_path = 'public';
ALTER FUNCTION public.audit_trigger_func() SET search_path = 'public';
ALTER FUNCTION public.audit_households_func() SET search_path = 'public';
ALTER FUNCTION public.compute_jsonb_changes(jsonb, jsonb) SET search_path = 'public';

-- Calendar functions
ALTER FUNCTION public.get_connected_calendar_email() SET search_path = 'public';
ALTER FUNCTION public.upsert_calendar_token(text, text, text, text, bigint) SET search_path = 'public';
ALTER FUNCTION public.get_household_calendar_tokens() SET search_path = 'public';

-- Encryption functions
ALTER FUNCTION public.get_encryption_key() SET search_path = 'public';
ALTER FUNCTION public.encrypt_token(text) SET search_path = 'public';
ALTER FUNCTION public.decrypt_token(text) SET search_path = 'public';

-- Integration functions
ALTER FUNCTION public.upsert_external_integration(uuid, text, text, json, text) SET search_path = 'public';
ALTER FUNCTION public.get_integration_credentials(uuid) SET search_path = 'public';
ALTER FUNCTION public.get_household_integrations() SET search_path = 'public';
ALTER FUNCTION public.get_integration_mappings(uuid) SET search_path = 'public';
ALTER FUNCTION public.update_integration_sync_status(uuid, text, text) SET search_path = 'public';

-- AI suggestions functions
ALTER FUNCTION public.get_pending_suggestions_count() SET search_path = 'public';
ALTER FUNCTION public.accept_suggestion(uuid, text, date, time, uuid, text) SET search_path = 'public';
ALTER FUNCTION public.dismiss_suggestion(uuid) SET search_path = 'public';

-- Photo functions
ALTER FUNCTION public.get_recent_photos(integer, integer) SET search_path = 'public';
ALTER FUNCTION public.cleanup_expired_photos() SET search_path = 'public';

-- Push notification functions
ALTER FUNCTION public.get_household_push_subscriptions(uuid) SET search_path = 'public';

-- Wishlist functions
ALTER FUNCTION public.user_has_wishlist_access(uuid) SET search_path = 'public';

-- Household functions
ALTER FUNCTION public.create_household_with_admin(text, text, text, date, text) SET search_path = 'public';
ALTER FUNCTION public.claim_invite_for_current_user() SET search_path = 'public';
