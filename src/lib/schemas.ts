import { z } from 'zod'

/**
 * Zod schemas for API request validation
 * Provides type-safe runtime validation for all API endpoints
 */

// ============================================
// Child Task Schemas
// ============================================

export const childTaskTypeSchema = z.enum(['bring', 'appointment', 'reminder', 'activity', 'closure', 'other'])
export const childTaskStatusSchema = z.enum(['open', 'done'])
export const taskSourceSchema = z.enum(['manual', 'ai_suggested', 'imported', 'recurring'])

export const recurrencePatternSchema = z.object({
  type: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'yearly']),
  days: z.array(z.number().min(0).max(6)).optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  interval: z.number().min(1).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).optional().nullable()

export const createChildTaskSchema = z.object({
  child_id: z.string().uuid('child_id må være gyldig UUID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dato må være YYYY-MM-DD format'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Tid må være HH:MM format').optional().nullable(),
  task_type: childTaskTypeSchema,
  title: z.string().min(1, 'Tittel er påkrevd').max(100, 'Tittel kan maks være 100 tegn'),
  notes: z.string().max(500).optional().nullable(),
  source: taskSourceSchema.optional().default('manual'),
  recurrence_pattern: recurrencePatternSchema,
})
export type CreateChildTaskRequest = z.infer<typeof createChildTaskSchema>

// ============================================
// Household Reminder Schemas
// ============================================

export const reminderCategorySchema = z.enum(['bill', 'insurance', 'car', 'home', 'health', 'subscription', 'other'])
export const reminderStatusSchema = z.enum(['open', 'done', 'snoozed'])
export const reminderPrioritySchema = z.enum(['low', 'normal', 'high'])

export const createHouseholdReminderSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dato må være YYYY-MM-DD format'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Tid må være HH:MM format').optional().nullable(),
  title: z.string().min(1, 'Tittel er påkrevd').max(150, 'Tittel kan maks være 150 tegn'),
  notes: z.string().max(500).optional().nullable(),
  category: reminderCategorySchema.optional().default('other'),
  priority: reminderPrioritySchema.optional().default('normal'),
  assigned_to: z.string().uuid().optional().nullable(),
  source: taskSourceSchema.optional().default('manual'),
  recurrence_pattern: recurrencePatternSchema,
})
export type CreateHouseholdReminderRequest = z.infer<typeof createHouseholdReminderSchema>

export const updateHouseholdReminderSchema = createHouseholdReminderSchema.partial().extend({
  status: reminderStatusSchema.optional(),
  snoozed_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})
export type UpdateHouseholdReminderRequest = z.infer<typeof updateHouseholdReminderSchema>

// ============================================
// Wishlist Schemas
// ============================================

export const wishlistOccasionSchema = z.enum(['birthday', 'christmas', 'anniversary', 'general', 'other'])
export const wishlistItemStatusSchema = z.enum(['open', 'reserved', 'fulfilled', 'dismissed'])

export const createWishlistSchema = z.object({
  member_id: z.string().uuid().optional().nullable(),
  child_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1, 'Navn er påkrevd').max(100, 'Navn kan maks være 100 tegn'),
  occasion: wishlistOccasionSchema.optional().nullable(),
  occasion_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  is_public: z.boolean().optional().default(true),
}).refine(
  data => !(data.member_id && data.child_id),
  { message: 'Kan ikke sette både member_id og child_id' }
)
export type CreateWishlistRequest = z.infer<typeof createWishlistSchema>

export const createWishlistItemSchema = z.object({
  wishlist_id: z.string().uuid('wishlist_id må være gyldig UUID'),
  name: z.string().min(1, 'Navn er påkrevd').max(200, 'Navn kan maks være 200 tegn'),
  description: z.string().max(500).optional().nullable(),
  link: z.string().url('Må være gyldig URL').optional().nullable().or(z.literal('')),
  price: z.number().positive('Pris må være positiv').optional().nullable(),
  currency: z.string().length(3, 'Valuta må være 3 tegn (f.eks. NOK)').optional().default('NOK'),
  image_url: z.string().url().optional().nullable(),
  priority: z.number().min(0).max(5).optional().default(0),
  quantity: z.number().min(1).optional().default(1),
  notes: z.string().max(500).optional().nullable(),
  buyer_notes: z.string().max(500).optional().nullable(),
})
export type CreateWishlistItemRequest = z.infer<typeof createWishlistItemSchema>

export const updateWishlistItemSchema = createWishlistItemSchema.omit({ wishlist_id: true }).partial().extend({
  status: wishlistItemStatusSchema.optional(),
})
export type UpdateWishlistItemRequest = z.infer<typeof updateWishlistItemSchema>

// ============================================
// AI Parse Reminders Schema
// ============================================

export const aiParseRemindersSchema = z.object({
  input: z.string().min(1, 'Input er påkrevd').max(2000, 'Input kan maks være 2000 tegn'),
  childIds: z.array(z.string().uuid()).optional(),  // Filter for specific children
  defaultDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),  // Default date if not specified
})
export type AIParseRemindersRequest = z.infer<typeof aiParseRemindersSchema>

export const parsedReminderSchema = z.object({
  title: z.string(),
  date: z.string().nullable(),
  time: z.string().nullable(),
  task_type: childTaskTypeSchema,
  child_name: z.string().nullable(),
  child_id: z.string().nullable(),
  notes: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})
export type ParsedReminder = z.infer<typeof parsedReminderSchema>

// ============================================
// AI Meal Suggestions
// ============================================

// AI Meal Suggestions
export const aiSuggestRequestSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart må være YYYY-MM-DD format'),
  existingMeals: z.array(z.object({
    date: z.string(),
    name: z.string(),
  })).optional().default([]),
})
export type AISuggestRequest = z.infer<typeof aiSuggestRequestSchema>

// Calendar Send Invite
export const sendInviteRequestSchema = z.object({
  pickupId: z.string().uuid('pickupId må være en gyldig UUID'),
  syncToWorkCalendar: z.boolean(),
})
export type SendInviteRequest = z.infer<typeof sendInviteRequestSchema>

// Helper to validate and parse request body with Zod
export async function validateRequest<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const body = await request.json()
    const result = schema.safeParse(body)
    if (!result.success) {
      const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      return { success: false, error: errors }
    }
    return { success: true, data: result.data }
  } catch {
    return { success: false, error: 'Ugyldig JSON i request body' }
  }
}
