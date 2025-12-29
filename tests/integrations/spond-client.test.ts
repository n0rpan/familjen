import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SpondClient, SpondAuthError, SpondError } from '@/lib/integrations/spond'

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('SpondClient', () => {
  let client: SpondClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new SpondClient()
  })

  afterEach(() => {
    client.logout()
  })

  describe('login', () => {
    it('successfully logs in with valid credentials', async () => {
      const mockLoginResponse = {
        loginToken: 'test-token-12345',
        userId: 'user-id-123',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockLoginResponse),
      })

      await client.login('test@example.com', 'password123')

      expect(client.isAuthenticated()).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.spond.com/core/v1/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
        })
      )
    })

    it('throws SpondAuthError when no token is returned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ userId: 'user-id' }), // No loginToken
      })

      await expect(client.login('test@example.com', 'password')).rejects.toThrow(SpondAuthError)
      expect(client.isAuthenticated()).toBe(false)
    })

    it('throws SpondAuthError on HTTP 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid credentials'),
      })

      await expect(client.login('test@example.com', 'wrong-password')).rejects.toThrow(SpondError)
      expect(client.isAuthenticated()).toBe(false)
    })

    it('throws SpondError on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(client.login('test@example.com', 'password')).rejects.toThrow()
      expect(client.isAuthenticated()).toBe(false)
    })
  })

  describe('authentication state', () => {
    it('isAuthenticated returns false before login', () => {
      expect(client.isAuthenticated()).toBe(false)
    })

    it('isAuthenticated returns true after successful login', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ loginToken: 'token' }),
      })

      await client.login('test@example.com', 'password')
      expect(client.isAuthenticated()).toBe(true)
    })

    it('logout clears authentication', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ loginToken: 'token' }),
      })

      await client.login('test@example.com', 'password')
      expect(client.isAuthenticated()).toBe(true)

      client.logout()
      expect(client.isAuthenticated()).toBe(false)
    })
  })

  describe('getGroups', () => {
    it('fetches groups with auth token', async () => {
      // First, login
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ loginToken: 'test-token' }),
      })
      await client.login('test@example.com', 'password')

      // Then, fetch groups
      const mockGroups = [
        { id: 'group-1', name: 'Football Team' },
        { id: 'group-2', name: 'Basketball Team' },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGroups),
      })

      const groups = await client.getGroups()

      expect(groups).toEqual(mockGroups)
      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://api.spond.com/core/v1/groups/',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
    })

    it('throws error when not authenticated', async () => {
      await expect(client.getGroups()).rejects.toThrow()
    })
  })

  describe('getEvents', () => {
    beforeEach(async () => {
      // Login first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ loginToken: 'test-token' }),
      })
      await client.login('test@example.com', 'password')
    })

    it('fetches events with default options', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          heading: 'Training',
          startTimestamp: '2024-12-20T18:00:00Z',
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEvents),
      })

      const events = await client.getEvents()

      expect(events).toEqual(mockEvents)
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining('sponds/?scheduled=true'),
        expect.any(Object)
      )
    })

    it('applies filter options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })

      await client.getEvents({
        groupId: 'group-123',
        maxEvents: 50,
        minEndTimestamp: new Date('2024-12-01'),
        maxStartTimestamp: new Date('2024-12-31'),
      })

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      const url = lastCall[0] as string

      expect(url).toContain('groupId=group-123')
      expect(url).toContain('max=50')
      expect(url).toContain('minEndTimestamp=')
      expect(url).toContain('maxStartTimestamp=')
    })
  })

  describe('error handling', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ loginToken: 'test-token' }),
      })
      await client.login('test@example.com', 'password')
    })

    it('throws SpondError on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      })

      await expect(client.getGroups()).rejects.toThrow(SpondError)
    })

    it('throws SpondAuthError on 401 after login', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Token expired'),
      })

      await expect(client.getGroups()).rejects.toThrow(SpondError)
    })
  })

  describe('mapEventToDb', () => {
    it('maps Spond event to database format', () => {
      const spondEvent = {
        id: 'event-123',
        heading: 'Football Training',
        description: 'Weekly practice',
        startTimestamp: '2024-12-20T18:00:00.000Z',
        endTimestamp: '2024-12-20T20:00:00.000Z',
        location: {
          feature: 'Soccer Field',
          address: '123 Main St',
        },
        type: 'EVENT',
      }

      // Cast to any since we're providing a minimal mock
      const mapped = SpondClient.mapEventToDb(spondEvent as any, 'group-456')

      expect(mapped.externalId).toBe('event-123')
      expect(mapped.externalGroupId).toBe('group-456')
      expect(mapped.title).toBe('Football Training')
      expect(mapped.eventDate).toBe('2024-12-20')
      // Time includes seconds from toTimeString format
      expect(mapped.eventTime).toMatch(/^18:00/)
      expect(mapped.endDate).toBe('2024-12-20')
      expect(mapped.endTime).toMatch(/^20:00/)
      // Address takes precedence over feature
      expect(mapped.location).toBe('123 Main St')
      expect(mapped.eventType).toBe('event')
    })
  })

  describe('mapMessageToDb', () => {
    it('maps Spond message to database format', () => {
      const spondMessage = {
        chatId: 'chat-456',
        msgNum: 123,
        text: 'Hello team!',
        timestamp: '2024-12-20T10:30:00.000Z',
        sender: {
          firstName: 'John',
          lastName: 'Doe',
        },
      }

      // Cast to any since we're providing a minimal mock
      const mapped = SpondClient.mapMessageToDb(spondMessage as any, 'chat-456', 'group-789')

      // External ID is constructed from chatId + msgNum
      expect(mapped.externalId).toBe('chat-456_123')
      expect(mapped.chatId).toBe('chat-456')
      expect(mapped.externalGroupId).toBe('group-789')
      expect(mapped.senderName).toBe('John Doe')
      expect(mapped.body).toBe('Hello team!')
      expect(mapped.messageDate).toBe('2024-12-20T10:30:00.000Z')
    })
  })

  describe('mapPostToDb', () => {
    it('maps Spond post to database format', () => {
      const spondPost = {
        id: 'post-123',
        body: 'Important announcement!',
        createdTime: '2024-12-20T14:00:00.000Z',
        author: {
          firstName: 'Jane',
          lastName: 'Smith',
        },
        group: { id: 'group-456' },
      }

      // Cast to any since we're providing a minimal mock
      const mapped = SpondClient.mapPostToDb(spondPost as any, 'group-456')

      // Post IDs are prefixed with 'post_'
      expect(mapped.externalId).toBe('post_post-123')
      expect(mapped.externalGroupId).toBe('group-456')
      expect(mapped.senderName).toBe('Jane Smith')
      expect(mapped.body).toBe('Important announcement!')
      expect(mapped.messageDate).toBe('2024-12-20T14:00:00.000Z')
    })
  })
})
