'use client'

import { useState, useCallback, useTransition } from 'react'

interface UseOptimisticOptions<T> {
  initialValue: T
  onUpdate: (newValue: T) => Promise<void>
  onError?: (error: unknown, previousValue: T) => void
}

/**
 * Hook for optimistic UI updates
 * Updates the UI immediately, then syncs with the server
 * Reverts on error
 */
export function useOptimistic<T>({
  initialValue,
  onUpdate,
  onError,
}: UseOptimisticOptions<T>) {
  const [value, setValue] = useState<T>(initialValue)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<unknown>(null)

  const update = useCallback(
    (newValue: T) => {
      const previousValue = value
      setError(null)

      // Update UI immediately (optimistic)
      setValue(newValue)

      // Sync with server in background
      startTransition(async () => {
        try {
          await onUpdate(newValue)
        } catch (err) {
          // Revert on error
          setValue(previousValue)
          setError(err)
          onError?.(err, previousValue)
        }
      })
    },
    [value, onUpdate, onError]
  )

  return {
    value,
    update,
    isPending,
    error,
  }
}

/**
 * Simplified hook for boolean toggles
 */
export function useOptimisticToggle({
  initialValue,
  onToggle,
  onError,
}: {
  initialValue: boolean
  onToggle: (newValue: boolean) => Promise<void>
  onError?: (error: unknown) => void
}) {
  const { value, update, isPending, error } = useOptimistic({
    initialValue,
    onUpdate: onToggle,
    onError: onError ? (err) => onError(err) : undefined,
  })

  const toggle = useCallback(() => {
    update(!value)
  }, [value, update])

  return {
    checked: value,
    toggle,
    isPending,
    error,
  }
}

/**
 * Hook for optimistic list item updates (e.g., checking off items)
 */
export function useOptimisticList<T extends { id: string }>({
  initialItems,
  onUpdateItem,
  onError,
}: {
  initialItems: T[]
  onUpdateItem: (item: T) => Promise<void>
  onError?: (error: unknown, item: T) => void
}) {
  const [items, setItems] = useState<T[]>(initialItems)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  const updateItem = useCallback(
    async (updatedItem: T) => {
      const previousItems = items
      const previousItem = items.find((i) => i.id === updatedItem.id)

      // Update UI immediately
      setItems((prev) =>
        prev.map((item) => (item.id === updatedItem.id ? updatedItem : item))
      )
      setPendingIds((prev) => new Set(prev).add(updatedItem.id))

      try {
        await onUpdateItem(updatedItem)
      } catch (err) {
        // Revert on error
        setItems(previousItems)
        if (previousItem) {
          onError?.(err, previousItem)
        }
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev)
          next.delete(updatedItem.id)
          return next
        })
      }
    },
    [items, onUpdateItem, onError]
  )

  const isItemPending = useCallback(
    (id: string) => pendingIds.has(id),
    [pendingIds]
  )

  return {
    items,
    setItems,
    updateItem,
    isItemPending,
  }
}
