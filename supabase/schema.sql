-- Familjen Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Households table (for multi-family support)
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  ical_calendar_url TEXT,
  ical_username TEXT,
  ical_password_encrypted TEXT,
  openrouter_api_key_encrypted TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Household members who can pick up kids
CREATE TABLE household_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_name TEXT,
  is_parent BOOLEAN DEFAULT false,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Children
CREATE TABLE children (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_name TEXT,
  location_type TEXT CHECK (location_type IN ('school', 'kindergarten')),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pickup assignments
CREATE TABLE pickups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  picker_id UUID REFERENCES household_members(id) ON DELETE SET NULL,
  notes TEXT,
  synced_to_calendar BOOLEAN DEFAULT false,
  calendar_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(child_id, date)
);

-- Recipes
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ingredients JSONB,
  instructions TEXT,
  external_link TEXT,
  is_quick BOOLEAN DEFAULT false,
  is_kid_friendly BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meal plan
CREATE TABLE meals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
  custom_meal TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, date)
);

-- Indexes for performance
CREATE INDEX idx_pickups_date ON pickups(date);
CREATE INDEX idx_pickups_household_date ON pickups(household_id, date);
CREATE INDEX idx_meals_date ON meals(date);
CREATE INDEX idx_meals_household_date ON meals(household_id, date);
CREATE INDEX idx_household_members_household ON household_members(household_id);
CREATE INDEX idx_children_household ON children(household_id);
CREATE INDEX idx_recipes_household ON recipes(household_id);

-- Row Level Security (RLS)
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickups ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access data from their household
-- First, we need a function to get the user's household
CREATE OR REPLACE FUNCTION get_user_household_id()
RETURNS UUID AS $$
  SELECT household_id FROM household_members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Household policies
CREATE POLICY "Users can view their household"
  ON households FOR SELECT
  USING (id = get_user_household_id());

CREATE POLICY "Users can update their household"
  ON households FOR UPDATE
  USING (id = get_user_household_id());

-- Household members policies
CREATE POLICY "Users can view household members"
  ON household_members FOR SELECT
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert household members"
  ON household_members FOR INSERT
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update household members"
  ON household_members FOR UPDATE
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can delete household members"
  ON household_members FOR DELETE
  USING (household_id = get_user_household_id());

-- Children policies
CREATE POLICY "Users can view children"
  ON children FOR SELECT
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert children"
  ON children FOR INSERT
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update children"
  ON children FOR UPDATE
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can delete children"
  ON children FOR DELETE
  USING (household_id = get_user_household_id());

-- Pickups policies
CREATE POLICY "Users can view pickups"
  ON pickups FOR SELECT
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert pickups"
  ON pickups FOR INSERT
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update pickups"
  ON pickups FOR UPDATE
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can delete pickups"
  ON pickups FOR DELETE
  USING (household_id = get_user_household_id());

-- Recipes policies
CREATE POLICY "Users can view recipes"
  ON recipes FOR SELECT
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert recipes"
  ON recipes FOR INSERT
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update recipes"
  ON recipes FOR UPDATE
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can delete recipes"
  ON recipes FOR DELETE
  USING (household_id = get_user_household_id());

-- Meals policies
CREATE POLICY "Users can view meals"
  ON meals FOR SELECT
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert meals"
  ON meals FOR INSERT
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update meals"
  ON meals FOR UPDATE
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can delete meals"
  ON meals FOR DELETE
  USING (household_id = get_user_household_id());
