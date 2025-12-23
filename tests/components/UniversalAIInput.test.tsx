import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { UniversalAIInput } from '@/components/ai/UniversalAIInput'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

// Mock FileReader globally before any tests
class MockFileReader {
  result: string | ArrayBuffer | null = null
  onloadend: (() => void) | null = null
  onerror: (() => void) | null = null

  readAsDataURL() {
    // Simulate async file reading
    setTimeout(() => {
      this.result = 'data:image/jpeg;base64,fake-base64-data'
      this.onloadend?.()
    }, 0)
  }
}

global.FileReader = MockFileReader as unknown as typeof FileReader

// Mock language context
vi.mock('@/lib/i18n/context', () => ({
  useLanguage: () => ({
    t: {
      ai: {
        inputPlaceholder: 'Middag, henting, search med ?, eller ta bilde...',
        add: 'Legg til',
        parsing: 'Venter',
      },
      common: {
        confirm: 'Bekreft',
        cancel: 'Avbryt',
      },
      errors: {
        saveFailed: 'Kunne ikke lagre',
        generic: 'Noe gikk galt',
        notFound: 'Fant ikke',
        invalidInput: 'Ugyldig input',
      },
      date: {
        weekdaysShort: ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'],
      },
    },
    language: 'nb',
    setLanguage: vi.fn(),
  }),
}))

// Mock supabase client
const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabaseClient,
}))

// Test data
const mockChildren = [
  { id: 'child-1', name: 'Storm' },
  { id: 'child-2', name: 'Luna' },
]

const mockMembers = [
  { id: 'member-1', name: 'Martin', user_id: 'user-1' },
  { id: 'member-2', name: 'Sara', user_id: 'user-2' },
]

const defaultProps = {
  householdId: 'household-1',
  children: mockChildren,
  members: mockMembers,
  currentUserId: 'user-1',
  onActionExecuted: vi.fn(),
}

describe('UniversalAIInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Image Upload', () => {
    it('renders image upload button', () => {
      render(<UniversalAIInput {...defaultProps} />)

      // Find button by its title
      const uploadButton = screen.getByTitle('Last opp bilde')
      expect(uploadButton).toBeInTheDocument()
    })

    it('has hidden file input accepting images', () => {
      render(<UniversalAIInput {...defaultProps} />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toBeInTheDocument()
      expect(fileInput.accept).toBe('image/*')
      expect(fileInput.className).toContain('hidden')
    })

    it('shows image preview after selection', async () => {
      render(<UniversalAIInput {...defaultProps} />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

      // Create a mock image file
      const file = new File(['fake-image-data'], 'test-image.jpg', { type: 'image/jpeg' })

      // Trigger file selection
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Wait for FileReader to complete (setTimeout in mock)
      await waitFor(() => {
        expect(screen.getByAltText('Valgt bilde')).toBeInTheDocument()
      })

      const previewImage = screen.getByAltText('Valgt bilde')
      expect(previewImage).toHaveAttribute('src', 'data:image/jpeg;base64,fake-base64-data')
    })

    it('shows remove button on image preview', async () => {
      render(<UniversalAIInput {...defaultProps} />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['fake-image-data'], 'test-image.jpg', { type: 'image/jpeg' })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Wait for FileReader to complete
      await waitFor(() => {
        expect(screen.getByAltText('Valgt bilde')).toBeInTheDocument()
      })

      // Check for remove button
      const removeButton = screen.getByTitle('Fjern bilde')
      expect(removeButton).toBeInTheDocument()
    })

    it('removes image on remove click', async () => {
      render(<UniversalAIInput {...defaultProps} />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['fake-image-data'], 'test-image.jpg', { type: 'image/jpeg' })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Wait for FileReader to complete
      await waitFor(() => {
        expect(screen.getByAltText('Valgt bilde')).toBeInTheDocument()
      })

      // Click remove button
      const removeButton = screen.getByTitle('Fjern bilde')
      await act(async () => {
        fireEvent.click(removeButton)
      })

      // Verify preview is removed
      expect(screen.queryByAltText('Valgt bilde')).not.toBeInTheDocument()
    })

    it('shows error for files over 5MB', async () => {
      render(<UniversalAIInput {...defaultProps} />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

      // Create a mock file > 5MB
      const largeFile = new File(['x'.repeat(6 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' })
      Object.defineProperty(largeFile, 'size', { value: 6 * 1024 * 1024 })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [largeFile] } })
      })

      // Check for error message
      expect(screen.getByText('Bildet er for stort (maks 5MB)')).toBeInTheDocument()
    })

    it('shows error for non-image files', async () => {
      render(<UniversalAIInput {...defaultProps} />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const pdfFile = new File(['fake-pdf-data'], 'document.pdf', { type: 'application/pdf' })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [pdfFile] } })
      })

      // Check for error message
      expect(screen.getByText('Kun bilder er støttet')).toBeInTheDocument()
    })
  })

  describe('Search Results', () => {
    it('shows search results with answer and sources', async () => {
      const mockSearchResponse = {
        mode: 'search' as const,
        answer: 'Basert på meldingene, dugnad er planlagt til lørdag 15. mars.',
        sources: [
          {
            type: 'message' as const,
            title: 'Beskjed fra barnehagen',
            excerpt: 'Husk dugnad lørdag 15. mars kl 10:00',
            date: '2025-03-10',
            id: 'msg-1',
          },
        ],
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSearchResponse),
      })

      render(<UniversalAIInput {...defaultProps} />)

      const input = screen.getByPlaceholderText(/Middag, henting/)

      await act(async () => {
        fireEvent.change(input, { target: { value: '?når er dugnad' } })
      })

      // Wait for debounce and API call
      await waitFor(() => {
        expect(screen.getByText('Basert på meldingene, dugnad er planlagt til lørdag 15. mars.')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Check for search icon
      expect(screen.getByText('🔍')).toBeInTheDocument()

      // Check sources section
      expect(screen.getByText('Kilder:')).toBeInTheDocument()
      expect(screen.getByText('Beskjed fra barnehagen')).toBeInTheDocument()
    })

    it('shows appropriate icons for different source types', async () => {
      const mockSearchResponse = {
        mode: 'search' as const,
        answer: 'Her er informasjonen du spurte om.',
        sources: [
          { type: 'task' as const, title: 'Oppgave', excerpt: 'En oppgave', id: '1' },
          { type: 'event' as const, title: 'Hendelse', excerpt: 'En hendelse', id: '2' },
          { type: 'recipe' as const, title: 'Oppskrift', excerpt: 'En oppskrift', id: '3' },
          { type: 'meal' as const, title: 'Middag', excerpt: 'En middag', id: '4' },
          { type: 'message' as const, title: 'Melding', excerpt: 'En melding', id: '5' },
        ],
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSearchResponse),
      })

      render(<UniversalAIInput {...defaultProps} />)

      const input = screen.getByPlaceholderText(/Middag, henting/)

      await act(async () => {
        fireEvent.change(input, { target: { value: '?test' } })
      })

      await waitFor(() => {
        expect(screen.getByText('Her er informasjonen du spurte om.')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Verify source icons are rendered (icons are rendered as text)
      expect(screen.getByText('📋')).toBeInTheDocument() // task
      expect(screen.getByText('📅')).toBeInTheDocument() // event
      expect(screen.getByText('🍳')).toBeInTheDocument() // recipe
      expect(screen.getByText('🍽️')).toBeInTheDocument() // meal
      expect(screen.getByText('💬')).toBeInTheDocument() // message
    })
  })

  describe('Meal Suggestions', () => {
    it('shows meal suggestion cards', async () => {
      const mockSuggestResponse = {
        mode: 'suggest' as const,
        suggestions: [
          {
            day: '2025-12-24',
            name: 'Pinnekjøtt',
            description: 'Tradisjonell julemat',
            ingredients: [
              { item: 'Pinnekjøtt', amount: '1.5 kg' },
              { item: 'Kålrabistappe', amount: '500g' },
            ],
          },
          {
            day: '2025-12-25',
            name: 'Ribbe',
            description: 'Med surkål og medisterkaker',
            ingredients: [
              { item: 'Svineribbe', amount: '2 kg' },
            ],
          },
        ],
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSuggestResponse),
      })

      render(<UniversalAIInput {...defaultProps} />)

      const input = screen.getByPlaceholderText(/Middag, henting/)

      await act(async () => {
        fireEvent.change(input, { target: { value: 'forslag til middag' } })
      })

      await waitFor(() => {
        expect(screen.getByText('Middagsforslag:')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Check meal names
      expect(screen.getByText('Pinnekjøtt')).toBeInTheDocument()
      expect(screen.getByText('Ribbe')).toBeInTheDocument()

      // Check descriptions
      expect(screen.getByText('Tradisjonell julemat')).toBeInTheDocument()
      expect(screen.getByText('Med surkål og medisterkaker')).toBeInTheDocument()

      // Check action buttons (2 meals = 2 sets of buttons)
      const addButtons = screen.getAllByText('Legg til')
      expect(addButtons).toHaveLength(2)

      const rejectButtons = screen.getAllByText('Nei takk')
      expect(rejectButtons).toHaveLength(2)
    })

    it('removes meal suggestion on reject click', async () => {
      const mockSuggestResponse = {
        mode: 'suggest' as const,
        suggestions: [
          {
            day: '2025-12-24',
            name: 'Taco',
            description: 'Fredagstaco',
            ingredients: [],
          },
        ],
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSuggestResponse),
      })

      render(<UniversalAIInput {...defaultProps} />)

      const input = screen.getByPlaceholderText(/Middag, henting/)

      await act(async () => {
        fireEvent.change(input, { target: { value: 'forslag til middag' } })
      })

      await waitFor(() => {
        expect(screen.getByText('Taco')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Click reject button
      const rejectButton = screen.getByText('Nei takk')
      await act(async () => {
        fireEvent.click(rejectButton)
      })

      // Verify meal is removed
      expect(screen.queryByText('Taco')).not.toBeInTheDocument()
    })

    it('shows empty state when all weekdays have meals', async () => {
      const mockSuggestResponse = {
        mode: 'suggest' as const,
        suggestions: [],
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSuggestResponse),
      })

      render(<UniversalAIInput {...defaultProps} />)

      const input = screen.getByPlaceholderText(/Middag, henting/)

      await act(async () => {
        fireEvent.change(input, { target: { value: 'hva skal vi ha til middag' } })
      })

      await waitFor(() => {
        expect(screen.getByText(/Alle hverdager har allerede middager planlagt/)).toBeInTheDocument()
      }, { timeout: 2000 })
    })
  })

  describe('Input Handling', () => {
    it('renders textarea with correct placeholder', () => {
      render(<UniversalAIInput {...defaultProps} />)

      const input = screen.getByPlaceholderText(/Middag, henting/)
      expect(input).toBeInTheDocument()
      expect(input.tagName).toBe('TEXTAREA')
    })

    it('debounces input changes before API call', async () => {
      vi.useFakeTimers()

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ mode: 'action', actions: [] }),
      })

      render(<UniversalAIInput {...defaultProps} />)

      const input = screen.getByPlaceholderText(/Middag, henting/)

      // Type rapidly
      await act(async () => {
        fireEvent.change(input, { target: { value: 'ta' } })
      })
      await act(async () => {
        fireEvent.change(input, { target: { value: 'tac' } })
      })
      await act(async () => {
        fireEvent.change(input, { target: { value: 'taco' } })
      })

      // No API call yet (debounce not expired)
      expect(global.fetch).not.toHaveBeenCalled()

      // Fast-forward past debounce delay (600ms)
      await act(async () => {
        vi.advanceTimersByTime(700)
      })

      // Now API should be called once
      expect(global.fetch).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })

    it('does not parse input shorter than 3 characters', async () => {
      vi.useFakeTimers()

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ mode: 'action', actions: [] }),
      })

      render(<UniversalAIInput {...defaultProps} />)

      const input = screen.getByPlaceholderText(/Middag, henting/)

      await act(async () => {
        fireEvent.change(input, { target: { value: 'ta' } })
      })

      await act(async () => {
        vi.advanceTimersByTime(700)
      })

      // Should not call API for 2-character input
      expect(global.fetch).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('Rate Limiting', () => {
    it('shows countdown when rate limited', async () => {
      const mockHeaders = new Map([['Retry-After', '5']])

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: {
          get: (name: string) => mockHeaders.get(name) || null,
        },
        json: () => Promise.resolve({ error: 'Rate limited' }),
      })

      render(<UniversalAIInput {...defaultProps} />)

      const input = screen.getByPlaceholderText(/Middag, henting/)

      // Type and wait for debounce
      fireEvent.change(input, { target: { value: 'taco på fredag' } })

      // Wait for countdown to appear
      await waitFor(() => {
        expect(screen.getByText('5s')).toBeInTheDocument()
      }, { timeout: 2000 })
    })
  })

  describe('Action Parsing', () => {
    it('shows parsed action card with add button', async () => {
      const mockActionResponse = {
        mode: 'action' as const,
        actions: [
          {
            type: 'meal' as const,
            operation: 'add' as const,
            confidence: 0.9,
            data: {
              date: '2025-12-24',
              meal_name: 'Pinnekjøtt',
            },
            display: {
              icon: '🍽️',
              title: 'Pinnekjøtt',
              subtitle: 'ons 24.12',
            },
          },
        ],
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockActionResponse),
      })

      render(<UniversalAIInput {...defaultProps} />)

      const input = screen.getByPlaceholderText(/Middag, henting/)

      // Type and wait for response
      fireEvent.change(input, { target: { value: 'pinnekjøtt på julaften' } })

      await waitFor(() => {
        expect(screen.getByText('Pinnekjøtt')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Check for add button
      expect(screen.getByText('Legg til')).toBeInTheDocument()
    })
  })
})
