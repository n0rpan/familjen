import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiErrors, handleApiError, type ErrorResponse } from '@/lib/api-errors'

// Helper to extract JSON body from NextResponse
async function getResponseBody(response: Response): Promise<ErrorResponse> {
  return response.json()
}

describe('ApiErrors', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('unauthorized', () => {
    it('returns 401 with Norwegian message', async () => {
      const response = ApiErrors.unauthorized()
      const body = await getResponseBody(response)

      expect(response.status).toBe(401)
      expect(body.error).toBe('Du må logge inn på nytt')
      expect(body.code).toBe('auth')
      expect(body.hint).toBe('Prøv å laste siden på nytt eller logg inn igjen')
    })
  })

  describe('forbidden', () => {
    it('returns 403 with access denied message', async () => {
      const response = ApiErrors.forbidden()
      const body = await getResponseBody(response)

      expect(response.status).toBe(403)
      expect(body.error).toBe('Du har ikke tilgang til dette')
      expect(body.code).toBe('forbidden')
    })
  })

  describe('adminRequired', () => {
    it('returns 403 with admin message', async () => {
      const response = ApiErrors.adminRequired()
      const body = await getResponseBody(response)

      expect(response.status).toBe(403)
      expect(body.error).toBe('Denne funksjonen krever administratortilgang')
      expect(body.hint).toContain('administrator')
    })
  })

  describe('invalidOrigin', () => {
    it('returns 403 with security message', async () => {
      const response = ApiErrors.invalidOrigin()
      const body = await getResponseBody(response)

      expect(response.status).toBe(403)
      expect(body.error).toContain('sikkerhetsgrunner')
    })
  })

  describe('notFound', () => {
    it('returns 404 with generic message when no resource specified', async () => {
      const response = ApiErrors.notFound()
      const body = await getResponseBody(response)

      expect(response.status).toBe(404)
      expect(body.error).toBe('Fant ikke det du lette etter')
      expect(body.code).toBe('notFound')
    })

    it('includes resource name when specified', async () => {
      const response = ApiErrors.notFound('Husstanden')
      const body = await getResponseBody(response)

      expect(body.error).toBe('Husstanden ble ikke funnet')
    })
  })

  describe('validation', () => {
    it('returns 400 with custom message', async () => {
      const response = ApiErrors.validation('E-post er påkrevd', { field: 'email' })
      const body = await getResponseBody(response)

      expect(response.status).toBe(400)
      expect(body.error).toBe('E-post er påkrevd')
      expect(body.code).toBe('validation')
      expect(body.field).toBe('email')
    })
  })

  describe('rateLimit', () => {
    it('returns 429 with retry seconds', async () => {
      const response = ApiErrors.rateLimit(30)
      const body = await getResponseBody(response)

      expect(response.status).toBe(429)
      expect(body.error).toContain('30 sekunder')
      expect(body.code).toBe('rateLimit')
      expect(response.headers.get('Retry-After')).toBe('30')
    })
  })

  describe('configError', () => {
    it('returns 500 with config message', async () => {
      const response = ApiErrors.configError()
      const body = await getResponseBody(response)

      expect(response.status).toBe(500)
      expect(body.error).toContain('konfigurert')
      expect(body.code).toBe('config')
      expect(body.hint).toContain('administrator')
    })
  })

  describe('internal', () => {
    it('returns 500 with generic message', async () => {
      const response = ApiErrors.internal()
      const body = await getResponseBody(response)

      expect(response.status).toBe(500)
      expect(body.error).toBe('Noe gikk galt. Prøv igjen senere')
      expect(body.code).toBe('internal')
    })

    it('logs internal message but does not expose it', async () => {
      const response = ApiErrors.internal({
        internalMessage: 'Database connection failed: ECONNREFUSED',
      })
      const body = await getResponseBody(response)

      // Should log the internal message
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Database connection failed')
      )

      // Should NOT expose internal details to user
      expect(body.error).not.toContain('Database')
      expect(body.error).not.toContain('ECONNREFUSED')
      expect(body.error).toBe('Noe gikk galt. Prøv igjen senere')
    })
  })

  describe('timeout', () => {
    it('returns 504 with timeout message', async () => {
      const response = ApiErrors.timeout()
      const body = await getResponseBody(response)

      expect(response.status).toBe(504)
      expect(body.error).toContain('for lang tid')
    })
  })

  describe('authFailed', () => {
    it('includes service name in message', async () => {
      const response = ApiErrors.authFailed('Spond')
      const body = await getResponseBody(response)

      expect(response.status).toBe(401)
      expect(body.error).toBe('Kunne ikke logge inn på Spond')
      expect(body.hint).toContain('brukernavn og passord')
    })
  })
})

describe('handleApiError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns internal error with context logged', async () => {
    const error = new Error('Connection refused')
    const response = handleApiError(error, 'calendar sync')
    const body = await getResponseBody(response)

    expect(response.status).toBe(500)
    expect(body.code).toBe('internal')
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[calendar sync] Connection refused')
    )
  })

  it('handles non-Error objects', async () => {
    const response = handleApiError('string error', 'test context')
    const body = await getResponseBody(response)

    expect(response.status).toBe(500)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('string error')
    )
  })
})
