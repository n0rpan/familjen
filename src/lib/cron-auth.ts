import { timingSafeEqual } from 'crypto'

/**
 * Verify the request is from Vercel Cron using timing-safe comparison.
 *
 * SECURITY: No dev bypass - CRON_SECRET is required in all environments.
 * This prevents accidental exposure if NODE_ENV is misconfigured.
 */
export function verifyCronRequest(request: Request): boolean {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('[Cron Auth] CRON_SECRET not configured')
    return false
  }

  if (!authHeader) {
    console.error('[Cron Auth] Missing authorization header')
    return false
  }

  const expectedValue = `Bearer ${cronSecret}`

  // Use timing-safe comparison to prevent timing attacks
  try {
    const authBuffer = Buffer.from(authHeader, 'utf8')
    const expectedBuffer = Buffer.from(expectedValue, 'utf8')

    // If lengths differ, we still do a comparison to maintain constant time
    // but we'll return false regardless
    if (authBuffer.length !== expectedBuffer.length) {
      // Compare against itself to maintain constant time
      timingSafeEqual(authBuffer, authBuffer)
      return false
    }

    return timingSafeEqual(authBuffer, expectedBuffer)
  } catch {
    return false
  }
}
