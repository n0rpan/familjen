import { z } from 'zod'
import {
  CHILD_TASK_TYPES,
  CHILD_TASK_STATUSES,
  TASK_SOURCES,
  RECURRENCE_TYPES,
  WISHLIST_OCCASIONS,
  WISHLIST_ITEM_STATUSES,
} from './constants'

/**
 * Zod schemas for API request validation
 * Provides type-safe runtime validation for all API endpoints
 * Uses shared constants for enum values (single source of truth)
 */

// ============================================
// Child Task Schemas
// ============================================

export const childTaskTypeSchema = z.enum(CHILD_TASK_TYPES)
export const childTaskStatusSchema = z.enum(CHILD_TASK_STATUSES)
export const taskSourceSchema = z.enum(TASK_SOURCES)

export const recurrencePatternSchema = z.object({
  type: z.enum(RECURRENCE_TYPES),
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
// Wishlist Schemas
// ============================================

export const wishlistOccasionSchema = z.enum(WISHLIST_OCCASIONS)
export const wishlistItemStatusSchema = z.enum(WISHLIST_ITEM_STATUSES)

export const createWishlistItemSchema = z.object({
  child_id: z.string().uuid().optional().nullable(),
  member_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1, 'Navn er påkrevd').max(200, 'Navn kan maks være 200 tegn'),
  description: z.string().max(500).optional().nullable(),
  link: z.string().url('Må være gyldig URL').optional().nullable().or(z.literal('')),
  price: z.number().positive('Pris må være positiv').optional().nullable(),
  image_path: z.string().optional().nullable(),
  occasion: wishlistOccasionSchema.optional().default('general'),
  priority: z.number().min(0).max(5).optional().default(0),
}).refine(
  data => (data.child_id != null) !== (data.member_id != null),
  { message: 'Må sette enten child_id eller member_id (ikke begge)' }
)
export type CreateWishlistItemRequest = z.infer<typeof createWishlistItemSchema>

export const updateWishlistItemSchema = createWishlistItemSchema
  .omit({ child_id: true, member_id: true })
  .partial()
  .extend({
    status: wishlistItemStatusSchema.optional(),
  })
export type UpdateWishlistItemRequest = z.infer<typeof updateWishlistItemSchema>

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
