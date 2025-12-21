# AI Feature Gap Analysis

## Current AI Capabilities vs UI

| Feature | UI Can Do | AI Can Do | Gap |
|---------|-----------|-----------|-----|
| **Meals** | Add custom, select recipe, delete | Add custom only | Recipe selection, delete |
| **Pickups** | Assign, change, clear | Assign, change | Clear pickup |
| **Child Tasks** | Add, edit, delete, mark done, notes | Add only | Edit, delete, mark done, notes |
| **Member Events** | Add, edit, delete, select type | Add (type=work) | Edit, delete, event_type selection |
| **Shopping** | Add, mark bought, delete, clear bought | Add to either list | Mark bought, delete |

---

## Gap Closure Plan

### Phase 1: Quick Wins (Low Effort)

**1. Delete operations**
- Add `operation: 'delete'` support to AI
- Prompt patterns: "slett middag fredag", "fjern tannlege oppgave"
- Implementation: Add delete case in `executeAction`
- Effort: **2-3 hours**

**2. Mark task done**
- Pattern: "Storm har tatt med gymtøy" → mark task done
- Implementation: Find task by title/child/date, update `status: 'done'`
- Effort: **2-3 hours**

**3. Event type selection**
- Already have `event_type` in DB
- Update AI prompt to recognize: "jobbtur", "kurs", "middag ute", "annet"
- Effort: **1 hour**

---

### Phase 2: Medium Effort

**4. Recipe selection for meals**
- Need to pass available recipes to AI context
- AI returns `recipe_id` instead of `meal_name`
- Pattern: "lag taco fra oppskrift fredag"
- Complexity: Need to match recipe names, handle ambiguity
- Effort: **4-5 hours**

**5. Edit existing items**
- Pattern: "endre Storm sin tannlege til kl 15"
- Need to find existing record, then update
- Requires: lookup logic, partial updates
- Effort: **5-6 hours**

**6. Shopping - mark bought**
- Pattern: "kjøpt melk", "har handlet brød"
- Find item by name, update `is_bought: true`
- Effort: **3-4 hours**

---

### Phase 3: Higher Complexity

**7. Clear/delete shopping items**
- Pattern: "slett melk fra handlelista"
- Need to find item, delete it
- Effort: **3 hours**

**8. Multi-day events**
- Pattern: "jeg er borte mandag til onsdag"
- AI already supports `end_date`, just need better prompting
- Effort: **1-2 hours**

**9. Notes on tasks**
- Pattern: "Storm tannlege tirsdag kl 10, husk å ta med kort"
- Parse notes from input
- Effort: **2 hours**

---

## Implementation Priority

| Priority | Feature | Value | Effort | ROI |
|----------|---------|-------|--------|-----|
| 1 | Delete operations | High | Medium | High |
| 2 | Mark task done | High | Low | Very High |
| 3 | Event type selection | Medium | Low | High |
| 4 | Recipe selection | Medium | High | Medium |
| 5 | Edit existing | High | High | Medium |
| 6 | Shopping mark bought | Medium | Medium | Medium |

---

## Technical Changes Required

### 1. New operation types
```typescript
type Operation = 'add' | 'modify' | 'delete' | 'complete'
```

### 2. Lookup logic for existing records
```typescript
// Need to find records before delete/edit/complete
const findExistingTask = async (childId, titlePattern, date) => { ... }
const findExistingMeal = async (date) => { ... }
const findExistingShoppingItem = async (listId, name) => { ... }
```

### 3. AI prompt additions
- Delete patterns in Norwegian
- Complete/done patterns
- Recipe name matching context

### 4. Context expansion
```typescript
// Pass to AI for recipe matching
context: {
  ...existing,
  recipes: recipes.map(r => ({ id: r.id, name: r.name })),
  existingMeals: meals.map(m => ({ date: m.date, name: m.name })),
}
```

---

**Estimated total effort to reach feature parity: 25-30 hours**
