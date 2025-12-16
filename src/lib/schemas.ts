import { z } from 'zod'

/**
 * Zod schemas for API request validation
 * Provides type-safe runtime validation for all API endpoints
 */

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
