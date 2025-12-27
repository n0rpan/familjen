import { vi, afterEach, beforeAll } from 'vitest'
import { config } from 'dotenv'

// Load environment variables from .env.local for local development
config({ path: '.env.local' })

// Model via environment variable (GitHub secret) - no hardcoded defaults
// Set OPENROUTER_TEST_MODEL in GitHub Secrets or .env.local
function getRequiredTestModel(): string {
  const model = process.env.OPENROUTER_TEST_MODEL
  if (!model) {
    throw new Error(
      'OPENROUTER_TEST_MODEL environment variable is required. ' +
        'Set it in GitHub Secrets or .env.local (e.g., google/gemini-2.0-flash-001)'
    )
  }
  return model
}

export const TEST_MODEL = getRequiredTestModel()

// Add delay between tests to respect rate limits
const TEST_DELAY = parseInt(process.env.TEST_API_DELAY_MS || '500')

// Log test configuration on startup
beforeAll(() => {
  console.log(`\n[API Tests] Using model: ${TEST_MODEL}`)
  console.log(`[API Tests] Delay between tests: ${TEST_DELAY}ms\n`)
})

// Rate limit protection - delay after each test
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, TEST_DELAY))
})

// Ensure required environment variables are set
beforeAll(() => {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[API Tests] Warning: OPENROUTER_API_KEY not set - tests requiring real API calls will fail')
  }
})
