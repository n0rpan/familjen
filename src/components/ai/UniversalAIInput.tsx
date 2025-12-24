'use client'

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import type {
  ParsedAction,
  ActionType,
  ActionOperation,
  SearchSource,
  SearchResponse,
  SuggestResponse,
  ActionResponse,
  ParseActionResponse,
} from '@/app/api/openrouter/parse-action/route'
import type { MealSuggestion } from '@/lib/types'
import { formatDateISO } from '@/lib/utils'
import { compressImageToBase64 } from '@/lib/image-compression'
import { getCachedCategory, setCachedCategory } from '@/lib/shopping-category-cache'
import type { ShoppingCategory } from '@/lib/constants'

interface Child {
  id: string
  name: string
}

interface Member {
  id: string
  name: string
  user_id: string | null
}

interface UniversalAIInputProps {
  householdId: string
  children: Child[]
  members: Member[]
  currentUserId: string | null
  onActionExecuted?: () => void
}

// Store original data for undo support
interface UndoData {
  type: 'add' | 'delete' | 'complete' | 'edit'
  table: string
  recordId?: string // For add operations (delete this record to undo)
  deletedRecords?: Record<string, unknown>[] // For delete operations (re-insert these to undo)
  completedRecords?: { id: string; previousState: Record<string, unknown> }[] // For complete operations (restore previous state)
  editedRecords?: { id: string; previousState: Record<string, unknown> }[] // For edit operations (restore previous state)
}

interface ExecutedAction {
  action: ParsedAction
  undoData: UndoData
  timestamp: number
}

export function UniversalAIInput({
  householdId,
  children,
  members,
  currentUserId,
  onActionExecuted,
}: UniversalAIInputProps) {
  const { t } = useLanguage()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [input, setInput] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [parsedActions, setParsedActions] = useState<ParsedAction[]>([])
  const [executedActions, setExecutedActions] = useState<ExecutedAction[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState<ParsedAction | null>(null)
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number>(0)

  // New mode states for search and suggest
  const [responseMode, setResponseMode] = useState<'action' | 'search' | 'suggest' | null>(null)
  const [searchAnswer, setSearchAnswer] = useState<string | null>(null)
  const [searchSources, setSearchSources] = useState<SearchSource[]>([])
  const [mealSuggestions, setMealSuggestions] = useState<MealSuggestion[]>([])

  // Image upload state
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pendingInputRef = useRef<string>('')

  const currentMember = members.find(m => m.user_id === currentUserId)

  // Rate limit countdown timer
  useEffect(() => {
    if (rateLimitCountdown <= 0) return

    const timer = setInterval(() => {
      setRateLimitCountdown(prev => {
        if (prev <= 1) {
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [rateLimitCountdown])

  // Auto-retry when countdown ends
  useEffect(() => {
    if (rateLimitCountdown === 0 && pendingInputRef.current) {
      const pending = pendingInputRef.current
      pendingInputRef.current = ''
      // Use setTimeout to avoid calling parseInput during render
      setTimeout(() => {
        if (pending.trim().length >= 3) {
          parseInput(pending)
        }
      }, 100)
    }
  }, [rateLimitCountdown])

  const parseInput = useCallback(async (text: string, image?: string | null) => {
    // Need either text or image
    if (text.trim().length < 3 && !image) {
      setParsedActions([])
      setResponseMode(null)
      setSearchAnswer(null)
      setSearchSources([])
      setMealSuggestions([])
      return
    }

    // Don't parse while rate limited
    if (rateLimitCountdown > 0) {
      pendingInputRef.current = text
      return
    }

    setIsParsing(true)
    setError(null)
    // Clear all states when typing new input
    setExecutedActions([])
    setResponseMode(null)
    setSearchAnswer(null)
    setSearchSources([])
    setMealSuggestions([])

    try {
      const today = formatDateISO(new Date())
      const requestBody: {
        input: string
        image?: string
        context: {
          today: string
          children: Array<{ id: string; name: string }>
          members: Array<{ id: string; name: string; isCurrentUser: boolean }>
        }
      } = {
        input: text,
        context: {
          today,
          children: children.map(c => ({ id: c.id, name: c.name })),
          members: members.map(m => ({
            id: m.id,
            name: m.name,
            isCurrentUser: m.user_id === currentUserId,
          })),
        },
      }

      // Include image if provided
      if (image) {
        requestBody.image = image
      }

      const response = await fetch('/api/openrouter/parse-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      // Handle rate limiting with countdown
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10)
        setRateLimitCountdown(retryAfter)
        pendingInputRef.current = text
        setError(null)
        setParsedActions([])
        return
      }

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Kunne ikke tolke tekst')
      }

      const data: ParseActionResponse = await response.json()

      // Handle different response modes
      if ('error' in data) {
        throw new Error(data.error)
      }

      if ('mode' in data) {
        setResponseMode(data.mode)

        if (data.mode === 'search') {
          const searchData = data as SearchResponse
          setSearchAnswer(searchData.answer)
          setSearchSources(searchData.sources)
          setParsedActions([])
        } else if (data.mode === 'suggest') {
          const suggestData = data as SuggestResponse
          setMealSuggestions(suggestData.suggestions)
          setParsedActions([])
        } else if (data.mode === 'action') {
          const actionData = data as ActionResponse
          setParsedActions(actionData.actions || [])
        }
      } else {
        // Legacy response format (just actions array)
        setParsedActions((data as { actions?: ParsedAction[] }).actions || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
      setParsedActions([])
    } finally {
      setIsParsing(false)
    }
  }, [children, members, currentUserId, rateLimitCountdown])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setInput(text)
    setPendingConfirmation(null)

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      parseInput(text, selectedImage)
    }, 600)
  }, [parseInput, selectedImage])

  // Image handling functions
  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Kun bilder er støttet')
      return
    }

    setError(null)
    setIsCompressing(true)

    try {
      // Compress image to max 1600px and ~2MB (handles large iPhone photos)
      const base64 = await compressImageToBase64(file, {
        maxWidth: 1600,
        maxHeight: 1600,
        quality: 0.85,
        maxSizeBytes: 2 * 1024 * 1024,
      })

      setSelectedImage(base64)
      setImagePreview(base64)

      // Parse immediately - AI will analyze and suggest action type
      parseInput(input || '', base64)
    } catch (err) {
      console.error('Image compression failed:', err)
      setError('Kunne ikke behandle bildet')
    } finally {
      setIsCompressing(false)
    }
  }, [input, parseInput])

  const handleRemoveImage = useCallback(() => {
    setSelectedImage(null)
    setImagePreview(null)
    if (imageInputRef.current) {
      imageInputRef.current.value = ''
    }
    // Re-parse without image
    if (input.trim().length >= 3) {
      parseInput(input)
    } else {
      setParsedActions([])
      setResponseMode(null)
    }
  }, [input, parseInput])

  // Meal suggestion handlers
  const handleAcceptMeal = useCallback(async (suggestion: MealSuggestion) => {
    try {
      // Insert meal into database
      const { error: insertError } = await supabase
        .from('meals')
        .upsert({
          household_id: householdId,
          date: suggestion.day,
          custom_meal: suggestion.name,
        }, { onConflict: 'household_id,date' })

      if (insertError) throw insertError

      // Remove from suggestions list
      setMealSuggestions(prev => prev.filter(s => s.day !== suggestion.day))

      // Refresh if callback provided
      onActionExecuted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke lagre middag')
    }
  }, [supabase, householdId, onActionExecuted])

  const handleRejectMeal = useCallback((suggestion: MealSuggestion) => {
    setMealSuggestions(prev => prev.filter(s => s.day !== suggestion.day))
  }, [])

  const handleClarification = useCallback((action: ParsedAction, field: string, value: string | null, resultType?: ActionType) => {
    // Handle person_id clarification (contains "child:uuid" or "member:uuid")
    let updatedData = { ...action.data }
    if (field === 'person_id' && value) {
      const [type, id] = value.split(':')
      if (type === 'child') {
        updatedData.child_id = id
        updatedData.member_id = null
      } else if (type === 'member') {
        updatedData.member_id = id
        updatedData.child_id = null
      }
    } else {
      updatedData[field] = value
    }

    // Update the action with the clarified value
    const updatedAction: ParsedAction = {
      ...action,
      type: resultType || action.type,
      data: updatedData,
      needsClarification: undefined,
    }

    // If it's a modification or delete, ask for confirmation
    if (updatedAction.operation === 'modify' || updatedAction.operation === 'delete') {
      setPendingConfirmation(updatedAction)
    } else {
      // Execute immediately for additions and completions
      executeAction(updatedAction)
    }

    // Remove from parsed actions
    setParsedActions(prev => prev.filter(a => a !== action))
  }, [])

  // Infer child_id from child_name if needed
  const inferChildId = useCallback((action: ParsedAction): string | null => {
    if (action.data.child_id) return action.data.child_id as string

    if (action.data.child_name) {
      const childName = (action.data.child_name as string).toLowerCase()
      const matchedChild = children.find(c =>
        c.name.toLowerCase().includes(childName) ||
        childName.includes(c.name.toLowerCase())
      )
      if (matchedChild) return matchedChild.id
    }
    return null
  }, [children])

  // Infer member_id from member_name if needed
  const inferMemberId = useCallback((action: ParsedAction): string | null => {
    if (action.data.member_id) return action.data.member_id as string

    if (action.data.member_name) {
      const memberName = (action.data.member_name as string).toLowerCase()
      const matchedMember = members.find(m =>
        m.name.toLowerCase().includes(memberName) ||
        memberName.includes(m.name.toLowerCase())
      )
      if (matchedMember) return matchedMember.id
    }
    return null
  }, [members])

  // Validate action and return clarification if needed
  // This runs for ALL operations (add, edit, delete, complete)
  const validateAndPrepareAction = useCallback((action: ParsedAction): ParsedAction | null => {
    const updatedAction = { ...action, data: { ...action.data } }

    switch (action.type) {
      case 'child_task': {
        // For all operations, try to infer child_id if not already set
        const childId = inferChildId(action)
        if (childId) {
          updatedAction.data.child_id = childId
        } else if (action.operation === 'add') {
          // Only require child clarification for add operations
          // For edit/delete/complete, we search by title and show matches
          return {
            ...updatedAction,
            needsClarification: {
              field: 'child_id',
              question: 'Hvilke barn gjelder dette?',
              options: children.map(c => ({ label: c.name, value: c.id })),
            },
          }
        }
        break
      }
      case 'pickup': {
        // Pickup always requires child_id for all operations
        const childId = inferChildId(action)
        if (!childId) {
          const questionMap: Record<string, string> = {
            add: 'Hvem skal hentes?',
            modify: 'Hvem sin henting skal endres?',
            delete: 'Hvem sin henting skal fjernes?',
          }
          return {
            ...updatedAction,
            needsClarification: {
              field: 'child_id',
              question: questionMap[action.operation] || 'Hvem gjelder dette?',
              options: children.map(c => ({ label: c.name, value: c.id })),
            },
          }
        }
        updatedAction.data.child_id = childId

        // For add/modify, also infer picker_id if needed
        if (action.operation === 'add' || action.operation === 'modify') {
          const pickerId = inferMemberId(action) || currentMember?.id
          updatedAction.data.picker_id = pickerId
        }
        break
      }
      case 'member_event': {
        // For all operations, try to infer member_id
        const memberId = inferMemberId(action)
        if (memberId) {
          updatedAction.data.member_id = memberId
        } else if (action.operation === 'add') {
          // For add, default to current user
          updatedAction.data.member_id = currentMember?.id
        }
        // For edit/delete, we search by title and show matches with member context
        break
      }
      case 'wishlist_item': {
        // Wishlist items MUST have either child_id or member_id specified
        const childId = inferChildId(action)
        const memberId = inferMemberId(action)

        if (childId) {
          updatedAction.data.child_id = childId
          updatedAction.data.member_id = null
        } else if (memberId) {
          updatedAction.data.member_id = memberId
          updatedAction.data.child_id = null
        } else {
          // Need clarification - show all children and members
          const options = [
            ...children.map(c => ({ label: c.name, value: `child:${c.id}` })),
            ...members.map(m => ({ label: m.name, value: `member:${m.id}` })),
          ]
          return {
            ...updatedAction,
            needsClarification: {
              field: 'person_id',
              question: 'Hvem sin ønskeliste?',
              options,
            },
          }
        }
        break
      }
      case 'navigate': {
        // Navigate actions don't need validation, just execute
        break
      }
    }

    return updatedAction
  }, [children, members, currentMember, inferChildId, inferMemberId])

  const executeAction = useCallback(async (action: ParsedAction) => {
    try {
      // Validate and prepare action (infer IDs, check required fields)
      const preparedAction = validateAndPrepareAction(action)
      if (!preparedAction) {
        setError(t.errors.invalidInput || 'Ugyldig handling')
        return
      }

      // If validation resulted in needing clarification, show it instead of executing
      if (preparedAction.needsClarification && !action.needsClarification) {
        setParsedActions(prev => prev.map(a => a === action ? preparedAction : a))
        return
      }

      // Handle DELETE operations
      if (preparedAction.operation === 'delete') {
        await executeDelete(preparedAction)
        return
      }

      // Handle COMPLETE operations
      if (preparedAction.operation === 'complete') {
        await executeComplete(preparedAction)
        return
      }

      // Handle EDIT operations
      if (preparedAction.operation === 'edit') {
        await executeEdit(preparedAction)
        return
      }

      // Handle ADD/MODIFY operations (existing logic)
      let table = ''
      let record: Record<string, unknown> = {}

      switch (preparedAction.type) {
        case 'meal': {
          table = 'meals'
          record = {
            household_id: householdId,
            date: preparedAction.data.date,
            custom_meal: preparedAction.data.meal_name,
            recipe_id: null, // Clear recipe_id when setting custom meal (match UI behavior)
          }
          break
        }
        case 'child_task': {
          table = 'child_tasks'
          record = {
            household_id: householdId,
            child_id: preparedAction.data.child_id,
            date: preparedAction.data.date,
            time: preparedAction.data.time || null,
            title: preparedAction.data.title,
            task_type: preparedAction.data.task_type || 'reminder',
            status: 'open', // Match UI behavior
            source: 'ai_suggested',
          }
          break
        }
        case 'member_event': {
          table = 'member_events'
          record = {
            household_id: householdId,
            member_id: preparedAction.data.member_id,
            date: preparedAction.data.date,
            end_date: preparedAction.data.end_date || preparedAction.data.date,
            title: preparedAction.data.title,
            event_type: preparedAction.data.event_type || 'other', // Use AI-inferred type
            source: 'ai_suggested',
          }
          break
        }
        case 'pickup': {
          table = 'pickups'
          // For pickup modifications, we need to upsert
          record = {
            household_id: householdId,
            child_id: preparedAction.data.child_id,
            date: preparedAction.data.date,
            picker_id: preparedAction.data.picker_id,
          }
          break
        }
        case 'shopping_item': {
          // Shopping uses a single unified list with per-item categories
          // Always use the main list (sort_order=0, typically "Handleliste")

          // Try to find the main list (sort_order=0)
          let { data: targetList } = await supabase
            .from('shopping_lists')
            .select('id, name')
            .eq('household_id', householdId)
            .eq('is_archived', false)
            .order('sort_order')
            .limit(1)
            .single()

          // Create the main list if it doesn't exist
          if (!targetList) {
            const { data: newList, error: createError } = await supabase
              .from('shopping_lists')
              .insert({ household_id: householdId, name: 'Handleliste', sort_order: 0 })
              .select('id, name')
              .single()
            if (createError) throw createError
            targetList = newList
          }

          // Get category for the item (from cache or API)
          const itemName = preparedAction.data.item_name as string
          const cachedCategory = getCachedCategory(itemName)
          let category: ShoppingCategory = cachedCategory ?? 'other'

          // If not in cache, try the categorization API
          if (!cachedCategory) {
            try {
              const catResponse = await fetch('/api/openrouter/categorize-item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemName }),
              })
              if (catResponse.ok) {
                const catData = await catResponse.json()
                category = catData.category as ShoppingCategory
                // Cache the result for future use
                setCachedCategory(itemName, category)
              }
            } catch {
              // Fallback to 'other' if API fails
            }
          }

          table = 'shopping_list_items'
          record = {
            list_id: targetList.id,
            name: itemName,
            quantity: preparedAction.data.quantity || null,
            is_bought: false,
            category,
          }
          break
        }
        case 'household_event': {
          table = 'household_events'
          record = {
            household_id: householdId,
            title: preparedAction.data.title,
            event_date: preparedAction.data.date,
            end_date: preparedAction.data.end_date || null,
            event_time: preparedAction.data.time || null,
            location: preparedAction.data.location || null,
            source: 'manual',
          }
          break
        }
        case 'wishlist_item': {
          table = 'wishlist_items'
          record = {
            household_id: householdId,
            child_id: preparedAction.data.child_id || null,
            member_id: preparedAction.data.member_id || null,
            name: preparedAction.data.item_name,
            description: preparedAction.data.description || null,
            link: preparedAction.data.link || null,
            price: preparedAction.data.price || null,
            occasion: preparedAction.data.occasion || 'general',
            priority: preparedAction.data.priority || 0,
            status: 'open',
          }
          break
        }
        case 'navigate': {
          // Navigate to the handleliste page (wishlist is at the bottom)
          setParsedActions(prev => prev.filter(a => a !== action))
          router.push('/handleliste')
          return // Don't create any database records
        }
      }

      let result
      if (preparedAction.type === 'pickup') {
        // Always upsert for pickups (one per child per day)
        // Note: unique constraint is on (child_id, date)
        result = await supabase
          .from(table)
          .upsert(record, { onConflict: 'child_id,date' })
          .select('id')
          .single()
      } else if (preparedAction.type === 'meal') {
        // Upsert for meals (one per day)
        result = await supabase
          .from(table)
          .upsert(record, { onConflict: 'household_id,date' })
          .select('id')
          .single()
      } else {
        // Insert for others
        result = await supabase
          .from(table)
          .insert(record)
          .select('id')
          .single()
      }

      if (result.error) {
        console.error('Failed to execute action:', result.error)
        setError(t.errors.saveFailed)
        return
      }

      // Track executed action for undo
      setExecutedActions(prev => [...prev, {
        action: preparedAction,
        undoData: {
          type: 'add',
          table,
          recordId: result.data.id,
        },
        timestamp: Date.now(),
      }])

      // Remove from parsed actions
      setParsedActions(prev => prev.filter(a => a !== action))
      setPendingConfirmation(null)

      // Notify parent and refresh page data
      onActionExecuted?.()
      router.refresh()
    } catch (err) {
      console.error('Execute action error:', err)
      setError(t.errors.saveFailed)
    }
  }, [householdId, supabase, t, onActionExecuted, router, validateAndPrepareAction])

  // Execute DELETE operation with disambiguation
  const executeDelete = useCallback(async (action: ParsedAction) => {
    try {
      // If we already have a specific record_id from clarification, use it directly
      if (action.data.record_id) {
        await executeDeleteById(action)
        return
      }

      // Otherwise, search for matches and handle disambiguation
      let matches: Array<{ id: string; label: string; sublabel: string }> = []

      switch (action.type) {
        case 'meal': {
          // Meals are unique per date, so execute directly
          const date = action.data.date as string
          const { data: meals } = await supabase
            .from('meals')
            .select('*, recipes(name)')
            .eq('household_id', householdId)
            .eq('date', date)
            .limit(1)

          if (meals && meals.length > 0) {
            // Single meal per date - execute directly
            await executeDeleteById({ ...action, data: { ...action.data, record_id: meals[0].id } })
            return
          }
          break
        }
        case 'child_task': {
          let fetchQuery = supabase
            .from('child_tasks')
            .select('*, children(name)')
            .eq('household_id', householdId)

          if (action.data.title) {
            fetchQuery = fetchQuery.ilike('title', `%${action.data.title as string}%`)
          }
          if (action.data.date) {
            fetchQuery = fetchQuery.eq('date', action.data.date as string)
          }
          // Infer child_id if we have child_name
          const childId = inferChildId(action)
          if (childId) {
            fetchQuery = fetchQuery.eq('child_id', childId)
          }

          const { data: tasks } = await fetchQuery.order('date', { ascending: true }).limit(5)
          if (tasks) {
            matches = tasks.map(task => ({
              id: task.id,
              label: task.title,
              sublabel: `${(task.children as { name: string } | null)?.name || ''} - ${formatDisplayDate(task.date)}${task.time ? ` kl ${task.time}` : ''}`,
            }))
          }
          break
        }
        case 'member_event': {
          let fetchQuery = supabase
            .from('member_events')
            .select('*, household_members(name)')
            .eq('household_id', householdId)

          if (action.data.title) {
            fetchQuery = fetchQuery.ilike('title', `%${action.data.title as string}%`)
          }
          if (action.data.date) {
            fetchQuery = fetchQuery.eq('date', action.data.date as string)
          }
          // Infer member_id if we have member_name
          const memberId = inferMemberId(action)
          if (memberId) {
            fetchQuery = fetchQuery.eq('member_id', memberId)
          }

          const { data: events } = await fetchQuery.order('date', { ascending: true }).limit(5)
          if (events) {
            matches = events.map(event => ({
              id: event.id,
              label: event.title,
              sublabel: `${(event.household_members as { name: string } | null)?.name || ''} - ${formatDisplayDate(event.date)}${event.end_date && event.end_date !== event.date ? ` til ${formatDisplayDate(event.end_date)}` : ''}`,
            }))
          }
          break
        }
        case 'pickup': {
          // Pickups are unique per child+date - infer child and execute directly
          const childId = inferChildId(action)
          if (!childId) {
            // Need clarification for child
            const clarificationAction: ParsedAction = {
              ...action,
              needsClarification: {
                field: 'child_id',
                question: 'Hvem sin henting skal fjernes?',
                options: children.map(c => ({ label: c.name, value: c.id })),
              },
            }
            setParsedActions(prev => prev.map(a => a === action ? clarificationAction : a))
            return
          }

          const { data: pickups } = await supabase
            .from('pickups')
            .select('*')
            .eq('household_id', householdId)
            .eq('child_id', childId)
            .eq('date', action.data.date as string)
            .limit(1)

          if (pickups && pickups.length > 0) {
            await executeDeleteById({ ...action, data: { ...action.data, record_id: pickups[0].id, child_id: childId } })
            return
          }
          break
        }
        case 'shopping_item': {
          const { data: lists } = await supabase
            .from('shopping_lists')
            .select('id, name')
            .eq('household_id', householdId)

          if (lists && lists.length > 0) {
            const listIds = lists.map(l => l.id)
            const listNameMap = Object.fromEntries(lists.map(l => [l.id, l.name]))

            let fetchQuery = supabase
              .from('shopping_list_items')
              .select('*')
              .in('list_id', listIds)
              .eq('is_bought', false) // Prefer unbought items

            if (action.data.item_name) {
              fetchQuery = fetchQuery.ilike('name', `%${action.data.item_name as string}%`)
            }

            const { data: items } = await fetchQuery.limit(5)
            if (items) {
              matches = items.map(item => ({
                id: item.id,
                label: item.name,
                sublabel: listNameMap[item.list_id] || '',
              }))
            }
          }
          break
        }
        case 'household_event': {
          let fetchQuery = supabase
            .from('household_events')
            .select('*')
            .eq('household_id', householdId)

          if (action.data.title) {
            fetchQuery = fetchQuery.ilike('title', `%${action.data.title as string}%`)
          }
          if (action.data.date) {
            fetchQuery = fetchQuery.eq('event_date', action.data.date as string)
          }

          const { data: events } = await fetchQuery.order('event_date', { ascending: true }).limit(5)
          if (events) {
            matches = events.map(event => ({
              id: event.id,
              label: event.title,
              sublabel: `${formatDisplayDate(event.event_date)}${event.end_date && event.end_date !== event.event_date ? ` til ${formatDisplayDate(event.end_date)}` : ''}`,
            }))
          }
          break
        }
        case 'wishlist_item': {
          let fetchQuery = supabase
            .from('wishlist_items')
            .select('*, children(name), household_members(name)')
            .eq('household_id', householdId)

          if (action.data.item_name) {
            fetchQuery = fetchQuery.ilike('name', `%${action.data.item_name as string}%`)
          }
          const childId = inferChildId(action)
          const memberId = inferMemberId(action)
          if (childId) {
            fetchQuery = fetchQuery.eq('child_id', childId)
          } else if (memberId) {
            fetchQuery = fetchQuery.eq('member_id', memberId)
          }

          const { data: items } = await fetchQuery.order('created_at', { ascending: false }).limit(5)
          if (items) {
            matches = items.map(item => ({
              id: item.id,
              label: item.name,
              sublabel: `${(item.children as { name: string } | null)?.name || (item.household_members as { name: string } | null)?.name || ''} - ${item.occasion}`,
            }))
          }
          break
        }
      }

      if (matches.length === 0) {
        setError(t.errors.notFound || 'Fant ingen elementer å slette')
        return
      }

      if (matches.length === 1) {
        // Single match - execute directly
        await executeDeleteById({ ...action, data: { ...action.data, record_id: matches[0].id } })
      } else {
        // Multiple matches - ask for clarification
        const clarificationAction: ParsedAction = {
          ...action,
          needsClarification: {
            field: 'record_id',
            question: 'Hvilken vil du slette?',
            options: matches.map(m => ({
              label: m.label,
              value: m.id,
            })),
          },
          display: {
            ...action.display,
            subtitle: matches.map(m => m.sublabel).join(' | '),
          },
        }
        setParsedActions(prev => prev.map(a => a === action ? clarificationAction : a))
      }
    } catch (err) {
      console.error('Delete search error:', err)
      setError(t.errors.saveFailed)
    }
  }, [householdId, supabase, t, children, inferChildId, inferMemberId])

  // Execute DELETE when we have the specific record ID
  const executeDeleteById = useCallback(async (action: ParsedAction) => {
    try {
      const recordId = action.data.record_id as string
      let table = ''
      let deletedRecord: Record<string, unknown> | null = null

      switch (action.type) {
        case 'meal': {
          table = 'meals'
          const { data: meal } = await supabase
            .from('meals')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!meal) throw new Error('Meal not found')
          deletedRecord = meal

          const { error: deleteError } = await supabase.from('meals').delete().eq('id', recordId)
          if (deleteError) throw deleteError
          break
        }
        case 'child_task': {
          table = 'child_tasks'
          const { data: task } = await supabase
            .from('child_tasks')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!task) throw new Error('Task not found')
          deletedRecord = task

          const { error: deleteError } = await supabase.from('child_tasks').delete().eq('id', recordId)
          if (deleteError) throw deleteError
          break
        }
        case 'member_event': {
          table = 'member_events'
          const { data: event } = await supabase
            .from('member_events')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!event) throw new Error('Event not found')
          deletedRecord = event

          const { error: deleteError } = await supabase.from('member_events').delete().eq('id', recordId)
          if (deleteError) throw deleteError
          break
        }
        case 'pickup': {
          table = 'pickups'
          const { data: pickup } = await supabase
            .from('pickups')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!pickup) throw new Error('Pickup not found')
          deletedRecord = pickup

          // For pickup, we clear picker_id instead of deleting
          const { error: updateError } = await supabase
            .from('pickups')
            .update({ picker_id: null })
            .eq('id', recordId)
          if (updateError) throw updateError
          break
        }
        case 'shopping_item': {
          table = 'shopping_list_items'
          const { data: item } = await supabase
            .from('shopping_list_items')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!item) throw new Error('Item not found')
          deletedRecord = item

          const { error: deleteError } = await supabase.from('shopping_list_items').delete().eq('id', recordId)
          if (deleteError) throw deleteError
          break
        }
        case 'household_event': {
          table = 'household_events'
          const { data: householdEvent } = await supabase
            .from('household_events')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!householdEvent) throw new Error('Household event not found')
          deletedRecord = householdEvent

          const { error: deleteError } = await supabase.from('household_events').delete().eq('id', recordId)
          if (deleteError) throw deleteError
          break
        }
        case 'wishlist_item': {
          table = 'wishlist_items'
          const { data: wishlistItem } = await supabase
            .from('wishlist_items')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!wishlistItem) throw new Error('Wishlist item not found')
          deletedRecord = wishlistItem

          const { error: deleteError } = await supabase.from('wishlist_items').delete().eq('id', recordId)
          if (deleteError) throw deleteError
          break
        }
        default:
          throw new Error('Unsupported type')
      }

      // Track as executed with undo data
      setExecutedActions(prev => [...prev, {
        action,
        undoData: {
          type: 'delete',
          table,
          deletedRecords: deletedRecord ? [deletedRecord] : [],
        },
        timestamp: Date.now(),
      }])

      setParsedActions(prev => prev.filter(a => a !== action))
      setPendingConfirmation(null)
      onActionExecuted?.()
      router.refresh()
    } catch (err) {
      console.error('Delete error:', err)
      setError(t.errors.saveFailed)
    }
  }, [supabase, t, onActionExecuted, router])

  // Execute COMPLETE operation with disambiguation
  const executeComplete = useCallback(async (action: ParsedAction) => {
    try {
      // If we already have a specific record_id from clarification, use it directly
      if (action.data.record_id) {
        await executeCompleteById(action)
        return
      }

      // Otherwise, search for matches and handle disambiguation
      let matches: Array<{ id: string; label: string; sublabel: string }> = []

      switch (action.type) {
        case 'child_task': {
          let fetchQuery = supabase
            .from('child_tasks')
            .select('*, children(name)')
            .eq('household_id', householdId)
            .eq('status', 'open')

          if (action.data.title) {
            fetchQuery = fetchQuery.ilike('title', `%${action.data.title as string}%`)
          }
          if (action.data.date) {
            fetchQuery = fetchQuery.eq('date', action.data.date as string)
          }
          // Infer child_id if we have child_name
          const childId = inferChildId(action)
          if (childId) {
            fetchQuery = fetchQuery.eq('child_id', childId)
          }

          const { data: tasks } = await fetchQuery.order('date', { ascending: true }).limit(5)
          if (tasks) {
            matches = tasks.map(task => ({
              id: task.id,
              label: task.title,
              sublabel: `${(task.children as { name: string } | null)?.name || ''} - ${formatDisplayDate(task.date)}${task.time ? ` kl ${task.time}` : ''}`,
            }))
          }
          break
        }
        case 'shopping_item': {
          const { data: lists } = await supabase
            .from('shopping_lists')
            .select('id, name')
            .eq('household_id', householdId)

          if (lists && lists.length > 0) {
            const listIds = lists.map(l => l.id)
            const listNameMap = Object.fromEntries(lists.map(l => [l.id, l.name]))

            let fetchQuery = supabase
              .from('shopping_list_items')
              .select('*')
              .in('list_id', listIds)
              .eq('is_bought', false)

            if (action.data.item_name) {
              fetchQuery = fetchQuery.ilike('name', `%${action.data.item_name as string}%`)
            }

            const { data: items } = await fetchQuery.limit(5)
            if (items) {
              matches = items.map(item => ({
                id: item.id,
                label: item.name,
                sublabel: listNameMap[item.list_id] || '',
              }))
            }
          }
          break
        }
        default:
          setError(t.errors.generic || 'Denne typen kan ikke merkes som ferdig')
          return
      }

      if (matches.length === 0) {
        setError(t.errors.notFound || 'Fant ingen elementer å markere som ferdig')
        return
      }

      if (matches.length === 1) {
        // Single match - execute directly
        await executeCompleteById({ ...action, data: { ...action.data, record_id: matches[0].id } })
      } else {
        // Multiple matches - ask for clarification
        const clarificationAction: ParsedAction = {
          ...action,
          needsClarification: {
            field: 'record_id',
            question: 'Hvilken vil du markere som ferdig?',
            options: matches.map(m => ({
              label: m.label,
              value: m.id,
            })),
          },
          display: {
            ...action.display,
            subtitle: matches.map(m => m.sublabel).join(' | '),
          },
        }
        setParsedActions(prev => prev.map(a => a === action ? clarificationAction : a))
      }
    } catch (err) {
      console.error('Complete search error:', err)
      setError(t.errors.saveFailed)
    }
  }, [householdId, supabase, t, inferChildId])

  // Execute COMPLETE when we have the specific record ID
  const executeCompleteById = useCallback(async (action: ParsedAction) => {
    try {
      const recordId = action.data.record_id as string
      let table = ''
      let previousState: Record<string, unknown> = {}

      switch (action.type) {
        case 'child_task': {
          table = 'child_tasks'
          const { data: task } = await supabase
            .from('child_tasks')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!task) throw new Error('Task not found')
          previousState = { status: task.status, completed_at: task.completed_at }

          const { error: updateError } = await supabase
            .from('child_tasks')
            .update({ status: 'done', completed_at: new Date().toISOString() })
            .eq('id', recordId)
          if (updateError) throw updateError
          break
        }
        case 'shopping_item': {
          table = 'shopping_list_items'
          const { data: item } = await supabase
            .from('shopping_list_items')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!item) throw new Error('Item not found')
          previousState = { is_bought: item.is_bought }

          const { error: updateError } = await supabase
            .from('shopping_list_items')
            .update({ is_bought: true })
            .eq('id', recordId)
          if (updateError) throw updateError
          break
        }
        default:
          throw new Error('Unsupported type')
      }

      // Track as executed with undo data
      setExecutedActions(prev => [...prev, {
        action,
        undoData: {
          type: 'complete',
          table,
          completedRecords: [{ id: recordId, previousState }],
        },
        timestamp: Date.now(),
      }])

      setParsedActions(prev => prev.filter(a => a !== action))
      setPendingConfirmation(null)
      onActionExecuted?.()
      router.refresh()
    } catch (err) {
      console.error('Complete error:', err)
      setError(t.errors.saveFailed)
    }
  }, [supabase, t, onActionExecuted, router])

  // Helper to format date for display
  const formatDisplayDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const weekdays = t.date?.weekdaysShort || ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør']
    return `${weekdays[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}`
  }

  // Execute EDIT operation with disambiguation
  const executeEdit = useCallback(async (action: ParsedAction) => {
    try {
      // If we already have a specific record_id from clarification, use it directly
      if (action.data.record_id) {
        await executeEditById(action)
        return
      }

      // Otherwise, search for matches and handle disambiguation
      let matches: Array<{ id: string; label: string; sublabel: string }> = []
      let table = ''

      switch (action.type) {
        case 'child_task': {
          table = 'child_tasks'
          let fetchQuery = supabase
            .from('child_tasks')
            .select('*, children(name)')
            .eq('household_id', householdId)
            .eq('status', 'open') // Prefer open tasks

          if (action.data.original_title) {
            fetchQuery = fetchQuery.ilike('title', `%${action.data.original_title as string}%`)
          }
          if (action.data.child_id) {
            fetchQuery = fetchQuery.eq('child_id', action.data.child_id as string)
          } else if (action.data.child_name) {
            // Try to infer child_id from name
            const childId = inferChildId(action)
            if (childId) {
              fetchQuery = fetchQuery.eq('child_id', childId)
            }
          }

          const { data: tasks } = await fetchQuery.order('date', { ascending: true }).limit(5)
          if (tasks) {
            matches = tasks.map(task => ({
              id: task.id,
              label: task.title,
              sublabel: `${(task.children as { name: string } | null)?.name || ''} - ${formatDisplayDate(task.date)}${task.time ? ` kl ${task.time}` : ''}`,
            }))
          }
          break
        }
        case 'member_event': {
          table = 'member_events'
          let fetchQuery = supabase
            .from('member_events')
            .select('*, household_members(name)')
            .eq('household_id', householdId)

          if (action.data.original_title) {
            fetchQuery = fetchQuery.ilike('title', `%${action.data.original_title as string}%`)
          }
          if (action.data.member_id) {
            fetchQuery = fetchQuery.eq('member_id', action.data.member_id as string)
          } else if (action.data.member_name) {
            const memberId = inferMemberId(action)
            if (memberId) {
              fetchQuery = fetchQuery.eq('member_id', memberId)
            }
          }

          const { data: events } = await fetchQuery.order('date', { ascending: true }).limit(5)
          if (events) {
            matches = events.map(event => ({
              id: event.id,
              label: event.title,
              sublabel: `${(event.household_members as { name: string } | null)?.name || ''} - ${formatDisplayDate(event.date)}${event.end_date && event.end_date !== event.date ? ` til ${formatDisplayDate(event.end_date)}` : ''}`,
            }))
          }
          break
        }
        case 'meal': {
          table = 'meals'
          const date = (action.data.original_date || action.data.date || formatDateISO(new Date())) as string

          const { data: meals } = await supabase
            .from('meals')
            .select('*, recipes(name)')
            .eq('household_id', householdId)
            .eq('date', date)
            .limit(1)

          if (meals) {
            matches = meals.map(meal => ({
              id: meal.id,
              label: meal.custom_meal || (meal.recipes as { name: string } | null)?.name || 'Middag',
              sublabel: formatDisplayDate(meal.date),
            }))
          }
          break
        }
        case 'shopping_item': {
          table = 'shopping_list_items'
          const { data: lists } = await supabase
            .from('shopping_lists')
            .select('id, name')
            .eq('household_id', householdId)

          if (lists && lists.length > 0) {
            const listIds = lists.map(l => l.id)
            const listNameMap = Object.fromEntries(lists.map(l => [l.id, l.name]))

            let fetchQuery = supabase
              .from('shopping_list_items')
              .select('*')
              .in('list_id', listIds)
              .eq('is_bought', false) // Prefer unbought items

            if (action.data.original_item_name || action.data.item_name) {
              fetchQuery = fetchQuery.ilike('name', `%${(action.data.original_item_name || action.data.item_name) as string}%`)
            }

            const { data: items } = await fetchQuery.limit(5)
            if (items) {
              matches = items.map(item => ({
                id: item.id,
                label: item.name,
                sublabel: listNameMap[item.list_id] || '',
              }))
            }
          }
          break
        }
        case 'household_event': {
          table = 'household_events'
          let fetchQuery = supabase
            .from('household_events')
            .select('*')
            .eq('household_id', householdId)

          if (action.data.original_title) {
            fetchQuery = fetchQuery.ilike('title', `%${action.data.original_title as string}%`)
          }

          const { data: events } = await fetchQuery.order('event_date', { ascending: true }).limit(5)
          if (events) {
            matches = events.map(event => ({
              id: event.id,
              label: event.title,
              sublabel: `${formatDisplayDate(event.event_date)}${event.end_date && event.end_date !== event.event_date ? ` til ${formatDisplayDate(event.end_date)}` : ''}`,
            }))
          }
          break
        }
        case 'wishlist_item': {
          table = 'wishlist_items'
          let fetchQuery = supabase
            .from('wishlist_items')
            .select('*, children(name), household_members(name)')
            .eq('household_id', householdId)

          if (action.data.original_name || action.data.item_name) {
            fetchQuery = fetchQuery.ilike('name', `%${(action.data.original_name || action.data.item_name) as string}%`)
          }
          const childId = inferChildId(action)
          const memberId = inferMemberId(action)
          if (childId) {
            fetchQuery = fetchQuery.eq('child_id', childId)
          } else if (memberId) {
            fetchQuery = fetchQuery.eq('member_id', memberId)
          }

          const { data: items } = await fetchQuery.order('created_at', { ascending: false }).limit(5)
          if (items) {
            matches = items.map(item => ({
              id: item.id,
              label: item.name,
              sublabel: `${(item.children as { name: string } | null)?.name || (item.household_members as { name: string } | null)?.name || ''} - ${item.occasion}`,
            }))
          }
          break
        }
        default:
          setError(t.errors.generic || 'Denne typen kan ikke redigeres')
          return
      }

      if (matches.length === 0) {
        setError(t.errors.notFound || 'Fant ingen elementer å redigere')
        return
      }

      if (matches.length === 1) {
        // Single match - execute directly
        await executeEditById({ ...action, data: { ...action.data, record_id: matches[0].id } })
      } else {
        // Multiple matches - ask for clarification
        const clarificationAction: ParsedAction = {
          ...action,
          needsClarification: {
            field: 'record_id',
            question: 'Hvilken vil du endre?',
            options: matches.map(m => ({
              label: m.label,
              value: m.id,
            })),
          },
          display: {
            ...action.display,
            subtitle: matches.map(m => m.sublabel).join(' | '),
          },
        }
        setParsedActions(prev => prev.map(a => a === action ? clarificationAction : a))
      }
    } catch (err) {
      console.error('Edit search error:', err)
      setError(t.errors.saveFailed)
    }
  }, [householdId, supabase, t, inferChildId, inferMemberId])

  // Execute edit when we have the specific record ID
  const executeEditById = useCallback(async (action: ParsedAction) => {
    try {
      const recordId = action.data.record_id as string
      let table = ''
      let previousState: Record<string, unknown> = {}
      const updates: Record<string, unknown> = {}

      switch (action.type) {
        case 'child_task': {
          table = 'child_tasks'
          const { data: task } = await supabase
            .from('child_tasks')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!task) throw new Error('Task not found')

          previousState = { title: task.title, date: task.date, time: task.time }
          if (action.data.new_title) updates.title = action.data.new_title
          if (action.data.new_date) updates.date = action.data.new_date
          if (action.data.new_time) updates.time = action.data.new_time
          break
        }
        case 'member_event': {
          table = 'member_events'
          const { data: event } = await supabase
            .from('member_events')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!event) throw new Error('Event not found')

          previousState = { title: event.title, date: event.date, end_date: event.end_date, event_type: event.event_type }
          if (action.data.new_title) updates.title = action.data.new_title
          if (action.data.new_date) updates.date = action.data.new_date
          if (action.data.new_end_date) updates.end_date = action.data.new_end_date
          if (action.data.new_event_type) updates.event_type = action.data.new_event_type
          break
        }
        case 'meal': {
          table = 'meals'
          const { data: meal } = await supabase
            .from('meals')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!meal) throw new Error('Meal not found')

          previousState = { date: meal.date, custom_meal: meal.custom_meal, recipe_id: meal.recipe_id }
          if (action.data.new_meal_name) {
            updates.custom_meal = action.data.new_meal_name
            updates.recipe_id = null // Clear recipe when setting custom meal (match UI behavior)
          }
          if (action.data.new_date) updates.date = action.data.new_date
          break
        }
        case 'shopping_item': {
          table = 'shopping_list_items'
          const { data: item } = await supabase
            .from('shopping_list_items')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!item) throw new Error('Item not found')

          previousState = { name: item.name, quantity: item.quantity }
          if (action.data.new_item_name) updates.name = action.data.new_item_name
          if (action.data.new_quantity) updates.quantity = action.data.new_quantity
          break
        }
        case 'household_event': {
          table = 'household_events'
          const { data: householdEvent } = await supabase
            .from('household_events')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!householdEvent) throw new Error('Household event not found')

          previousState = {
            title: householdEvent.title,
            event_date: householdEvent.event_date,
            end_date: householdEvent.end_date,
            event_time: householdEvent.event_time,
            location: householdEvent.location,
          }
          if (action.data.new_title) updates.title = action.data.new_title
          if (action.data.new_date) updates.event_date = action.data.new_date
          if (action.data.new_end_date) updates.end_date = action.data.new_end_date
          if (action.data.new_time) updates.event_time = action.data.new_time
          if (action.data.new_location) updates.location = action.data.new_location
          break
        }
        case 'wishlist_item': {
          table = 'wishlist_items'
          const { data: wishlistItem } = await supabase
            .from('wishlist_items')
            .select('*')
            .eq('id', recordId)
            .single()

          if (!wishlistItem) throw new Error('Wishlist item not found')

          previousState = {
            name: wishlistItem.name,
            description: wishlistItem.description,
            occasion: wishlistItem.occasion,
            priority: wishlistItem.priority,
            price: wishlistItem.price,
            link: wishlistItem.link,
          }
          if (action.data.new_name) updates.name = action.data.new_name
          if (action.data.new_occasion) updates.occasion = action.data.new_occasion
          if (action.data.new_priority !== undefined) updates.priority = action.data.new_priority
          if (action.data.new_description) updates.description = action.data.new_description
          if (action.data.new_price !== undefined) updates.price = action.data.new_price
          if (action.data.new_link) updates.link = action.data.new_link
          break
        }
        default:
          throw new Error('Unsupported type')
      }

      if (Object.keys(updates).length === 0) {
        setError('Ingen endringer spesifisert')
        return
      }

      const { error: updateError } = await supabase.from(table).update(updates).eq('id', recordId)
      if (updateError) throw updateError

      // Track as executed with undo data
      setExecutedActions(prev => [...prev, {
        action,
        undoData: {
          type: 'edit',
          table,
          editedRecords: [{ id: recordId, previousState }],
        },
        timestamp: Date.now(),
      }])

      setParsedActions(prev => prev.filter(a => a !== action))
      setPendingConfirmation(null)
      onActionExecuted?.()
      router.refresh()
    } catch (err) {
      console.error('Edit error:', err)
      setError(t.errors.saveFailed)
    }
  }, [supabase, t, onActionExecuted, router])

  const handleUndo = useCallback(async (executed: ExecutedAction) => {
    try {
      const { undoData } = executed

      switch (undoData.type) {
        case 'add': {
          // Undo add = delete the record we created
          if (undoData.recordId) {
            const { error } = await supabase
              .from(undoData.table)
              .delete()
              .eq('id', undoData.recordId)
            if (error) throw error
          }
          break
        }
        case 'delete': {
          // Undo delete = re-insert the deleted records
          if (undoData.deletedRecords && undoData.deletedRecords.length > 0) {
            // Special case for pickup: we just cleared picker_id, so restore it
            if (executed.action.type === 'pickup') {
              for (const record of undoData.deletedRecords) {
                await supabase
                  .from('pickups')
                  .update({ picker_id: record.picker_id })
                  .eq('id', record.id)
              }
            } else {
              // For other types, re-insert the records
              // Remove 'id' and timestamps that will be regenerated
              const recordsToInsert = undoData.deletedRecords.map(r => {
                const { id, created_at, updated_at, ...rest } = r as Record<string, unknown>
                return rest
              })
              const { error } = await supabase
                .from(undoData.table)
                .insert(recordsToInsert)
              if (error) throw error
            }
          }
          break
        }
        case 'complete': {
          // Undo complete = restore previous state
          if (undoData.completedRecords && undoData.completedRecords.length > 0) {
            for (const record of undoData.completedRecords) {
              await supabase
                .from(undoData.table)
                .update(record.previousState)
                .eq('id', record.id)
            }
          }
          break
        }
        case 'edit': {
          // Undo edit = restore previous state
          if (undoData.editedRecords && undoData.editedRecords.length > 0) {
            for (const record of undoData.editedRecords) {
              await supabase
                .from(undoData.table)
                .update(record.previousState)
                .eq('id', record.id)
            }
          }
          break
        }
      }

      setExecutedActions(prev => prev.filter(e => e !== executed))
      onActionExecuted?.()
      router.refresh()
    } catch (err) {
      console.error('Undo error:', err)
      setError(t.errors.generic || 'Kunne ikke angre')
    }
  }, [supabase, t, onActionExecuted, router])

  const handleActionClick = useCallback((action: ParsedAction) => {
    if (action.needsClarification) {
      // Don't auto-execute if clarification needed
      return
    }

    // Require confirmation for modify, edit, and delete operations
    if (action.operation === 'modify' || action.operation === 'delete' || action.operation === 'edit') {
      setPendingConfirmation(action)
    } else {
      // Execute immediately for add and complete
      executeAction(action)
    }
  }, [executeAction])

  return (
    <div className="space-y-3">
      {/* Input field with image upload */}
      <div className="relative">
        <div className="flex gap-2">
          {/* Image upload button */}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="flex-shrink-0 p-4 rounded-xl flex items-center justify-center transition-colors"
            style={{
              background: selectedImage ? 'var(--accent)' : 'var(--card)',
              border: '1px solid var(--border)',
              color: selectedImage ? 'white' : 'var(--muted)',
            }}
            title="Last opp bilde"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />

          {/* Text input */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            placeholder={t.ai?.inputPlaceholder || 'Middag, henting, søk med ?, eller ta bilde...'}
            className="flex-1 p-4 rounded-xl text-base resize-none"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
              minHeight: '56px',
            }}
            rows={1}
          />
        </div>

        {/* Loading indicator */}
        {isParsing && (
          <div
            className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 px-3 py-1 rounded-full text-sm"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {rateLimitCountdown > 0 && (
          <div
            className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium"
            style={{ background: 'var(--color-honey)', color: 'white' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {rateLimitCountdown}s
          </div>
        )}
      </div>

      {/* Image compressing indicator */}
      {isCompressing && (
        <div
          className="p-3 rounded-xl text-sm flex items-center gap-2"
          style={{ background: 'rgba(126, 182, 196, 0.15)', color: 'var(--color-sky)' }}
        >
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Behandler bilde...
        </div>
      )}

      {/* Image preview */}
      {imagePreview && !isCompressing && (
        <div
          className="relative inline-block rounded-xl overflow-hidden"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
          }}
        >
          <img
            src={imagePreview}
            alt="Valgt bilde"
            className="max-h-32 max-w-full object-contain"
          />
          <button
            type="button"
            onClick={handleRemoveImage}
            className="absolute top-2 right-2 p-1 rounded-full"
            style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}
            title="Fjern bilde"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Rate limit countdown message */}
      {rateLimitCountdown > 0 && (
        <div
          className="p-3 rounded-xl text-sm flex items-center gap-2"
          style={{ background: 'rgba(229, 185, 94, 0.15)', color: 'var(--color-honey)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {t.ai?.parsing || 'Venter'}... {rateLimitCountdown}s
        </div>
      )}

      {/* Error message */}
      {error && !rateLimitCountdown && (
        <div
          className="p-3 rounded-xl text-sm"
          style={{ background: 'rgba(232, 120, 109, 0.1)', color: 'var(--color-coral)' }}
        >
          {error}
        </div>
      )}

      {/* Search results */}
      {responseMode === 'search' && searchAnswer && (
        <div className="space-y-3">
          <div
            className="p-4 rounded-xl"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="flex items-start gap-3">
              <span className="text-xl">🔍</span>
              <div className="flex-1">
                <p style={{ color: 'var(--foreground)' }}>{searchAnswer}</p>
              </div>
            </div>
          </div>

          {/* Search sources */}
          {searchSources.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>Kilder:</p>
              {searchSources.map((source, index) => (
                <div
                  key={index}
                  className="p-3 rounded-lg flex items-start gap-2"
                  style={{
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <span className="text-sm">
                    {source.type === 'task' && '📋'}
                    {source.type === 'event' && '📅'}
                    {source.type === 'recipe' && '🍳'}
                    {source.type === 'meal' && '🍽️'}
                    {source.type === 'message' && '💬'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                      {source.title}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                      {source.excerpt}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Meal suggestions */}
      {responseMode === 'suggest' && mealSuggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
            Middagsforslag:
          </p>
          {mealSuggestions.map((suggestion, index) => {
            const date = new Date(suggestion.day)
            const dayNames = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag']
            const dayName = dayNames[date.getDay()]

            return (
              <div
                key={index}
                className="p-4 rounded-xl"
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                }}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl">🍽️</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                      {suggestion.name}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>
                      {dayName} {date.getDate()}.{date.getMonth() + 1}
                    </p>
                    {suggestion.description && (
                      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                        {suggestion.description}
                      </p>
                    )}
                    {/* Action buttons */}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleAcceptMeal(suggestion)}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1"
                        style={{
                          background: 'var(--accent)',
                          color: 'white',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Legg til
                      </button>
                      <button
                        onClick={() => handleRejectMeal(suggestion)}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium"
                        style={{
                          background: 'var(--background)',
                          border: '1px solid var(--border)',
                          color: 'var(--muted)',
                        }}
                      >
                        Nei takk
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state for suggestions */}
      {responseMode === 'suggest' && mealSuggestions.length === 0 && !isParsing && (
        <div
          className="p-4 rounded-xl text-center"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
          }}
        >
          <p style={{ color: 'var(--muted)' }}>
            Alle hverdager har allerede middager planlagt! 🎉
          </p>
        </div>
      )}

      {/* Parsed actions */}
      {parsedActions.length > 0 && (
        <div className="space-y-2">
          {parsedActions.map((action, index) => (
            <ActionCard
              key={index}
              action={action}
              onClarify={handleClarification}
              onClick={() => handleActionClick(action)}
              isPendingConfirmation={pendingConfirmation === action}
              onConfirm={() => executeAction(action)}
              onCancel={() => setPendingConfirmation(null)}
              t={t}
            />
          ))}
        </div>
      )}

      {/* Confirmation dialog for modifications */}
      {pendingConfirmation && !parsedActions.includes(pendingConfirmation) && (
        <ActionCard
          action={pendingConfirmation}
          onClarify={handleClarification}
          onClick={() => {}}
          isPendingConfirmation={true}
          onConfirm={() => executeAction(pendingConfirmation)}
          onCancel={() => setPendingConfirmation(null)}
          t={t}
        />
      )}

      {/* Executed actions with undo */}
      {executedActions.length > 0 && (
        <div className="space-y-2">
          {executedActions.map((executed, index) => (
            <SuccessCard
              key={index}
              executed={executed}
              onUndo={() => handleUndo(executed)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ActionCardProps {
  action: ParsedAction
  onClarify: (action: ParsedAction, field: string, value: string | null, resultType?: ActionType) => void
  onClick: () => void
  isPendingConfirmation: boolean
  onConfirm: () => void
  onCancel: () => void
  t: ReturnType<typeof useLanguage>['t']
}

function ActionCard({ action, onClarify, onClick, isPendingConfirmation, onConfirm, onCancel, t }: ActionCardProps) {
  const needsClarification = action.needsClarification

  return (
    <div
      className="p-4 rounded-xl"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl">{action.display.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium" style={{ color: 'var(--foreground)' }}>
            {action.display.title}
          </p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {action.display.subtitle}
          </p>

          {/* Clarification buttons */}
          {needsClarification && (
            <div className="mt-3">
              <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
                {needsClarification.question}
              </p>
              <div className="flex flex-wrap gap-2">
                {needsClarification.options.map((option, i) => (
                  <button
                    key={i}
                    onClick={() => onClarify(action, needsClarification.field, option.value, option.resultType as ActionType)}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    style={{
                      background: 'var(--background)',
                      border: '1px solid var(--border)',
                      color: 'var(--foreground)',
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Confirmation for modifications */}
          {isPendingConfirmation && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={onConfirm}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                {t.common.confirm}
              </button>
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ color: 'var(--muted)' }}
              >
                {t.common.cancel}
              </button>
            </div>
          )}
        </div>

        {/* Quick action button - different styling per operation type */}
        {!needsClarification && !isPendingConfirmation && (
          <>
            {/* Add operation */}
            {action.operation === 'add' && (
              <button
                onClick={onClick}
                className="px-4 py-2 rounded-lg font-medium text-sm transition-colors"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                {t.ai?.add || 'Legg til'}
              </button>
            )}

            {/* Modify operation */}
            {action.operation === 'modify' && (
              <button
                onClick={onClick}
                className="px-4 py-2 rounded-lg font-medium text-sm transition-colors"
                style={{ background: 'var(--color-honey)', color: 'white' }}
              >
                {t.ai?.change || 'Endre'}
              </button>
            )}

            {/* Edit operation */}
            {action.operation === 'edit' && (
              <button
                onClick={onClick}
                className="px-4 py-2 rounded-lg font-medium text-sm transition-colors"
                style={{ background: 'var(--color-lavender)', color: 'white' }}
              >
                {t.ai?.edit || 'Rediger'}
              </button>
            )}

            {/* Delete operation */}
            {action.operation === 'delete' && (
              <button
                onClick={onClick}
                className="px-4 py-2 rounded-lg font-medium text-sm transition-colors"
                style={{ background: 'var(--color-coral)', color: 'white' }}
              >
                {t.ai?.delete || 'Slett'}
              </button>
            )}

            {/* Complete operation */}
            {action.operation === 'complete' && (
              <button
                onClick={onClick}
                className="px-4 py-2 rounded-lg font-medium text-sm transition-colors"
                style={{ background: 'var(--color-sage)', color: 'white' }}
              >
                {t.ai?.complete || 'Ferdig'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface SuccessCardProps {
  executed: ExecutedAction
  onUndo: () => void
  t: ReturnType<typeof useLanguage>['t']
}

function SuccessCard({ executed, onUndo, t }: SuccessCardProps) {
  const { action, undoData } = executed

  // Get operation-appropriate status message
  const getStatusMessage = () => {
    switch (action.operation) {
      case 'add':
        return t.ai?.added || 'Lagt til'
      case 'modify':
        return t.ai?.changed || 'Endret'
      case 'edit':
        return t.ai?.edited || 'Redigert'
      case 'delete':
        return t.ai?.deleted || 'Slettet'
      case 'complete':
        return t.ai?.completed || 'Markert som ferdig'
      default:
        return t.ai?.added || 'Lagt til'
    }
  }

  // Get count of affected records for multi-record operations
  const getAffectedCount = () => {
    if (undoData.deletedRecords && undoData.deletedRecords.length > 1) {
      return ` (${undoData.deletedRecords.length})`
    }
    if (undoData.completedRecords && undoData.completedRecords.length > 1) {
      return ` (${undoData.completedRecords.length})`
    }
    return ''
  }

  // Different styling based on operation type
  const isDelete = action.operation === 'delete'
  const isEdit = action.operation === 'edit'
  const bgColor = isDelete
    ? 'rgba(232, 120, 109, 0.15)'
    : isEdit
      ? 'rgba(174, 156, 200, 0.15)'
      : 'rgba(134, 168, 128, 0.15)'
  const borderColor = isDelete
    ? 'var(--color-coral)'
    : isEdit
      ? 'var(--color-lavender)'
      : 'var(--color-sage)'
  const textColor = isDelete
    ? 'var(--color-coral)'
    : isEdit
      ? 'var(--color-lavender)'
      : 'var(--color-sage)'
  const icon = isDelete ? '🗑️' : isEdit ? '✏️' : '✓'

  return (
    <div
      className="p-3 rounded-xl flex items-center gap-3"
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
      }}
    >
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: textColor }}>
          {getStatusMessage()}{getAffectedCount()}: {action.display.title}
        </p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {action.display.subtitle}
        </p>
      </div>
      <button
        onClick={onUndo}
        className="px-3 py-1 rounded-lg text-sm font-medium transition-colors"
        style={{
          background: 'var(--background)',
          color: 'var(--muted)',
        }}
      >
        {t.ai?.undo || 'Angre'}
      </button>
    </div>
  )
}
