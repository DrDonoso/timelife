import { useQueryClient } from '@tanstack/react-query'
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Heading } from 'react-aria-components'
import { useLocation, useNavigate, useParams } from 'react-router'
import { isApiError } from '../api/client'
import { invalidateEventQueries, qk, useEvent } from '../api/queries'
import type { EventOut } from '../api/schema.gen'
import { Modal } from '../components/Modal'
import { LoadingState } from '../components/Spinner'
import { cx } from '../components/utils'
import { useAuth } from '../contexts/AuthContext'
import { useCurrentChild } from '../contexts/CurrentChildContext'
import { useI18n } from '../i18n'
import { DetailError, DetailNotFound, DetailSkeleton } from './DetailStates'
import { EditorBoundary } from './EditorBoundary'
import { LazyEventEditor as EventEditor, preloadEditor } from './editorLoader'
import { EventCard } from './EventCard'
import styles from './EventDetailRoute.module.css'
import { LeaveEditorGuard } from './LeaveEditorGuard'
import { MODAL_EXIT_DELAY_MS as EXIT_DELAY_MS, parseEventId, previousEntryIs, readOriginRect } from './detailUtils'

/** `…/e/:eventId` under a child's timeline or the family one: the event detail card over it (spec 40 "Event detail card"). */
export function EventDetailRoute() {
  const { eventId } = useParams()
  const { timelinePath } = useCurrentChild()
  const base = timelinePath ?? '/'
  // Moving to another event (e.g. through the history) starts a fresh card.
  return <EventDetail key={`${base}/${eventId ?? ''}`} timelinePath={base} eventId={parseEventId(eventId)} />
}

interface EventDetailProps {
  /** The timeline under the card (`/c/<slug>` or `/all`). */
  timelinePath: string
  /** `null` for malformed ids (shown as "not found" without asking the API). */
  eventId: number | null
}

function EventDetail({ timelinePath, eventId }: EventDetailProps) {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isAdmin } = useAuth()
  const { child, isAll } = useCurrentChild()
  const query = useEvent(eventId)
  const [originRect] = useState(() => readOriginRect(location.state))
  const [isOpen, setIsOpen] = useState(true)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  // Unsaved changes in the editor: only then does leaving (e.g. browser Back) ask first.
  const [dirty, setDirty] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const closeTimerRef = useRef(0)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const editorHeadingRef = useRef<HTMLHeadingElement>(null)
  const refocusEditButtonRef = useRef(false)

  const event = query.data
  const notFound = eventId === null || (query.isError && isApiError(query.error) && query.error.status === 404)
  const editing = mode === 'edit' && isAdmin && event !== undefined && !notFound

  const { pathname, search } = location
  const leave = useCallback(() => {
    const timeline = `${timelinePath}${search}`
    // Opened from the timeline: stepping back returns there without leaving the card in the history.
    if (previousEntryIs(timeline, `${pathname}${search}`)) navigate(-1)
    else navigate({ pathname: timelinePath, search }, { replace: true })
  }, [timelinePath, pathname, search, navigate])

  const close = useCallback(() => {
    if (closeTimerRef.current) return
    setIsOpen(false)
    closeTimerRef.current = window.setTimeout(leave, EXIT_DELAY_MS)
  }, [leave])

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), [])

  const title = event?.title
  const childName = isAll ? t('timeline.family.name') : child?.name
  useEffect(() => {
    if (!title) return
    const previous = document.title
    document.title = [title, childName, 'Timelife'].filter(Boolean).join(' · ')
    return () => {
      document.title = previous
    }
  }, [title, childName])

  const startEdit = useCallback(() => {
    preloadEditor()
    setAnnouncement('')
    setDirty(false)
    setMode('edit')
  }, [])

  const backToCard = useCallback(() => {
    refocusEditButtonRef.current = true
    setDirty(false)
    setMode('view')
  }, [])

  const handleSaved = useCallback(
    (saved: EventOut) => {
      // Show the saved version right away; the refetches confirm it (and refresh the timeline).
      // The editor itself shows the success toast; the toast region sits outside the modal (hidden
      // from assistive tech while it is open), so the dialog announces the save too.
      queryClient.setQueryData(qk.event(saved.id), saved)
      void invalidateEventQueries(queryClient, saved.id)
      backToCard()
      setAnnouncement(t('detail.saved'))
    },
    [queryClient, backToCard, t],
  )

  // Keyboard focus follows the mode switch: editor title in, pencil button out.
  useEffect(() => {
    if (editing) {
      editorHeadingRef.current?.focus()
    } else if (refocusEditButtonRef.current) {
      refocusEditButtonRef.current = false
      editButtonRef.current?.focus()
    }
  }, [editing])

  let content: ReactNode
  if (notFound) {
    content = <DetailNotFound onClose={close} />
  } else if (!event) {
    content = query.isError ? (
      <DetailError error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} onClose={close} />
    ) : (
      <DetailSkeleton onClose={close} />
    )
  } else if (editing) {
    content = (
      <div className={styles.editor}>
        <Heading slot="title" ref={editorHeadingRef} tabIndex={-1} className="visually-hidden">
          {t('detail.editing', { title: event.title })}
        </Heading>
        <EditorBoundary onBack={backToCard}>
          <Suspense fallback={<LoadingState fill message={t('common.loading')} />}>
            <EventEditor
              eventId={event.id}
              variant="modal"
              onSaved={handleSaved}
              onCancel={backToCard}
              onDirtyChange={setDirty}
            />
          </Suspense>
        </EditorBoundary>
        <LeaveEditorGuard when={dirty} />
      </div>
    )
  } else {
    content = (
      <EventCard
        event={event}
        onClose={close}
        onEdit={isAdmin ? startEdit : undefined}
        onEditIntent={preloadEditor}
        editButtonRef={editButtonRef}
      />
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      size="xl"
      fullScreenOnMobile
      bleed={!editing}
      borderless
      hideCloseButton
      originRect={originRect}
      // While editing, only the editor's own buttons leave (no accidental loss of changes).
      isDismissable={!editing}
      isKeyboardDismissDisabled={editing}
      swipeToClose={!editing}
      className={cx(styles.modal, editing && styles.editing)}
    >
      {content}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </Modal>
  )
}
