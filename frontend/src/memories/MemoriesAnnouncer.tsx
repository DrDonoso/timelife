import { useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router'
import { useCategories } from '../api/queries'
import { RingThumb } from '../components/RingThumb'
import { MILESTONE_PATH } from '../contexts/CurrentChildContext'
import { useToast } from '../contexts/ToastContext'
import { useI18n } from '../i18n'
import { categoriesById, pickCategories } from '../utils/categories'
import { useWhatsNewQuiet } from '../whatsNew/WhatsNewLayout'
import { useMemories } from './MemoriesContext'

/** Pause before the notice, so that it does not arrive together with the page. */
export const ANNOUNCE_DELAY_MS = 600
/** How long the notice stays (it waits while pointed at or focused). */
const ANNOUNCE_DURATION_MS = 10_000

/**
 * Tells the user about today's memories, once a day on any of their devices: a notice with the
 * first one's picture whose «Ver» opens it (or the panel, when there are several). It waits until
 * what's new has nothing more to show and no milestone is open over the timeline.
 */
export function MemoriesAnnouncer() {
  const { t } = useI18n()
  const { show } = useToast()
  const { pathname } = useLocation()
  const quiet = useWhatsNewQuiet()
  const categories = useCategories()
  const byId = useMemo(() => categoriesById(categories.data), [categories.data])
  const { today, memories, announce, markAnnounced, markOpened, setOpen, hrefOf } = useMemories()
  // The day already told in this page (its saving may still be on its way).
  const told = useRef<string | null>(null)
  const ready = announce && quiet && !MILESTONE_PATH.test(pathname)

  useEffect(() => {
    const [first, ...others] = memories ?? []
    if (!ready || !first || told.current === today) return
    const timer = window.setTimeout(() => {
      told.current = today
      markAnnounced()
      const { event } = first
      const ago = t(`memories.ago.${first.unit}`, { count: first.count })
      const label = t('memories.toast.action')
      show({
        message:
          others.length === 0
            ? t('memories.toast.single', { ago, title: event.title })
            : t('memories.toast.several', { ago, title: event.title, count: others.length }),
        media: (
          <RingThumb
            src={event.cover?.thumb_url}
            placeholder={event.cover?.dominant_color}
            categories={pickCategories(event.category_ids, byId)}
            size={40}
          />
        ),
        action: others.length === 0 ? { label, to: hrefOf(event), onPress: markOpened } : { label, onPress: () => setOpen(true) },
        duration: ANNOUNCE_DURATION_MS,
      })
    }, ANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [ready, today, memories, t, show, byId, hrefOf, markAnnounced, markOpened, setOpen])

  return null
}
