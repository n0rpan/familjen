import { describe, it, expect } from 'vitest'
import { createWishlistItemSchema, updateWishlistItemSchema } from '@/lib/schemas'

const CHILD_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'

describe('createWishlistItemSchema', () => {
  it('accepts an item for a child', () => {
    expect(createWishlistItemSchema.safeParse({ child_id: CHILD_ID, name: 'Lego' }).success).toBe(true)
  })

  it('accepts an item for a member', () => {
    expect(createWishlistItemSchema.safeParse({ member_id: MEMBER_ID, name: 'Bok' }).success).toBe(true)
  })

  it('rejects an item with both child_id and member_id', () => {
    const result = createWishlistItemSchema.safeParse({ child_id: CHILD_ID, member_id: MEMBER_ID, name: 'Lego' })
    expect(result.success).toBe(false)
  })

  it('rejects an item with neither child_id nor member_id', () => {
    expect(createWishlistItemSchema.safeParse({ name: 'Lego' }).success).toBe(false)
  })
})

describe('updateWishlistItemSchema', () => {
  // Regression: deriving this from the refined create schema throws at import in zod >= 4.6
  it('accepts a partial update without owner fields', () => {
    expect(updateWishlistItemSchema.safeParse({ name: 'Ny tittel' }).success).toBe(true)
  })

  it('accepts a status change', () => {
    expect(updateWishlistItemSchema.safeParse({ status: 'reserved' }).success).toBe(true)
  })

  it('strips owner fields so an update cannot move the item', () => {
    const result = updateWishlistItemSchema.safeParse({ child_id: CHILD_ID, name: 'Lego' })
    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('child_id')
  })
})
