# Fix Plan: Weekday-Only Pickup Reminders & Holiday Display

## Issue Summary

### Issue 1: "Missing pickup" on weekends
- **Location:** `TodayOverview.tsx:122`, `WeekGrid.tsx:284-288`
- **Problem:** Shows "Ingen henter" (no pickup assigned) on weekends when families don't need pickups
- **Current behavior:** No weekend/holiday filtering at all

### Issue 2: Norwegian holidays not displayed
- **Database:** `calendar_events` table exists with Norwegian holidays (2025-2027)
- **Used in:** Only AI meal suggestions (`/api/openrouter/suggest/route.ts`)
- **Missing from:** Home page (`/`) and Week page (`/uke`)
- **Problem:** Holidays are stored but never shown to users

---

## Research Findings

### Holiday Data Structure
```sql
-- From migration 20251216105201_phase1_features.sql
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY,
  household_id UUID,  -- NULL for system-wide holidays
  date DATE NOT NULL,
  name TEXT NOT NULL,
  event_type TEXT DEFAULT 'holiday',  -- 'holiday', 'birthday', 'family'
  is_annual BOOLEAN DEFAULT true
);

-- Sample data
INSERT INTO calendar_events VALUES
  (NULL, '2025-01-01', 'Første nyttårsdag', 'holiday', true),
  (NULL, '2025-05-17', 'Grunnlovsdag', 'holiday', true),
  -- Easter dates (moveable) for 2025, 2026, 2027...
```

### Existing Utilities
```typescript
// src/lib/utils.ts
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}
```

---

## Fix Plan

### Phase 1: Weekday-Only Pickup Reminders (Quick Fix)

**Files to modify:**
1. `src/components/TodayOverview.tsx`
2. `src/components/WeekGrid.tsx`

**Changes:**

1. **TodayOverview.tsx** - Skip "Ingen henter" on weekends
```typescript
// Import isWeekend
import { formatDateLocalized, isWeekend } from '@/lib/utils'

// In the pickup display (around line 122):
const today = new Date()
const isWeekendDay = isWeekend(today)

// Only show "no pickup" warning on weekdays
{pickup.picker
  ? t.home.picksUp.replace('{name}', pickup.picker.name)
  : (isWeekendDay ? null : t.week.noPickup)}
```

2. **WeekGrid.tsx** - Visual indicator for weekends (optional dimming)
```typescript
// Check if date is weekend
const isWeekendDay = isWeekend(new Date(dateStr))

// Style differently or hide pickup row for weekends
```

**Effort:** 1-2 hours

---

### Phase 2: Holiday Display

**Files to modify:**
1. `src/app/page.tsx` - Fetch holidays
2. `src/app/uke/page.tsx` - Fetch holidays
3. `src/components/TodayOverview.tsx` - Accept holidays prop
4. `src/components/WeekGrid.tsx` - Show holiday indicator
5. `src/lib/utils.ts` - Add `isHoliday()` helper

**Changes:**

1. **Add holiday helper function** (`src/lib/utils.ts`):
```typescript
export function isHoliday(date: Date, holidays: { date: string }[]): boolean {
  const dateStr = formatDateISO(date)
  return holidays.some(h => h.date === dateStr)
}

export function getHolidayName(date: Date, holidays: { date: string; name: string }[]): string | null {
  const dateStr = formatDateISO(date)
  const holiday = holidays.find(h => h.date === dateStr)
  return holiday?.name || null
}
```

2. **Fetch holidays on home page** (`src/app/page.tsx`):
```typescript
// Add to the Promise.all query:
supabase
  .from('calendar_events')
  .select('date, name')
  .or('household_id.is.null,household_id.eq.' + myMembership.household_id)
  .gte('date', weekStartStr)
  .lte('date', weekEndStr)
  .eq('event_type', 'holiday')
```

3. **Fetch holidays on week page** (`src/app/uke/page.tsx`):
```typescript
// Same query as above
```

4. **Pass holidays to components:**
```typescript
<TodayOverview summary={todaySummary} holidays={holidays} />
<WeekGrid holidays={holidays} ... />
```

5. **Display holidays in WeekGrid:**
```typescript
// In the day column header, show holiday name
{holidayName && (
  <span className="text-xs" style={{ color: 'var(--color-coral)' }}>
    🎉 {holidayName}
  </span>
)}

// Dim/skip pickup for holidays
const isHolidayOrWeekend = isWeekend(date) || isHoliday(date, holidays)
```

6. **Skip "missing pickup" on holidays** (`TodayOverview.tsx`):
```typescript
const isHolidayOrWeekend = isWeekend(today) || isHoliday(today, holidays)

{pickup.picker
  ? t.home.picksUp.replace('{name}', pickup.picker.name)
  : (isHolidayOrWeekend ? null : t.week.noPickup)}
```

**Effort:** 3-4 hours

---

### Phase 3: Enhanced Holiday UX (Optional)

**Ideas:**
- Show holiday banner on home page
- Special styling for holiday days in WeekGrid
- Option to mark custom family holidays
- Birthday auto-generation from member/child birth_date

**Effort:** 4-6 hours

---

## Implementation Priority

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| 1 | Skip "missing pickup" on weekends | 1 hour | High |
| 2 | Fetch and pass holidays to pages | 1 hour | Medium |
| 3 | Display holiday names in WeekGrid | 1 hour | Medium |
| 4 | Skip "missing pickup" on holidays | 30 min | High |
| 5 | Holiday banner on home page | 1 hour | Low |

---

## Testing Checklist

- [ ] Saturday/Sunday don't show "Ingen henter" warning
- [ ] Holidays show their name in WeekGrid
- [ ] Holiday dates don't show "Ingen henter" warning
- [ ] AI meal suggestions still receive holiday context
- [ ] Birthday events display correctly (if implemented)
