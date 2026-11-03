import {
  IconAlertTriangle,
  IconArrowsSort,
  IconCalendar,
  IconCalendarEvent,
  IconCalendarPlus,
  IconCategory,
  IconChevronLeft,
  IconChevronRight,
  IconFilterOff,
  IconMapPin,
  IconMoodKid,
  IconPencil,
  IconMovie,
  IconPhoto,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button as AriaButton, Input, SearchField } from 'react-aria-components'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useCategories, useChildren } from '../../api/queries'
import type { CategoryOut, ChildOut, EventSummaryOut } from '../../api/schema.gen'
import { Avatar, AvatarGroup } from '../../components/Avatar'
import { Button, LinkButton } from '../../components/Button'
import { CategoryBadge, CategoryBadgeGroup } from '../../components/CategoryBadge'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import fieldStyles from '../../components/Field.module.css'
import { IconButton } from '../../components/IconButton'
import { PageHeader } from '../../components/PageHeader'
import { Select } from '../../components/Select'
import { LoadingState, Spinner } from '../../components/Spinner'
import { cx } from '../../components/utils'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../../i18n'
import { parseRange } from '../../search/useTimelineFilters'
import { categoriesById, categoryName, pickCategories } from '../../utils/categories'
import { mediaCount } from '../../utils/mediaCount'
import { useDocumentTitle } from '../../utils/useDocumentTitle'
import { DragHandle, MoveButtons, OrderStatusText, SortableList, type SortableControls } from '../categories/SortableList'
import { EVENTS_PAGE_SIZE, useAdminEvents, useDayOrder, useDeleteEvent } from './adminEventsApi'
import { DateRangeButton } from './DateRangeButton'
import { groupByDay } from './dayOrder'
import { parseId } from './eventForm'
import styles from './EventsPage.module.css'
import { RingThumb } from './RingThumb'

const SEARCH_DEBOUNCE_MS = 300
const ALL = 'all'

/** Search box that updates the URL after a short pause (Enter applies it at once). */
function SearchInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)
  const timer = useRef<number | undefined>(undefined)

  // The URL changed from outside (back/forward, "clear filters"): show its value.
  if (value !== committed) {
    setCommitted(value)
    if (value !== draft.trim()) setDraft(value)
  }

  useEffect(() => {
    const pending = timer
    return () => window.clearTimeout(pending.current)
  }, [])

  function commit(next: string) {
    window.clearTimeout(timer.current)
    onCommit(next.trim())
  }

  return (
    <SearchField
      aria-label={t('adminEvents.toolbar.search')}
      value={draft}
      onChange={(next) => {
        setDraft(next)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => onCommit(next.trim()), SEARCH_DEBOUNCE_MS)
      }}
      onSubmit={commit}
      onClear={() => commit('')}
      className={cx(fieldStyles.field, styles.search)}
    >
      <div className={fieldStyles.control}>
        <span className={fieldStyles.leadingIcon}>
          <IconSearch size={18} aria-hidden="true" />
        </span>
        <Input className={cx(fieldStyles.input, styles.searchInput)} placeholder={t('adminEvents.toolbar.searchPlaceholder')} />
        <AriaButton className={styles.clear} aria-label={t('adminEvents.toolbar.clearSearch')}>
          <IconX size={16} aria-hidden="true" />
        </AriaButton>
      </div>
    </SearchField>
  )
}

interface RowProps {
  item: EventSummaryOut
  categories: CategoryOut[]
  people: ChildOut[]
  returnTo: string
  onDelete: (item: EventSummaryOut) => void
  /** Rows of a same-day group: drag handle, move buttons and a row action instead of links. */
  sortable?: SortableControls
}

/** Thumbnail, title, details, chips and actions of an event row. */
function EventRowContent({ item, categories, people, returnTo, onDelete, sortable }: RowProps) {
  const { t, formatDate } = useI18n()
  const navigate = useNavigate()
  const href = `/admin/events/${item.id}`
  const editLabel = t('adminEvents.list.edit', { title: item.title })
  return (
    <>
      {sortable && (
        <span className={styles.handle}>
          <DragHandle label={t('adminEvents.dayOrder.drag', { title: item.title })} />
        </span>
      )}
      <RingThumb
        className={styles.thumb}
        src={item.cover?.thumb_url}
        placeholder={item.cover?.dominant_color}
        categories={categories}
        size={60}
      />
      <div className={styles.main}>
        {sortable ? (
          <span className={styles.title} title={item.title}>
            {item.title}
          </span>
        ) : (
          <Link to={href} state={{ from: returnTo }} className={cx(styles.title, styles.stretched)} title={item.title}>
            {item.title}
          </Link>
        )}
        <p className={styles.meta}>
          <span className={styles.metaItem}>
            <IconCalendar size={15} aria-hidden="true" />
            <time dateTime={item.date}>{formatDate(item.date, 'medium')}</time>
          </span>
          {item.location && (
            <span className={cx(styles.metaItem, styles.location)}>
              <IconMapPin size={15} aria-hidden="true" />
              <span className={styles.ellipsis}>{item.location}</span>
            </span>
          )}
          <span className={styles.metaItem}>
            {item.video_count > 0 ? <IconMovie size={15} aria-hidden="true" /> : <IconPhoto size={15} aria-hidden="true" />}
            {mediaCount(t, item.image_count, item.video_count)}
          </span>
        </p>
      </div>
      <div className={styles.chips}>
        {categories.length > 0 && <CategoryBadgeGroup categories={categories} max={3} size={26} />}
        {people.length > 0 && (
          <AvatarGroup people={people.map((child) => ({ id: child.id, name: child.name, image: child.avatar }))} max={3} size={28} />
        )}
      </div>
      <div className={styles.actions}>
        {sortable ? (
          <>
            <MoveButtons
              controls={sortable}
              earlierLabel={t('adminEvents.dayOrder.earlier', { title: item.title })}
              laterLabel={t('adminEvents.dayOrder.later', { title: item.title })}
            />
            <IconButton size="sm" icon={IconPencil} label={editLabel} onPress={() => navigate(href, { state: { from: returnTo } })} />
          </>
        ) : (
          <Link to={href} state={{ from: returnTo }} className={styles.iconLink} aria-label={editLabel}>
            <IconPencil size={18} aria-hidden="true" />
          </Link>
        )}
        <IconButton
          variant="danger"
          size="sm"
          icon={IconTrash}
          label={t('adminEvents.list.delete', { title: item.title })}
          onPress={() => onDelete(item)}
        />
      </div>
    </>
  )
}

function EventRow(props: RowProps) {
  return (
    <li className={styles.row}>
      <EventRowContent {...props} />
    </li>
  )
}

interface DayGroupProps extends Omit<RowProps, 'item' | 'categories' | 'people' | 'sortable'> {
  date: string
  items: EventSummaryOut[]
  categoryMap: ReadonlyMap<number, CategoryOut>
  childMap: ReadonlyMap<number, ChildOut>
  onReorder: (ids: number[]) => void
}

/** Events of the same date: drag (or move) them to choose which one comes first on the timeline. */
function DayGroup({ date, items, categoryMap, childMap, returnTo, onDelete, onReorder }: DayGroupProps) {
  const { t, formatDate } = useI18n()
  const navigate = useNavigate()
  const day = formatDate(date, 'medium')
  return (
    <li className={styles.dayGroup}>
      <p className={styles.dayHeader}>
        <IconArrowsSort size={16} aria-hidden="true" className={styles.dayIcon} />
        <span className={styles.dayTitle}>{t('adminEvents.dayOrder.title', { date: day })}</span>
        <span className={styles.dayHint}>{t('adminEvents.dayOrder.hint')}</span>
      </p>
      <SortableList
        aria-label={t('adminEvents.dayOrder.label', { date: day })}
        items={items}
        textValue={(item) => item.title}
        onReorder={onReorder}
        onAction={(item) => navigate(`/admin/events/${item.id}`, { state: { from: returnTo } })}
        describeMove={(item, position, total) => t('adminEvents.dayOrder.moved', { title: item.title, position, total })}
        itemClassName={styles.dayItem}
      >
        {(item, controls) => (
          <div className={cx(styles.row, styles.sortableRow)}>
            <EventRowContent
              item={item}
              categories={pickCategories(item.category_ids, categoryMap)}
              people={item.child_ids.flatMap((id) => childMap.get(id) ?? [])}
              returnTo={returnTo}
              onDelete={onDelete}
              sortable={controls}
            />
          </div>
        )}
      </SortableList>
    </li>
  )
}

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const { t } = useI18n()
  if (pages <= 1) return null
  return (
    <nav className={styles.pagination} aria-label={t('adminEvents.pagination.label')}>
      <Button variant="secondary" size="sm" icon={IconChevronLeft} isDisabled={page <= 1} onPress={() => onPage(page - 1)}>
        {t('adminEvents.pagination.previous')}
      </Button>
      <span className={styles.pageInfo} aria-current="page">
        {t('adminEvents.pagination.page', { page, pages })}
      </span>
      <Button variant="secondary" size="sm" iconEnd={IconChevronRight} isDisabled={page >= pages} onPress={() => onPage(page + 1)}>
        {t('adminEvents.pagination.next')}
      </Button>
    </nav>
  )
}

/** `/admin/events`: searchable, filterable, paginated list of events (newest first). */
export function EventsPage() {
  const { t, lang, formatNumber } = useI18n()
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const childId = parseId(searchParams.get('child'))
  const categoryId = parseId(searchParams.get('cat'))
  const [from, to] = parseRange(searchParams.get('from'), searchParams.get('to'))
  const page = parseId(searchParams.get('page')) ?? 1
  const children = useChildren()
  const categories = useCategories()
  const listParams = { q, childId, categoryId, from, to, page, pageSize: EVENTS_PAGE_SIZE }
  const events = useAdminEvents(listParams)
  const dayOrder = useDayOrder(listParams)
  const deletion = useDeleteEvent()
  const [toDelete, setToDelete] = useState<EventSummaryOut | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useDocumentTitle(t('admin.nav.events'), t('admin.title'))

  const categoryMap = useMemo(() => categoriesById(categories.data), [categories.data])
  const childMap = useMemo(() => new Map((children.data ?? []).map((child) => [child.id, child])), [children.data])
  const hasFilters = Boolean(q || childId || categoryId || from || to)
  const data = events.data
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / EVENTS_PAGE_SIZE))
  const returnTo = `${location.pathname}${location.search}`

  function updateParams(changes: Record<string, string | null>, { resetPage = true, replace = true } = {}) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        if (resetPage) next.delete('page')
        return next
      },
      { replace },
    )
  }

  // A page past the end (e.g. after deleting its last event): jump to the last existing page.
  const outOfRange = data !== undefined && !events.isPlaceholderData && data.items.length === 0 && page > 1 && total > 0
  useEffect(() => {
    if (!outOfRange) return
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (pages > 1) next.set('page', String(pages))
        else next.delete('page')
        return next
      },
      { replace: true },
    )
  }, [outOfRange, pages, setSearchParams])

  function goToPage(next: number) {
    // Pages are history entries (Back returns to the previous page); filters replace the entry.
    updateParams({ page: next > 1 ? String(next) : null }, { resetPage: false, replace: false })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const childOptions = [
    { value: ALL, label: t('adminEvents.toolbar.allChildren'), icon: IconMoodKid },
    ...(children.data ?? []).map((child) => ({
      value: String(child.id),
      label: child.name,
      icon: <Avatar name={child.name} image={child.avatar} size={22} decorative />,
    })),
  ]
  const categoryOptions = [
    { value: ALL, label: t('adminEvents.toolbar.allCategories'), icon: IconCategory },
    ...(categories.data ?? []).map((category) => ({
      value: String(category.id),
      label: categoryName(category, lang),
      icon: <CategoryBadge category={category} size={22} decorative />,
    })),
  ]

  const newEventHref = childId ? `/admin/events/new?child=${childId}` : '/admin/events/new'

  let content
  if (events.isPending) {
    content = <LoadingState message={t('adminEvents.list.loading')} />
  } else if (events.isError && !data) {
    content = (
      <EmptyState
        icon={IconAlertTriangle}
        tone="error"
        title={t('adminEvents.list.loadError')}
        description={errorMessage(events.error)}
        actions={
          <Button variant="primary" onPress={() => void events.refetch()}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  } else if (total === 0 && hasFilters) {
    content = (
      <EmptyState
        icon={IconFilterOff}
        title={t('adminEvents.noResults.title')}
        description={t('adminEvents.noResults.description')}
        actions={
          <Button
            variant="primary"
            icon={IconFilterOff}
            onPress={() => updateParams({ q: null, child: null, cat: null, from: null, to: null })}
          >
            {t('adminEvents.noResults.action')}
          </Button>
        }
      />
    )
  } else if (total === 0) {
    content = (
      <EmptyState
        icon={IconCalendarEvent}
        title={t('adminEvents.empty.title')}
        description={t('adminEvents.empty.description')}
        actions={
          <LinkButton href={newEventHref} variant="primary" icon={IconCalendarPlus}>
            {t('adminEvents.empty.action')}
          </LinkButton>
        }
      />
    )
  } else {
    const items = data?.items ?? []
    const first = (page - 1) * EVENTS_PAGE_SIZE + 1
    const last = first + items.length - 1
    const askDelete = (target: EventSummaryOut) => {
      setToDelete(target)
      setConfirmOpen(true)
    }
    content = (
      <>
        <div className={styles.listHeader}>
          <p className={styles.total} aria-live="polite">
            {t('adminEvents.list.total', { count: total })}
            {pages > 1 && items.length > 0 && (
              <span className={styles.range}>
                {' · '}
                {t('adminEvents.list.range', { from: formatNumber(first), to: formatNumber(last), total: formatNumber(total) })}
              </span>
            )}
          </p>
          <span className={styles.listStatus}>
            <OrderStatusText status={dayOrder.status} savingLabel={t('adminEvents.dayOrder.saving')} savedLabel={t('adminEvents.dayOrder.saved')} />
            {events.isFetching && <Spinner size="sm" label={t('common.loading')} />}
          </span>
        </div>
        <ul className={cx(styles.list, events.isPlaceholderData && styles.listStale)} aria-label={t('adminEvents.list.label')}>
          {groupByDay(items).map((group) =>
            group.length > 1 ? (
              <DayGroup
                key={`day-${group[0].date}`}
                date={group[0].date}
                items={group}
                categoryMap={categoryMap}
                childMap={childMap}
                returnTo={returnTo}
                onDelete={askDelete}
                onReorder={(ids) => dayOrder.reorder(group[0].date, ids)}
              />
            ) : (
              <EventRow
                key={group[0].id}
                item={group[0]}
                categories={pickCategories(group[0].category_ids, categoryMap)}
                people={group[0].child_ids.flatMap((id) => childMap.get(id) ?? [])}
                returnTo={returnTo}
                onDelete={askDelete}
              />
            ),
          )}
        </ul>
        <Pagination page={page} pages={pages} onPage={goToPage} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        icon={IconCalendarEvent}
        title={t('admin.nav.events')}
        description={t('adminEvents.description')}
        actions={
          <LinkButton href={newEventHref} variant="primary" icon={IconCalendarPlus}>
            {t('adminEvents.newEvent')}
          </LinkButton>
        }
      />

      <div className={styles.toolbarWrap}>
        <div className={styles.toolbar} role="search" aria-label={t('adminEvents.toolbar.label')}>
          <SearchInput value={q} onCommit={(value) => updateParams({ q: value || null })} />
          <Select
            aria-label={t('adminEvents.toolbar.child')}
            options={childOptions}
            value={childId && childMap.has(childId) ? String(childId) : ALL}
            onChange={(value) => updateParams({ child: value === ALL ? null : value })}
            className={styles.filter}
          />
          <Select
            aria-label={t('adminEvents.toolbar.category')}
            options={categoryOptions}
            value={categoryId && categoryMap.has(categoryId) ? String(categoryId) : ALL}
            onChange={(value) => updateParams({ cat: value === ALL ? null : value })}
            className={styles.filter}
          />
          <DateRangeButton
            from={from}
            to={to}
            onChange={(nextFrom, nextTo) => {
              const [start, end] = parseRange(nextFrom, nextTo)
              updateParams({ from: start, to: end })
            }}
            className={styles.filter}
          />
        </div>
      </div>

      {content}

      <ConfirmDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('adminEvents.delete.title')}
        confirmLabel={t('adminEvents.delete.confirm')}
        onConfirm={async () => {
          if (!toDelete) return
          await deletion.mutateAsync(toDelete.id)
          toast.show({
            tone: 'success',
            message: t('adminEvents.delete.done', { title: toDelete.title }),
            action: { label: t('adminEvents.delete.viewTrash'), to: '/admin/trash' },
          })
        }}
      >
        {t('adminEvents.delete.message', { title: toDelete?.title ?? '' })}
      </ConfirmDialog>
    </>
  )
}
