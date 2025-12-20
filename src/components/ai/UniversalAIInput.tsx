'use client'

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import type { ParsedAction, ActionType } from '@/app/api/openrouter/parse-action/route'
import { formatDateISO } from '@/lib/utils'

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

interface ExecutedAction {
  action: ParsedAction
  table: string
  recordId: string
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

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  const parseInput = useCallback(async (text: string) => {
    if (text.trim().length < 3) {
      setParsedActions([])
      return
    }

    // Don't parse while rate limited
    if (rateLimitCountdown > 0) {
      pendingInputRef.current = text
      return
    }

    setIsParsing(true)
    setError(null)
    // Clear executed actions when typing new input
    setExecutedActions([])

    try {
      const today = formatDateISO(new Date())
      const response = await fetch('/api/openrouter/parse-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
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

      const data = await response.json()
      setParsedActions(data.actions || [])
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
      parseInput(text)
    }, 600)
  }, [parseInput])

  const handleClarification = useCallback((action: ParsedAction, field: string, value: string | null, resultType?: ActionType) => {
    // Update the action with the clarified value
    const updatedAction: ParsedAction = {
      ...action,
      type: resultType || action.type,
      data: { ...action.data, [field]: value },
      needsClarification: undefined,
    }

    // If it's a modification, ask for confirmation
    if (updatedAction.operation === 'modify') {
      setPendingConfirmation(updatedAction)
    } else {
      // Execute immediately for additions
      executeAction(updatedAction)
    }

    // Remove from parsed actions
    setParsedActions(prev => prev.filter(a => a !== action))
  }, [])

  const executeAction = useCallback(async (action: ParsedAction) => {
    try {
      let table = ''
      let record: Record<string, unknown> = {}

      switch (action.type) {
        case 'meal': {
          table = 'meals'
          record = {
            household_id: householdId,
            date: action.data.date,
            custom_meal: action.data.meal_name,
            recipe_id: null, // Clear recipe_id when setting custom meal (match UI behavior)
          }
          break
        }
        case 'child_task': {
          table = 'child_tasks'
          record = {
            household_id: householdId,
            child_id: action.data.child_id,
            date: action.data.date,
            time: action.data.time || null,
            title: action.data.title,
            task_type: action.data.task_type || 'reminder',
            source: 'ai_suggested',
          }
          break
        }
        case 'member_event': {
          table = 'member_events'
          const memberId = action.data.member_id || currentMember?.id
          record = {
            household_id: householdId,
            member_id: memberId,
            date: action.data.date,
            end_date: action.data.end_date || action.data.date,
            title: action.data.title,
            event_type: 'work',
            source: 'ai_suggested',
          }
          break
        }
        case 'pickup': {
          table = 'pickups'
          // For pickup modifications, we need to upsert
          const pickerId = action.data.picker_id || currentMember?.id
          record = {
            household_id: householdId,
            child_id: action.data.child_id,
            date: action.data.date,
            picker_id: pickerId,
          }
          break
        }
        case 'shopping_item': {
          // Shopping uses shopping_lists + shopping_list_items (same schema as handleliste page)
          // Determine which list to use based on list_type (produce or other)
          const listType = (action.data.list_type as string) || 'produce'
          const isProduceList = listType === 'produce'
          const targetListName = isProduceList ? t.shopping.aisles.produce : t.shopping.aisles.other
          const targetSortOrder = isProduceList ? 0 : 1

          // Try to find existing list by sort_order (produce=0, other=1)
          let { data: targetList } = await supabase
            .from('shopping_lists')
            .select('id, name')
            .eq('household_id', householdId)
            .eq('sort_order', targetSortOrder)
            .limit(1)
            .single()

          // If no list with matching sort_order, try finding by name
          if (!targetList) {
            const { data: listByName } = await supabase
              .from('shopping_lists')
              .select('id, name')
              .eq('household_id', householdId)
              .eq('name', targetListName)
              .limit(1)
              .single()
            targetList = listByName
          }

          // Create the list if it doesn't exist
          if (!targetList) {
            const { data: newList, error: createError } = await supabase
              .from('shopping_lists')
              .insert({ household_id: householdId, name: targetListName, sort_order: targetSortOrder })
              .select('id')
              .single()
            if (createError) throw createError
            targetList = newList
          }

          table = 'shopping_list_items'
          record = {
            list_id: targetList.id,
            name: action.data.item_name,
            quantity: action.data.quantity || null,
            is_bought: false,
          }
          break
        }
      }

      let result
      if (action.type === 'pickup') {
        // Always upsert for pickups (one per child per day)
        // Note: unique constraint is on (child_id, date)
        result = await supabase
          .from(table)
          .upsert(record, { onConflict: 'child_id,date' })
          .select('id')
          .single()
      } else if (action.type === 'meal') {
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
        action,
        table,
        recordId: result.data.id,
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
  }, [householdId, currentMember, supabase, t, onActionExecuted, router])

  const handleUndo = useCallback(async (executed: ExecutedAction) => {
    try {
      const { error } = await supabase
        .from(executed.table)
        .delete()
        .eq('id', executed.recordId)

      if (error) {
        console.error('Undo failed:', error)
        setError('Kunne ikke angre')
        return
      }

      setExecutedActions(prev => prev.filter(e => e !== executed))
      onActionExecuted?.()
      router.refresh()
    } catch (err) {
      console.error('Undo error:', err)
      setError('Kunne ikke angre')
    }
  }, [supabase, onActionExecuted, router])

  const handleActionClick = useCallback((action: ParsedAction) => {
    if (action.needsClarification) {
      // Don't auto-execute if clarification needed
      return
    }

    if (action.operation === 'modify') {
      setPendingConfirmation(action)
    } else {
      executeAction(action)
    }
  }, [executeAction])

  return (
    <div className="space-y-3">
      {/* Input field */}
      <div className="relative">
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          placeholder={t.ai?.inputPlaceholder || 'Middag, henting, oppgave...'}
          className="w-full p-4 rounded-xl text-base resize-none"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
            minHeight: '56px',
          }}
          rows={1}
        />
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
              action={executed.action}
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

        {/* Quick action button (only if no clarification needed and not a modification) */}
        {!needsClarification && !isPendingConfirmation && action.operation !== 'modify' && (
          <button
            onClick={onClick}
            className="px-4 py-2 rounded-lg font-medium text-sm transition-colors"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {t.ai?.add || 'Legg til'}
          </button>
        )}

        {/* For modifications, show "Endre" button */}
        {!needsClarification && !isPendingConfirmation && action.operation === 'modify' && (
          <button
            onClick={onClick}
            className="px-4 py-2 rounded-lg font-medium text-sm transition-colors"
            style={{ background: 'var(--color-honey)', color: 'white' }}
          >
            {t.ai?.change || 'Endre'}
          </button>
        )}
      </div>
    </div>
  )
}

interface SuccessCardProps {
  action: ParsedAction
  onUndo: () => void
  t: ReturnType<typeof useLanguage>['t']
}

function SuccessCard({ action, onUndo, t }: SuccessCardProps) {
  return (
    <div
      className="p-3 rounded-xl flex items-center gap-3"
      style={{
        background: 'rgba(134, 168, 128, 0.15)',
        border: '1px solid var(--color-sage)',
      }}
    >
      <span className="text-lg">✓</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--color-sage)' }}>
          {t.ai?.added || 'Lagt til'}: {action.display.title}
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
