import { IconArrowLeft, IconCalendarOff, IconCalendarPlus, IconPencil } from '@tabler/icons-react'
import { useMemo } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useChildren } from '../../api/queries'
import type { ChildOut } from '../../api/schema.gen'
import { LinkButton } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { defaultChild } from '../../contexts/CurrentChildContext'
import { useI18n } from '../../i18n'
import { useDocumentTitle } from '../../utils/useDocumentTitle'
import { useAdminEvent } from './adminEventsApi'
import { EventEditor } from './EventEditor'
import styles from './EventEditorPage.module.css'
import { parseId } from './eventForm'

/** `?child=<id>` (or a slug), else the remembered child (falls back to the first one). */
function initialChildren(children: readonly ChildOut[], param: string | null): number[] {
  const requested = children.find((child) => child.id === parseId(param) || (param !== null && child.slug === param))
  const child = requested ?? defaultChild(children)
  return child ? [child.id] : []
}

/** Where "back" goes: the events list the admin came from (keeps its filters), else the list. */
function returnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from
  return typeof from === 'string' && /^\/admin\/events(\?|$)/.test(from) ? from : '/admin/events'
}

/** `/admin/events/new` and `/admin/events/:eventId`: the event editor with page chrome. */
export function EventEditorPage() {
  const { t } = useI18n()
  const { eventId: rawId } = useParams()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const children = useChildren()
  const eventId = rawId === undefined ? undefined : parseId(rawId)
  const isEdit = rawId !== undefined
  const event = useAdminEvent(eventId ?? undefined)
  const backTo = returnPath(location.state)
  const title = isEdit ? t('adminEvents.editor.editTitle') : t('adminEvents.editor.newTitle')
  const childParam = searchParams.get('child')
  const defaultChildIds = useMemo(() => initialChildren(children.data ?? [], childParam), [children.data, childParam])

  useDocumentTitle(isEdit ? (event.data?.title ?? title) : title, t('admin.title'))

  const back = () => navigate(backTo)

  return (
    <>
      <Link to={backTo} className={styles.back}>
        <IconArrowLeft size={18} aria-hidden="true" />
        {t('adminEvents.editor.back')}
      </Link>
      <PageHeader
        icon={isEdit ? IconPencil : IconCalendarPlus}
        title={title}
        description={isEdit ? event.data?.title : t('adminEvents.editor.newDescription')}
      />
      {isEdit && eventId === null ? (
        <EmptyState
          icon={IconCalendarOff}
          title={t('adminEvents.editor.notFound.title')}
          description={t('adminEvents.editor.notFound.description')}
          actions={
            <LinkButton href="/admin/events" variant="primary">
              {t('adminEvents.editor.back')}
            </LinkButton>
          }
        />
      ) : (
        <EventEditor
          eventId={eventId ?? undefined}
          defaultChildIds={defaultChildIds}
          variant="page"
          onSaved={back}
          onCancel={back}
        />
      )}
    </>
  )
}
