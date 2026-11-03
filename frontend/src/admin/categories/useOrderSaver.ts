import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage } from '../../i18n'

export type OrderStatus = 'idle' | 'saving' | 'saved' | 'error'

interface Ordered {
  id: number
  sort_order: number
}

/** `list` in the order of `ids` with `sort_order` renumbered (unknown ids are skipped). */
export function reorderList<T extends Ordered>(list: readonly T[], ids: readonly number[]): T[] {
  const byId = new Map(list.map((item) => [item.id, item]))
  return ids.flatMap((id, index) => {
    const item = byId.get(id)
    if (!item) return []
    return [item.sort_order === index ? item : { ...item, sort_order: index }]
  })
}

export interface OrderSaverOptions {
  /** Query holding the ordered list (updated optimistically). */
  queryKey: QueryKey
  /** `PUT` endpoint receiving `{ ids }` and answering the saved list. */
  path: string
  /** Extra queries to refresh once the order is saved. */
  related?: readonly QueryKey[]
}

const NO_RELATED: readonly QueryKey[] = []
const SAVED_VISIBLE_MS = 2500

/**
 * Optimistic reordering. The list updates at once; requests are serialised and coalesced (only
 * the latest order is sent after the one in flight), so fast consecutive moves can't land on the
 * server out of order. On failure the error is shown and the list is refetched.
 */
export function useOrderSaver<T extends Ordered>({ queryKey, path, related = NO_RELATED }: OrderSaverOptions) {
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const [status, setStatus] = useState<OrderStatus>('idle')
  const queued = useRef<number[] | null>(null)
  const running = useRef(false)
  const savedTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(savedTimer.current), [])

  async function flush() {
    running.current = true
    window.clearTimeout(savedTimer.current)
    setStatus('saving')
    try {
      while (queued.current) {
        const ids = queued.current
        queued.current = null
        const saved = await api.put<T[]>(path, { ids })
        // A newer order is waiting: keep showing it rather than this intermediate answer.
        if (!queued.current && Array.isArray(saved)) queryClient.setQueryData(queryKey, saved)
      }
      setStatus('saved')
      savedTimer.current = window.setTimeout(
        () => setStatus((current) => (current === 'saved' ? 'idle' : current)),
        SAVED_VISIBLE_MS,
      )
    } catch (error) {
      queued.current = null
      setStatus('error')
      show({ tone: 'error', message: errorMessage(error) })
    } finally {
      running.current = false
      void queryClient.invalidateQueries({ queryKey })
      for (const key of related) void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  function reorder(ids: number[]) {
    void queryClient.cancelQueries({ queryKey })
    const current = queryClient.getQueryData<T[]>(queryKey)
    if (current) queryClient.setQueryData(queryKey, reorderList(current, ids))
    queued.current = ids
    if (!running.current) void flush()
  }

  return { reorder, status }
}
