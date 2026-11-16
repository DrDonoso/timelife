import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import { api } from '../api/client'
import { qk, useWhatsNew } from '../api/queries'
import type { WhatsNewOut } from '../api/schema.gen'
import { useAuth } from '../contexts/AuthContext'
import { NOTES, byKind, isVisibleTo, type Note } from './notes'
import { AllNotesDialog, NewsDialog } from './WhatsNewDialog'

/** Ids saved per request (the API takes up to 500). */
const BATCH = 500
/** A milestone open over the timeline (its detail, or a new one): the news wait until it closes. */
const MILESTONE_PATH = /^\/(c\/[^/]+|all)\/(e\/[^/]+|new)\/?$/

interface Plan {
  /** What to tell the user, in the order shown. */
  readonly news: readonly Note[]
  /** Every note they have not read, theirs or not: all of them count as read afterwards. */
  readonly unread: readonly string[]
}

function planFor({ seen }: WhatsNewOut, isAdmin: boolean): Plan {
  // A new user has nothing to catch up on: only what comes later is news to them.
  if (seen === null) return { news: [], unread: NOTES.map((note) => note.id) }
  const read = new Set(seen)
  const unread = NOTES.filter((note) => !read.has(note.id))
  return {
    news: byKind(unread.filter((note) => isVisibleTo(note, isAdmin))),
    unread: unread.map((note) => note.id),
  }
}

export interface WhatsNewProps {
  /** The list of every note (the account menu's «Novedades»). */
  allOpen: boolean
  onAllOpenChange: (isOpen: boolean) => void
}

/**
 * Tells the signed-in user what is new since they last looked. Once the notes they have read are
 * known, the unread ones meant for them open in a dialog; closing it (or the list of every note)
 * counts every unread note as read, as does having none meant for them (notes for
 * administrators, for a viewer). Failing to save that only means seeing them again next time.
 */
export function WhatsNew({ allOpen, onAllOpenChange }: WhatsNewProps) {
  const { isAdmin } = useAuth()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const seen = useWhatsNew()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [news, setNews] = useState<'pending' | 'open' | 'closed'>('pending')
  const allNotes = useMemo(() => NOTES.filter((note) => isVisibleTo(note, isAdmin)), [isAdmin])

  // Decided from the first answer: the cached one changes as the notes are marked as read.
  if (plan === null && seen.data) setPlan(planFor(seen.data, isAdmin))
  if (plan && plan.news.length > 0 && news === 'pending' && !allOpen && !MILESTONE_PATH.test(pathname)) {
    setNews('open')
  }

  const markRead = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return
      queryClient.setQueryData<WhatsNewOut>(qk.whatsNew, (current) => ({
        seen: [...new Set([...(current?.seen ?? []), ...ids])].toSorted(),
      }))
      for (let start = 0; start < ids.length; start += BATCH) {
        api.post('/api/whats-new/seen', { ids: ids.slice(start, start + BATCH) }).catch(() => undefined)
      }
    },
    [queryClient],
  )

  const done = plan !== null && (plan.news.length === 0 || news === 'closed')
  useEffect(() => {
    if (done && plan) markRead(plan.unread)
  }, [done, plan, markRead])

  return (
    <>
      <NewsDialog isOpen={news === 'open'} onClose={() => setNews('closed')} notes={plan?.news ?? []} />
      <AllNotesDialog
        isOpen={allOpen}
        onClose={() => {
          onAllOpenChange(false)
          // They have just seen every note.
          setNews('closed')
        }}
        notes={allNotes}
      />
    </>
  )
}
