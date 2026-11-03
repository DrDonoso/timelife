import { useQueryClient } from '@tanstack/react-query'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, type To } from 'react-router'
import { useChildren } from '../api/queries'
import type { EventOut } from '../api/schema.gen'
import { Modal } from '../components/Modal'
import { LoadingState } from '../components/Spinner'
import { cx } from '../components/utils'
import { useAuth } from '../contexts/AuthContext'
import { useCurrentChild } from '../contexts/CurrentChildContext'
import { useI18n } from '../i18n'
import { MODAL_EXIT_DELAY_MS, previousEntryIs } from './detailUtils'
import { EditorBoundary } from './EditorBoundary'
import { LazyEventEditor } from './editorLoader'
import styles from './EventDetailRoute.module.css'
import { LeaveEditorGuard } from './LeaveEditorGuard'

/** `search` of a timeline showing `eventId` at the days level (filters and other parameters kept). */
export function focusSearch(search: string, eventId: number): string {
  const params = new URLSearchParams(search)
  params.set('zoom', 'events')
  params.set('focus', `e${eventId}`)
  return `?${params.toString().replace(/%2C/gi, ',')}`
}

/**
 * `…/new` over a child's timeline (that child chosen) or the family one (no child chosen yet): the
 * event editor in a modal over the timeline. Administrators only (others go back to the timeline).
 */
export function NewEventRoute() {
  const { search } = useLocation()
  const { isAdmin } = useAuth()
  const { timelinePath } = useCurrentChild()
  const base = timelinePath ?? '/'
  if (!isAdmin) return <Navigate to={{ pathname: base, search }} replace />
  return <NewEvent timelinePath={base} />
}

function NewEvent({ timelinePath }: { timelinePath: string }) {
  const { t } = useI18n()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { child, isAll } = useCurrentChild()
  const children = useChildren()
  const [isOpen, setIsOpen] = useState(true)
  // Unsaved changes: only then does leaving (e.g. browser Back) ask first.
  const [dirty, setDirty] = useState(false)
  const closeTimer = useRef(0)
  const closing = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      window.clearTimeout(closeTimer.current)
    }
  }, [])

  const leave = useCallback(
    (target: To | null) => {
      if (target) navigate(target, { replace: true })
      // Opened from the timeline: stepping back returns there without leaving this entry behind.
      else if (previousEntryIs(`${timelinePath}${search}`, `${pathname}${search}`)) navigate(-1)
      else navigate({ pathname: timelinePath, search }, { replace: true })
    },
    [timelinePath, pathname, search, navigate],
  )

  /** Closes the modal now; once it has animated out and `ready` has settled, goes to `target`. */
  const close = useCallback(
    (target: To | null = null, ready?: Promise<unknown>) => {
      if (closing.current) return
      // Leaving on purpose (saved, or changes discarded): the guard must not ask again, not even
      // from the closing modal, which keeps its last props (`when` too) until it is gone.
      closing.current = true
      setDirty(false)
      setIsOpen(false)
      const exited = new Promise((resolve) => {
        closeTimer.current = window.setTimeout(resolve, MODAL_EXIT_DELAY_MS)
      })
      void Promise.all([exited, ready?.catch(() => undefined)]).then(() => {
        // Already elsewhere (Back, a link…): stay there.
        if (mounted.current) leave(target)
      })
    },
    [leave],
  )

  const handleSaved = useCallback(
    (saved: EventOut) => {
      // The new milestone pulses on the timeline: this one when it shows there (the family one
      // shows every milestone), else the timeline of a child it was saved for.
      const own = isAll || (child !== null && saved.child_ids.includes(child.id))
      const other = children.data?.find((item) => saved.child_ids.includes(item.id))
      const path = own || !other ? timelinePath : `/c/${other.slug}`
      // The editor goes away at once; the focus is applied once the timeline holds the new event.
      const refreshed = queryClient.refetchQueries({ queryKey: ['timeline'], type: 'active' })
      close({ pathname: path, search: focusSearch(own ? search : '', saved.id) }, refreshed)
    },
    [child, isAll, timelinePath, children.data, close, queryClient, search],
  )

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      aria-label={t('timeline.create.title')}
      size="xl"
      fullScreenOnMobile
      hideCloseButton
      // With unsaved changes only the editor's own buttons leave (no accidental loss).
      isDismissable={!dirty}
      isKeyboardDismissDisabled={dirty}
      className={cx(styles.modal, styles.editing)}
    >
      <div className={styles.editor}>
        <EditorBoundary onBack={() => close()}>
          <Suspense fallback={<LoadingState fill message={t('common.loading')} />}>
            <LazyEventEditor
              variant="modal"
              defaultChildIds={child ? [child.id] : []}
              onSaved={handleSaved}
              onCancel={() => close()}
              onDirtyChange={setDirty}
            />
          </Suspense>
        </EditorBoundary>
        <LeaveEditorGuard when={dirty} allowLeave={closing} />
      </div>
    </Modal>
  )
}
