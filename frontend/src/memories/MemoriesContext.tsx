import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { EMPTY_FILTERS, qk, useMemoriesState, useTimeline } from '../api/queries'
import type { MemoriesOut, MemoriesSeenIn, TimelineEventOut } from '../api/schema.gen'
import { FAMILY_PATH, useCurrentChild } from '../contexts/CurrentChildContext'
import { useToday } from '../utils/useToday'
import { memoriesOn, type Memory } from './memories'

export interface MemoriesValue {
  /** Today on the device's calendar (`YYYY-MM-DD`). */
  today: string
  /** Every milestone of the family, newest first (null until loaded, which waits until needed). */
  events: readonly TimelineEventOut[] | null
  /** Today's memories (null until the milestones are loaded). */
  memories: readonly Memory[] | null
  /** Why the milestones could not be loaded. */
  error: unknown
  retry: () => void
  /** Today's memories this account has not looked at yet (0 while unknown). */
  unseen: number
  /** Today has memories this account was neither told about nor looked at. */
  announce: boolean
  markAnnounced: () => void
  markOpened: () => void
  /** The panel of today's memories (opening it counts them as seen). */
  isOpen: boolean
  setOpen: (isOpen: boolean) => void
  /** Where a memory opens: over the timeline on screen when it is there, else over its first child's. */
  hrefOf: (event: TimelineEventOut) => string
}

const MemoriesContext = createContext<MemoriesValue | null>(null)

function later(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a == null) return b ?? null
  return b != null && b > a ? b : a
}

function reached(day: string | null | undefined, today: string): boolean {
  return day != null && day >= today
}

/**
 * Today's memories for the timeline pages. The family's milestones are only loaded while they are
 * needed: until this account has looked at today's memories (for the count and the notice) and
 * while the panel is open. Being told about them and looking at them is saved for the account, so
 * every device knows (failing to save only means hearing about them again).
 */
export function MemoriesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const today = useToday()
  const state = useMemoriesState()
  const [isOpen, setIsOpen] = useState(false)
  const { child, children: family, isAll, timelinePath } = useCurrentChild()

  const opened = reached(state.data?.opened_on, today)
  const announced = reached(state.data?.announced_on, today)
  const timeline = useTimeline('all', EMPTY_FILTERS, { enabled: isOpen || (state.isSuccess && !opened) })
  const events = timeline.data?.events ?? null
  const memories = useMemo(() => (events ? memoriesOn(events, today) : null), [events, today])

  const save = useCallback(
    (change: MemoriesSeenIn) => {
      const merge = (current: MemoriesOut | undefined, saved: MemoriesSeenIn): MemoriesOut => ({
        announced_on: later(current?.announced_on, saved.announced_on),
        opened_on: later(current?.opened_on, saved.opened_on),
      })
      void queryClient.cancelQueries({ queryKey: qk.memories })
      queryClient.setQueryData<MemoriesOut>(qk.memories, (current) => merge(current, change))
      api.post<MemoriesOut>('/api/memories/seen', change).then(
        (saved) => queryClient.setQueryData<MemoriesOut>(qk.memories, (current) => merge(current, saved)),
        () => undefined,
      )
    },
    [queryClient],
  )
  const markAnnounced = useCallback(() => save({ announced_on: today }), [save, today])
  const markOpened = useCallback(() => {
    if (!opened) save({ opened_on: today })
  }, [save, today, opened])
  const setOpen = useCallback(
    (next: boolean) => {
      setIsOpen(next)
      if (next) markOpened()
    },
    [markOpened],
  )

  const hrefOf = useCallback(
    (event: TimelineEventOut) => {
      const here = isAll || (child !== null && event.child_ids.includes(child.id))
      const owner = family.find((item) => event.child_ids.includes(item.id))
      const base = here && timelinePath ? timelinePath : owner ? `/c/${owner.slug}` : (timelinePath ?? FAMILY_PATH)
      return `${base}/e/${event.id}?zoom=events&focus=e${event.id}`
    },
    [isAll, child, family, timelinePath],
  )

  const { error, refetch } = timeline
  const retry = useCallback(() => void refetch(), [refetch])
  const unseen = state.isSuccess && !opened ? (memories?.length ?? 0) : 0
  const value = useMemo<MemoriesValue>(
    () => ({
      today,
      events,
      memories,
      error: memories === null ? error : null,
      retry,
      unseen,
      announce: unseen > 0 && !announced,
      markAnnounced,
      markOpened,
      isOpen,
      setOpen,
      hrefOf,
    }),
    [today, events, memories, error, retry, unseen, announced, markAnnounced, markOpened, isOpen, setOpen, hrefOf],
  )
  return <MemoriesContext value={value}>{children}</MemoriesContext>
}

export function useMemories(): MemoriesValue {
  const context = use(MemoriesContext)
  if (!context) throw new Error('useMemories must be used inside <MemoriesProvider>')
  return context
}
