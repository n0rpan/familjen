-- Add composite indexes for common queries
-- These indexes improve performance for queries that filter by household_id and date

-- Pickups: frequently queried by household + date range
CREATE INDEX IF NOT EXISTS idx_pickups_household_date
ON pickups(household_id, date);

-- Meals: frequently queried by household + date range
CREATE INDEX IF NOT EXISTS idx_meals_household_date
ON meals(household_id, date);

-- Child tasks: frequently queried by household + date range
CREATE INDEX IF NOT EXISTS idx_child_tasks_household_date
ON child_tasks(household_id, date);

-- Member events: frequently queried by household + date range
CREATE INDEX IF NOT EXISTS idx_member_events_household_date
ON member_events(household_id, date);

-- Household events: frequently queried by household + event_date range
CREATE INDEX IF NOT EXISTS idx_household_events_household_date
ON household_events(household_id, event_date);

-- External events: frequently queried by integration + event_date
CREATE INDEX IF NOT EXISTS idx_external_events_integration_date
ON external_events(integration_id, event_date);

-- External messages: frequently queried by integration + is_processed
CREATE INDEX IF NOT EXISTS idx_external_messages_integration_processed
ON external_messages(integration_id, is_processed);

-- Shopping list items: frequently queried by list + is_bought
CREATE INDEX IF NOT EXISTS idx_shopping_items_list_bought
ON shopping_list_items(list_id, is_bought);
