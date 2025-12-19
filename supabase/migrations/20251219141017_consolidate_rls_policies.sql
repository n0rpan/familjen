-- ============================================
-- RLS Policy Consolidation for Performance
-- ============================================
-- Addresses Supabase linter warnings:
-- - auth_rls_initplan: wrap auth.jwt() in (select ...)
-- - multiple_permissive_policies: consolidate duplicates
--
-- Trade-offs documented:
-- - is_admin() uses JWT claims (fast, but 1hr revocation delay)
-- - LOWER(email) comparison kept (small table, no index needed)
-- - EXISTS pattern for transitive access (planner-friendly)
--
-- IMPORTANT: Take a database snapshot before running this migration!
-- ============================================

BEGIN;

-- ============================================
-- 1. allowed_emails
-- ============================================
DROP POLICY IF EXISTS "View allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Insert allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Update allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Delete allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Admin manages allowed_emails" ON allowed_emails;
DROP POLICY IF EXISTS "allowed_emails_select" ON allowed_emails;
DROP POLICY IF EXISTS "allowed_emails_insert" ON allowed_emails;
DROP POLICY IF EXISTS "allowed_emails_update" ON allowed_emails;
DROP POLICY IF EXISTS "allowed_emails_delete" ON allowed_emails;

CREATE POLICY "allowed_emails_select" ON allowed_emails FOR SELECT TO authenticated
USING (
  is_admin()
  OR invited_by_household_id = (select get_user_household_id())
  OR LOWER(email) = (SELECT LOWER(auth.jwt() ->> 'email'))
);

CREATE POLICY "allowed_emails_insert" ON allowed_emails FOR INSERT TO authenticated
WITH CHECK (
  is_admin()
  OR (is_household_admin() AND invited_by_household_id = (select get_user_household_id()))
);

CREATE POLICY "allowed_emails_update" ON allowed_emails FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "allowed_emails_delete" ON allowed_emails FOR DELETE TO authenticated
USING (
  is_admin()
  OR (is_household_admin() AND invited_by_household_id = (select get_user_household_id()))
);

-- ============================================
-- 2. app_settings (tightened safe keys)
-- ============================================
DROP POLICY IF EXISTS "Admins can manage settings" ON app_settings;
DROP POLICY IF EXISTS "Users can read safe settings" ON app_settings;
DROP POLICY IF EXISTS "Users can view settings" ON app_settings;
DROP POLICY IF EXISTS "app_settings_select" ON app_settings;
DROP POLICY IF EXISTS "app_settings_insert" ON app_settings;
DROP POLICY IF EXISTS "app_settings_update" ON app_settings;
DROP POLICY IF EXISTS "app_settings_delete" ON app_settings;

CREATE POLICY "app_settings_select" ON app_settings FOR SELECT TO authenticated
USING (
  key IN ('openrouter_model')
  OR is_admin()
);

CREATE POLICY "app_settings_insert" ON app_settings FOR INSERT TO authenticated
WITH CHECK (is_admin());

CREATE POLICY "app_settings_update" ON app_settings FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "app_settings_delete" ON app_settings FOR DELETE TO authenticated
USING (is_admin());

-- ============================================
-- 3. audit_log
-- ============================================
DROP POLICY IF EXISTS "Users can view own household audit log" ON audit_log;
DROP POLICY IF EXISTS "Admins can view all audit logs" ON audit_log;
DROP POLICY IF EXISTS "audit_log_select" ON audit_log;

CREATE POLICY "audit_log_select" ON audit_log FOR SELECT TO authenticated
USING (
  household_id = (select get_user_household_id())
  OR is_admin()
);

-- ============================================
-- 4. calendar_events (admin can manage holidays)
-- ============================================
DROP POLICY IF EXISTS "Users can view calendar events" ON calendar_events;
DROP POLICY IF EXISTS "Users can view own household events and system holidays" ON calendar_events;
DROP POLICY IF EXISTS "Admin can view all calendar events" ON calendar_events;
DROP POLICY IF EXISTS "Users can create events in own household" ON calendar_events;
DROP POLICY IF EXISTS "Users can update own household events" ON calendar_events;
DROP POLICY IF EXISTS "Users can delete own household events" ON calendar_events;
DROP POLICY IF EXISTS "Users can manage calendar events" ON calendar_events;
DROP POLICY IF EXISTS "calendar_events_select" ON calendar_events;
DROP POLICY IF EXISTS "calendar_events_insert" ON calendar_events;
DROP POLICY IF EXISTS "calendar_events_update" ON calendar_events;
DROP POLICY IF EXISTS "calendar_events_delete" ON calendar_events;

CREATE POLICY "calendar_events_select" ON calendar_events FOR SELECT TO authenticated
USING (
  household_id IS NULL
  OR household_id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "calendar_events_insert" ON calendar_events FOR INSERT TO authenticated
WITH CHECK (
  household_id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "calendar_events_update" ON calendar_events FOR UPDATE TO authenticated
USING (
  household_id = (select get_user_household_id())
  OR is_admin()
)
WITH CHECK (
  household_id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "calendar_events_delete" ON calendar_events FOR DELETE TO authenticated
USING (
  household_id = (select get_user_household_id())
  OR is_admin()
);

-- ============================================
-- 5. child_tasks
-- ============================================
DROP POLICY IF EXISTS "Users can view child tasks" ON child_tasks;
DROP POLICY IF EXISTS "Users can manage child tasks" ON child_tasks;
DROP POLICY IF EXISTS "Users can view own household tasks" ON child_tasks;
DROP POLICY IF EXISTS "Users can create tasks in own household" ON child_tasks;
DROP POLICY IF EXISTS "Users can update own household tasks" ON child_tasks;
DROP POLICY IF EXISTS "Users can delete own household tasks" ON child_tasks;
DROP POLICY IF EXISTS "child_tasks_select" ON child_tasks;
DROP POLICY IF EXISTS "child_tasks_insert" ON child_tasks;
DROP POLICY IF EXISTS "child_tasks_update" ON child_tasks;
DROP POLICY IF EXISTS "child_tasks_delete" ON child_tasks;

CREATE POLICY "child_tasks_select" ON child_tasks FOR SELECT TO authenticated
USING (household_id = (select get_user_household_id()));

CREATE POLICY "child_tasks_insert" ON child_tasks FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "child_tasks_update" ON child_tasks FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "child_tasks_delete" ON child_tasks FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

-- ============================================
-- 6. children
-- ============================================
DROP POLICY IF EXISTS "Users can view children" ON children;
DROP POLICY IF EXISTS "Admins can view all children" ON children;
DROP POLICY IF EXISTS "Users can insert children" ON children;
DROP POLICY IF EXISTS "Users can update children" ON children;
DROP POLICY IF EXISTS "Users can delete children" ON children;
DROP POLICY IF EXISTS "Users can manage children" ON children;
DROP POLICY IF EXISTS "children_select" ON children;
DROP POLICY IF EXISTS "children_insert" ON children;
DROP POLICY IF EXISTS "children_update" ON children;
DROP POLICY IF EXISTS "children_delete" ON children;

CREATE POLICY "children_select" ON children FOR SELECT TO authenticated
USING (
  household_id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "children_insert" ON children FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "children_update" ON children FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "children_delete" ON children FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

-- ============================================
-- 7. external_integration_children (already uses EXISTS)
-- ============================================
DROP POLICY IF EXISTS "Users can view own household integration children" ON external_integration_children;
DROP POLICY IF EXISTS "Users can manage own household integration children" ON external_integration_children;
DROP POLICY IF EXISTS "external_integration_children_select" ON external_integration_children;
DROP POLICY IF EXISTS "external_integration_children_insert" ON external_integration_children;
DROP POLICY IF EXISTS "external_integration_children_update" ON external_integration_children;
DROP POLICY IF EXISTS "external_integration_children_delete" ON external_integration_children;

CREATE POLICY "external_integration_children_select" ON external_integration_children FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM external_integrations ei
    WHERE ei.id = external_integration_children.integration_id
    AND ei.household_id = (select get_user_household_id())
  )
);

CREATE POLICY "external_integration_children_insert" ON external_integration_children FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM external_integrations ei
    WHERE ei.id = integration_id
    AND ei.household_id = (select get_user_household_id())
  )
);

CREATE POLICY "external_integration_children_update" ON external_integration_children FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM external_integrations ei
    WHERE ei.id = external_integration_children.integration_id
    AND ei.household_id = (select get_user_household_id())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM external_integrations ei
    WHERE ei.id = integration_id
    AND ei.household_id = (select get_user_household_id())
  )
);

CREATE POLICY "external_integration_children_delete" ON external_integration_children FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM external_integrations ei
    WHERE ei.id = external_integration_children.integration_id
    AND ei.household_id = (select get_user_household_id())
  )
);

-- ============================================
-- 8. google_calendar_tokens (admin-only)
-- ============================================
DROP POLICY IF EXISTS "Admins can manage calendar tokens" ON google_calendar_tokens;
DROP POLICY IF EXISTS "Only admins can view tokens" ON google_calendar_tokens;
DROP POLICY IF EXISTS "Only admins can insert tokens" ON google_calendar_tokens;
DROP POLICY IF EXISTS "Only admins can update tokens" ON google_calendar_tokens;
DROP POLICY IF EXISTS "Only admins can delete tokens" ON google_calendar_tokens;
DROP POLICY IF EXISTS "google_calendar_tokens_admin" ON google_calendar_tokens;

CREATE POLICY "google_calendar_tokens_admin" ON google_calendar_tokens FOR ALL TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- ============================================
-- 9. household_members
-- ============================================
DROP POLICY IF EXISTS "Users can view household members" ON household_members;
DROP POLICY IF EXISTS "Admins can view all household members" ON household_members;
DROP POLICY IF EXISTS "Users can insert household members" ON household_members;
DROP POLICY IF EXISTS "Users can update household member" ON household_members;
DROP POLICY IF EXISTS "Users can update household members" ON household_members;
DROP POLICY IF EXISTS "Admins can update all household members" ON household_members;
DROP POLICY IF EXISTS "Users can delete household members" ON household_members;
DROP POLICY IF EXISTS "household_members_select" ON household_members;
DROP POLICY IF EXISTS "household_members_insert" ON household_members;
DROP POLICY IF EXISTS "household_members_update" ON household_members;
DROP POLICY IF EXISTS "household_members_delete" ON household_members;

CREATE POLICY "household_members_select" ON household_members FOR SELECT TO authenticated
USING (
  household_id = (select get_user_household_id())
  OR user_id = (select auth.uid())
  OR is_admin()
);

CREATE POLICY "household_members_insert" ON household_members FOR INSERT TO authenticated
WITH CHECK (
  household_id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "household_members_update" ON household_members FOR UPDATE TO authenticated
USING (
  user_id = (select auth.uid())
  OR (is_household_admin() AND household_id = (select get_user_household_id()))
  OR is_admin()
)
WITH CHECK (
  user_id = (select auth.uid())
  OR (is_household_admin() AND household_id = (select get_user_household_id()))
  OR is_admin()
);

CREATE POLICY "household_members_delete" ON household_members FOR DELETE TO authenticated
USING (
  (is_household_admin() AND household_id = (select get_user_household_id()) AND user_id != (select auth.uid()))
  OR is_admin()
);

-- ============================================
-- 10. household_reminders
-- ============================================
DROP POLICY IF EXISTS "Users can view own household reminders" ON household_reminders;
DROP POLICY IF EXISTS "Admins can view all household reminders" ON household_reminders;
DROP POLICY IF EXISTS "Users can create reminders in own household" ON household_reminders;
DROP POLICY IF EXISTS "Users can update own household reminders" ON household_reminders;
DROP POLICY IF EXISTS "Users can delete own household reminders" ON household_reminders;
DROP POLICY IF EXISTS "household_reminders_select" ON household_reminders;
DROP POLICY IF EXISTS "household_reminders_insert" ON household_reminders;
DROP POLICY IF EXISTS "household_reminders_update" ON household_reminders;
DROP POLICY IF EXISTS "household_reminders_delete" ON household_reminders;

CREATE POLICY "household_reminders_select" ON household_reminders FOR SELECT TO authenticated
USING (
  household_id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "household_reminders_insert" ON household_reminders FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "household_reminders_update" ON household_reminders FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "household_reminders_delete" ON household_reminders FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

-- ============================================
-- 11. households (keep first-household INSERT path)
-- ============================================
DROP POLICY IF EXISTS "Users can view own household" ON households;
DROP POLICY IF EXISTS "Admins can view all households" ON households;
DROP POLICY IF EXISTS "Users can create household" ON households;
DROP POLICY IF EXISTS "Users can update own household" ON households;
DROP POLICY IF EXISTS "Users can update household" ON households;
DROP POLICY IF EXISTS "Users can delete own household" ON households;
DROP POLICY IF EXISTS "households_select" ON households;
DROP POLICY IF EXISTS "households_insert" ON households;
DROP POLICY IF EXISTS "households_update" ON households;
DROP POLICY IF EXISTS "households_delete" ON households;

CREATE POLICY "households_select" ON households FOR SELECT TO authenticated
USING (
  id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "households_insert" ON households FOR INSERT TO authenticated
WITH CHECK (
  (select get_user_household_id()) IS NULL
  OR is_admin()
);

CREATE POLICY "households_update" ON households FOR UPDATE TO authenticated
USING (
  id = (select get_user_household_id())
  OR is_admin()
)
WITH CHECK (
  id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "households_delete" ON households FOR DELETE TO authenticated
USING (
  (is_household_admin() AND id = (select get_user_household_id()))
  OR is_admin()
);

-- ============================================
-- 12. meals
-- ============================================
DROP POLICY IF EXISTS "Users can view meals" ON meals;
DROP POLICY IF EXISTS "Users can insert meals" ON meals;
DROP POLICY IF EXISTS "Users can update meals" ON meals;
DROP POLICY IF EXISTS "Users can delete meals" ON meals;
DROP POLICY IF EXISTS "Users can manage meals" ON meals;
DROP POLICY IF EXISTS "meals_select" ON meals;
DROP POLICY IF EXISTS "meals_insert" ON meals;
DROP POLICY IF EXISTS "meals_update" ON meals;
DROP POLICY IF EXISTS "meals_delete" ON meals;

CREATE POLICY "meals_select" ON meals FOR SELECT TO authenticated
USING (household_id = (select get_user_household_id()));

CREATE POLICY "meals_insert" ON meals FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "meals_update" ON meals FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "meals_delete" ON meals FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

-- ============================================
-- 13. member_events
-- ============================================
DROP POLICY IF EXISTS "Users can view member events" ON member_events;
DROP POLICY IF EXISTS "View member events" ON member_events;
DROP POLICY IF EXISTS "Create member events" ON member_events;
DROP POLICY IF EXISTS "Update member events" ON member_events;
DROP POLICY IF EXISTS "Delete member events" ON member_events;
DROP POLICY IF EXISTS "Users can manage member events" ON member_events;
DROP POLICY IF EXISTS "member_events_select" ON member_events;
DROP POLICY IF EXISTS "member_events_insert" ON member_events;
DROP POLICY IF EXISTS "member_events_update" ON member_events;
DROP POLICY IF EXISTS "member_events_delete" ON member_events;

CREATE POLICY "member_events_select" ON member_events FOR SELECT TO authenticated
USING (household_id = (select get_user_household_id()));

CREATE POLICY "member_events_insert" ON member_events FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "member_events_update" ON member_events FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "member_events_delete" ON member_events FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

-- ============================================
-- 14. pickups
-- ============================================
DROP POLICY IF EXISTS "Users can view pickups" ON pickups;
DROP POLICY IF EXISTS "Users can insert pickups" ON pickups;
DROP POLICY IF EXISTS "Users can update pickups" ON pickups;
DROP POLICY IF EXISTS "Users can delete pickups" ON pickups;
DROP POLICY IF EXISTS "Users can manage pickups" ON pickups;
DROP POLICY IF EXISTS "pickups_select" ON pickups;
DROP POLICY IF EXISTS "pickups_insert" ON pickups;
DROP POLICY IF EXISTS "pickups_update" ON pickups;
DROP POLICY IF EXISTS "pickups_delete" ON pickups;

CREATE POLICY "pickups_select" ON pickups FOR SELECT TO authenticated
USING (household_id = (select get_user_household_id()));

CREATE POLICY "pickups_insert" ON pickups FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "pickups_update" ON pickups FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "pickups_delete" ON pickups FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

-- ============================================
-- 15. recipes
-- ============================================
DROP POLICY IF EXISTS "Users can view recipes" ON recipes;
DROP POLICY IF EXISTS "Users can insert recipes" ON recipes;
DROP POLICY IF EXISTS "Users can update recipes" ON recipes;
DROP POLICY IF EXISTS "Users can delete recipes" ON recipes;
DROP POLICY IF EXISTS "Users can manage recipes" ON recipes;
DROP POLICY IF EXISTS "recipes_select" ON recipes;
DROP POLICY IF EXISTS "recipes_insert" ON recipes;
DROP POLICY IF EXISTS "recipes_update" ON recipes;
DROP POLICY IF EXISTS "recipes_delete" ON recipes;

CREATE POLICY "recipes_select" ON recipes FOR SELECT TO authenticated
USING (household_id = (select get_user_household_id()));

CREATE POLICY "recipes_insert" ON recipes FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "recipes_update" ON recipes FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "recipes_delete" ON recipes FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

-- ============================================
-- 16. shopping_list (legacy table - kept for compatibility)
-- ============================================
DROP POLICY IF EXISTS "Users can view shopping list" ON shopping_list;
DROP POLICY IF EXISTS "Users can manage shopping list" ON shopping_list;
DROP POLICY IF EXISTS "shopping_list_select" ON shopping_list;
DROP POLICY IF EXISTS "shopping_list_insert" ON shopping_list;
DROP POLICY IF EXISTS "shopping_list_update" ON shopping_list;
DROP POLICY IF EXISTS "shopping_list_delete" ON shopping_list;

CREATE POLICY "shopping_list_select" ON shopping_list FOR SELECT TO authenticated
USING (household_id = (select get_user_household_id()));

CREATE POLICY "shopping_list_insert" ON shopping_list FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "shopping_list_update" ON shopping_list FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "shopping_list_delete" ON shopping_list FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

-- ============================================
-- 17. shopping_list_items (converted to EXISTS pattern)
-- ============================================
DROP POLICY IF EXISTS "Users can view shopping list items" ON shopping_list_items;
DROP POLICY IF EXISTS "Admin can view all shopping list items" ON shopping_list_items;
DROP POLICY IF EXISTS "Users can create shopping list items" ON shopping_list_items;
DROP POLICY IF EXISTS "Users can update shopping list items" ON shopping_list_items;
DROP POLICY IF EXISTS "Users can delete shopping list items" ON shopping_list_items;
DROP POLICY IF EXISTS "shopping_list_items_select" ON shopping_list_items;
DROP POLICY IF EXISTS "shopping_list_items_insert" ON shopping_list_items;
DROP POLICY IF EXISTS "shopping_list_items_update" ON shopping_list_items;
DROP POLICY IF EXISTS "shopping_list_items_delete" ON shopping_list_items;

CREATE POLICY "shopping_list_items_select" ON shopping_list_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM shopping_lists sl
    WHERE sl.id = shopping_list_items.list_id
    AND sl.household_id = (select get_user_household_id())
  )
  OR is_admin()
);

CREATE POLICY "shopping_list_items_insert" ON shopping_list_items FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM shopping_lists sl
    WHERE sl.id = list_id
    AND sl.household_id = (select get_user_household_id())
  )
);

CREATE POLICY "shopping_list_items_update" ON shopping_list_items FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM shopping_lists sl
    WHERE sl.id = shopping_list_items.list_id
    AND sl.household_id = (select get_user_household_id())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM shopping_lists sl
    WHERE sl.id = list_id
    AND sl.household_id = (select get_user_household_id())
  )
);

CREATE POLICY "shopping_list_items_delete" ON shopping_list_items FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM shopping_lists sl
    WHERE sl.id = shopping_list_items.list_id
    AND sl.household_id = (select get_user_household_id())
  )
);

-- ============================================
-- 18. shopping_lists
-- ============================================
DROP POLICY IF EXISTS "Users can view own household shopping lists" ON shopping_lists;
DROP POLICY IF EXISTS "Admin can view all shopping lists" ON shopping_lists;
DROP POLICY IF EXISTS "Users can create shopping lists in own household" ON shopping_lists;
DROP POLICY IF EXISTS "Users can update own household shopping lists" ON shopping_lists;
DROP POLICY IF EXISTS "Users can delete own household shopping lists" ON shopping_lists;
DROP POLICY IF EXISTS "shopping_lists_select" ON shopping_lists;
DROP POLICY IF EXISTS "shopping_lists_insert" ON shopping_lists;
DROP POLICY IF EXISTS "shopping_lists_update" ON shopping_lists;
DROP POLICY IF EXISTS "shopping_lists_delete" ON shopping_lists;

CREATE POLICY "shopping_lists_select" ON shopping_lists FOR SELECT TO authenticated
USING (
  household_id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "shopping_lists_insert" ON shopping_lists FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "shopping_lists_update" ON shopping_lists FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "shopping_lists_delete" ON shopping_lists FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

-- ============================================
-- 19. week_contexts
-- ============================================
DROP POLICY IF EXISTS "Users can view week contexts" ON week_contexts;
DROP POLICY IF EXISTS "Users can view own household week contexts" ON week_contexts;
DROP POLICY IF EXISTS "Admin can view all week contexts" ON week_contexts;
DROP POLICY IF EXISTS "Users can manage week contexts" ON week_contexts;
DROP POLICY IF EXISTS "Users can manage own household week contexts" ON week_contexts;
DROP POLICY IF EXISTS "week_contexts_select" ON week_contexts;
DROP POLICY IF EXISTS "week_contexts_insert" ON week_contexts;
DROP POLICY IF EXISTS "week_contexts_update" ON week_contexts;
DROP POLICY IF EXISTS "week_contexts_delete" ON week_contexts;

CREATE POLICY "week_contexts_select" ON week_contexts FOR SELECT TO authenticated
USING (
  household_id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "week_contexts_insert" ON week_contexts FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "week_contexts_update" ON week_contexts FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "week_contexts_delete" ON week_contexts FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

-- ============================================
-- 20. wishlist_items
-- ============================================
DROP POLICY IF EXISTS "Users can view wishlist items in own household" ON wishlist_items;
DROP POLICY IF EXISTS "Admins can view all wishlist items" ON wishlist_items;
DROP POLICY IF EXISTS "Users can create wishlist items in own household" ON wishlist_items;
DROP POLICY IF EXISTS "Users can update wishlist items in own household" ON wishlist_items;
DROP POLICY IF EXISTS "Users can delete wishlist items in own household" ON wishlist_items;
DROP POLICY IF EXISTS "wishlist_items_select" ON wishlist_items;
DROP POLICY IF EXISTS "wishlist_items_insert" ON wishlist_items;
DROP POLICY IF EXISTS "wishlist_items_update" ON wishlist_items;
DROP POLICY IF EXISTS "wishlist_items_delete" ON wishlist_items;

CREATE POLICY "wishlist_items_select" ON wishlist_items FOR SELECT TO authenticated
USING (
  user_has_wishlist_access(wishlist_id)
  OR is_admin()
);

CREATE POLICY "wishlist_items_insert" ON wishlist_items FOR INSERT TO authenticated
WITH CHECK (user_has_wishlist_access(wishlist_id));

CREATE POLICY "wishlist_items_update" ON wishlist_items FOR UPDATE TO authenticated
USING (user_has_wishlist_access(wishlist_id))
WITH CHECK (user_has_wishlist_access(wishlist_id));

CREATE POLICY "wishlist_items_delete" ON wishlist_items FOR DELETE TO authenticated
USING (user_has_wishlist_access(wishlist_id));

-- ============================================
-- 21. wishlists
-- ============================================
DROP POLICY IF EXISTS "Users can view own household wishlists" ON wishlists;
DROP POLICY IF EXISTS "Admins can view all wishlists" ON wishlists;
DROP POLICY IF EXISTS "Users can create wishlists in own household" ON wishlists;
DROP POLICY IF EXISTS "Users can update own household wishlists" ON wishlists;
DROP POLICY IF EXISTS "Users can delete own household wishlists" ON wishlists;
DROP POLICY IF EXISTS "wishlists_select" ON wishlists;
DROP POLICY IF EXISTS "wishlists_insert" ON wishlists;
DROP POLICY IF EXISTS "wishlists_update" ON wishlists;
DROP POLICY IF EXISTS "wishlists_delete" ON wishlists;

CREATE POLICY "wishlists_select" ON wishlists FOR SELECT TO authenticated
USING (
  household_id = (select get_user_household_id())
  OR is_admin()
);

CREATE POLICY "wishlists_insert" ON wishlists FOR INSERT TO authenticated
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "wishlists_update" ON wishlists FOR UPDATE TO authenticated
USING (household_id = (select get_user_household_id()))
WITH CHECK (household_id = (select get_user_household_id()));

CREATE POLICY "wishlists_delete" ON wishlists FOR DELETE TO authenticated
USING (household_id = (select get_user_household_id()));

COMMIT;
