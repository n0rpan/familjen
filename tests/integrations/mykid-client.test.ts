import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MyKidClient, MyKidAuthError, MyKidCsrfError, MyKidError } from '@/lib/integrations/mykid'

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('MyKidClient', () => {
  let client: MyKidClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new MyKidClient()
  })

  afterEach(() => {
    client.logout()
  })

  // Helper to create mock response with headers
  function createMockResponse(options: {
    ok?: boolean
    status?: number
    text?: string
    headers?: Record<string, string>
  }) {
    return {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      text: () => Promise.resolve(options.text ?? ''),
      headers: new Headers(options.headers ?? {}),
    }
  }

  describe('3-step CSRF authentication', () => {
    it('successfully completes the full login flow', async () => {
      // Step 1: GET login page - returns CSRF in hidden input
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: `
            <html>
              <form id="login-form">
                <input type="hidden" name="_csrf_token" value="login-csrf-token-12345">
                <input name="m" placeholder="Phone">
                <input name="p" placeholder="Password">
              </form>
            </html>
          `,
          headers: { 'Set-Cookie': 'PHPSESSID=abc123; Path=/' },
        })
      )

      // Step 2: POST login - returns JSON success
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: JSON.stringify({
            status: 'ok',
            link: '/foreldre',
          }),
          headers: { 'Set-Cookie': 'auth_token=xyz789; Path=/' },
        })
      )

      // Step 3: GET dashboard - returns CSRF in meta tag
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: `
            <html>
              <head>
                <meta name="_csrf_token" content="dashboard-csrf-token-67890">
              </head>
              <body>Dashboard content</body>
            </html>
          `,
        })
      )

      await client.login('+4712345678', 'password123')

      expect(client.isAuthenticated()).toBe(true)

      // Verify Step 1: GET login page
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://mykid.no/nb/logg_inn',
        expect.any(Object)
      )

      // Verify Step 2: POST with AJAX headers (critical!)
      const step2Call = mockFetch.mock.calls[1]
      expect(step2Call[0]).toBe('https://mykid.no/forside/forside/login')
      expect(step2Call[1].method).toBe('POST')
      expect(step2Call[1].headers.Accept).toBe('application/json')
      expect(step2Call[1].headers['X-Requested-With']).toBe('XMLHttpRequest')
      expect(step2Call[1].body).toContain('_csrf_token=login-csrf-token-12345')
      expect(step2Call[1].body).toContain('m=%2B4712345678')
      expect(step2Call[1].body).toContain('p=password123')

      // Verify Step 3: GET dashboard
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'https://mykid.no/foreldre',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'text/html,application/xhtml+xml',
          }),
        })
      )
    })

    it('throws MyKidCsrfError when login page has no CSRF', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: '<html><form>No CSRF here</form></html>',
        })
      )

      await expect(client.login('+4712345678', 'password')).rejects.toThrow(MyKidCsrfError)
      expect(client.isAuthenticated()).toBe(false)
    })

    it('throws MyKidAuthError on login failure', async () => {
      // Step 1: Success
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: '<input type="hidden" name="_csrf_token" value="csrf-token">',
        })
      )

      // Step 2: Login fails
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: JSON.stringify({
            status: 'error',
            message: 'Feil brukernavn eller passord',
          }),
        })
      )

      await expect(client.login('+4712345678', 'wrong-password')).rejects.toThrow(MyKidAuthError)
      expect(client.isAuthenticated()).toBe(false)
    })

    it('throws MyKidAuthError on non-JSON login response', async () => {
      // Step 1: Success
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: '<input type="hidden" name="_csrf_token" value="csrf-token">',
        })
      )

      // Step 2: Returns HTML instead of JSON (happens without AJAX headers)
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: '<html>Error page</html>',
        })
      )

      await expect(client.login('+4712345678', 'password')).rejects.toThrow(MyKidAuthError)
    })

    it('throws MyKidCsrfError when dashboard has no CSRF', async () => {
      // Step 1: Success
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: '<input type="hidden" name="_csrf_token" value="csrf-token">',
        })
      )

      // Step 2: Success
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: JSON.stringify({ status: 'ok', link: '/foreldre' }),
        })
      )

      // Step 3: Dashboard without CSRF meta tag
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: '<html><head></head><body>Dashboard</body></html>',
        })
      )

      await expect(client.login('+4712345678', 'password')).rejects.toThrow(MyKidCsrfError)
    })

    it('throws MyKidError when login page fetch fails', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 500,
        })
      )

      await expect(client.login('+4712345678', 'password')).rejects.toThrow(MyKidError)
    })

    it('throws MyKidError when dashboard fetch fails', async () => {
      // Step 1: Success
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: '<input type="hidden" name="_csrf_token" value="csrf-token">',
        })
      )

      // Step 2: Success
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: JSON.stringify({ status: 'ok', link: '/foreldre' }),
        })
      )

      // Step 3: Dashboard fails
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 403,
        })
      )

      await expect(client.login('+4712345678', 'password')).rejects.toThrow(MyKidError)
    })
  })

  describe('authentication state', () => {
    it('isAuthenticated returns false before login', () => {
      expect(client.isAuthenticated()).toBe(false)
    })

    it('logout clears authentication', async () => {
      // Complete successful login
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: '<input type="hidden" name="_csrf_token" value="csrf">',
          headers: { 'Set-Cookie': 'session=123' },
        })
      )
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: JSON.stringify({ status: 'ok' }),
        })
      )
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          text: '<meta name="_csrf_token" content="dashboard-csrf">',
        })
      )

      await client.login('+4712345678', 'password')
      expect(client.isAuthenticated()).toBe(true)

      client.logout()
      expect(client.isAuthenticated()).toBe(false)
    })
  })

  describe('mapCalendarEventToDb', () => {
    it('maps MyKid calendar event to database format', () => {
      // MyKid events use event_at/event_until/class fields
      const event = {
        id: 'event-123',
        title: 'Barnehage lukker tidlig',
        event_at: '2024-12-20',
        event_until: '2024-12-20',
        class: 'kindergarten',
        description: null,
      }

      const mapped = MyKidClient.mapCalendarEventToDb(event as any)

      expect(mapped.externalId).toBe('event-123')
      expect(mapped.title).toBe('Barnehage lukker tidlig')
      expect(mapped.eventDate).toBe('2024-12-20')
      expect(mapped.endDate).toBe('2024-12-20')
      expect(mapped.eventType).toBe('kindergarten')
    })

    it('handles events without end date', () => {
      const event = {
        id: 'event-456',
        title: 'Foreldremøte',
        event_at: '2024-12-20',
        event_until: null,
        class: 'meeting',
      }

      const mapped = MyKidClient.mapCalendarEventToDb(event as any)

      expect(mapped.eventDate).toBe('2024-12-20')
      expect(mapped.endDate).toBeNull()
      // MyKid mapper doesn't extract time (sets it to null)
      expect(mapped.eventTime).toBeNull()
    })
  })

  describe('mapNewsletterToDb', () => {
    it('maps MyKid newsletter to database format', () => {
      const newsletter = {
        id: 'nl-123',
        title: 'Ukebrev uke 51',
        content: 'Denne uken har vi...',
        date: '20.12.2024', // Norwegian date format: dd.mm.yyyy
      }

      const mapped = MyKidClient.mapNewsletterToDb(newsletter as any)

      expect(mapped.externalId).toBe('newsletter_nl-123')
      expect(mapped.title).toBe('Ukebrev uke 51')
      expect(mapped.body).toBe('Denne uken har vi...')
    })
  })

  describe('parseNorwegianDate', () => {
    it('parses dd.mm.yyyy format', () => {
      // MyKid uses dd.mm.yyyy numeric format
      const date = MyKidClient.parseNorwegianDate('20.12.2024')

      expect(date).toBeInstanceOf(Date)
      expect(date?.getDate()).toBe(20)
      expect(date?.getMonth()).toBe(11) // December is 11
      expect(date?.getFullYear()).toBe(2024)
    })

    it('parses single digit day and month', () => {
      const date = MyKidClient.parseNorwegianDate('5.1.2025')

      expect(date?.getDate()).toBe(5)
      expect(date?.getMonth()).toBe(0) // January is 0
      expect(date?.getFullYear()).toBe(2025)
    })

    it('returns null for invalid dates', () => {
      expect(MyKidClient.parseNorwegianDate('invalid')).toBeNull()
      expect(MyKidClient.parseNorwegianDate('')).toBeNull()
      // Month names are not supported, only numeric format
      expect(MyKidClient.parseNorwegianDate('20. desember 2024')).toBeNull()
    })
  })
})
