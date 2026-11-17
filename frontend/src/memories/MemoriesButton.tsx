import { IconAlertTriangle, IconCalendarHeart, IconHistory } from '@tabler/icons-react'
import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { Dialog, DialogTrigger, Heading, Popover } from 'react-aria-components'
import { Link, useNavigate } from 'react-router'
import { useCategories } from '../api/queries'
import type { CategoryOut, TimelineEventOut } from '../api/schema.gen'
import { AvatarGroup } from '../components/Avatar'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import overlay from '../components/Overlay.module.css'
import { RingThumb } from '../components/RingThumb'
import { LoadingState } from '../components/Spinner'
import { cx } from '../components/utils'
import { useCurrentChild } from '../contexts/CurrentChildContext'
import { useI18n } from '../i18n'
import { categoriesById, pickCategories } from '../utils/categories'
import styles from './Memories.module.css'
import { nextMemories, type Memory, type MemoryAge } from './memories'
import { useMemories } from './MemoriesContext'

/** Memories of the next day listed when today has none. */
const NEXT_SHOWN = 3

type CategoryMap = ReadonlyMap<number, CategoryOut>

/** «hace 1 año» → «Hace 1 año», as a heading. */
function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

interface AgeGroup {
  readonly age: MemoryAge
  readonly memories: Memory[]
}

/** Consecutive memories of the same age together (they come sorted by age). */
function byAge(memories: readonly Memory[]): AgeGroup[] {
  const groups: AgeGroup[] = []
  for (const memory of memories) {
    const last = groups.at(-1)
    if (last && last.age.unit === memory.unit && last.age.count === memory.count) last.memories.push(memory)
    else groups.push({ age: memory, memories: [memory] })
  }
  return groups
}

interface MemoryItemProps {
  event: TimelineEventOut
  byId: CategoryMap
  /** Its link was followed: the panel closes. */
  onOpen: () => void
}

/** A memory: its milestone's picture, title, date and children, opening it over the timeline. */
function MemoryItem({ event, byId, onOpen }: MemoryItemProps) {
  const { formatDate } = useI18n()
  const navigate = useNavigate()
  const { hrefOf } = useMemories()
  const { children } = useCurrentChild()
  const href = hrefOf(event)
  const people = children.filter((child) => event.child_ids.includes(child.id))

  function open(click: MouseEvent<HTMLAnchorElement>) {
    // A new tab or window opens the browser's own way.
    if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return
    click.preventDefault()
    // The milestone's card grows from its picture, as from the timeline.
    const rect = click.currentTarget.querySelector(`.${CSS.escape(styles.thumb)}`)?.getBoundingClientRect()
    const originRect = rect && rect.width > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined
    onOpen()
    void navigate(href, { state: originRect ? { originRect } : undefined })
  }

  return (
    <li>
      <Link to={href} className={styles.memory} onClick={open}>
        <RingThumb
          src={event.cover?.thumb_url}
          placeholder={event.cover?.dominant_color}
          categories={pickCategories(event.category_ids, byId)}
          size={44}
          className={styles.thumb}
        />
        <span className={styles.text}>
          <span className={styles.memoryTitle}>{event.title}</span>
          <time className={styles.memoryDate} dateTime={event.date}>
            {formatDate(event.date, 'long')}
          </time>
        </span>
        {people.length > 0 && (
          <AvatarGroup
            people={people.map((child) => ({ id: child.id, name: child.name, image: child.avatar }))}
            size={24}
            className={styles.people}
          />
        )}
      </Link>
    </li>
  )
}

/** Today without memories: the next day that has some, and its first ones. */
function NoMemories({ events, today, byId, onOpen }: { events: readonly TimelineEventOut[]; today: string; byId: CategoryMap; onOpen: () => void }) {
  const { t, formatDate } = useI18n()
  const next = useMemo(() => nextMemories(events, today), [events, today])
  return (
    <>
      <div className={styles.state}>
        <IconCalendarHeart size={28} stroke={1.6} aria-hidden="true" className={styles.stateIcon} />
        <p className={styles.stateTitle}>{t('memories.empty')}</p>
        {!next && <p>{t('memories.none')}</p>}
      </div>
      {next && (
        <div className={styles.group}>
          <p className={styles.next}>{t('memories.next', { count: next.memories.length, date: formatDate(next.day, 'long') })}</p>
          <ul role="list" className={styles.list}>
            {next.memories.slice(0, NEXT_SHOWN).map(({ event }) => (
              <MemoryItem key={event.id} event={event} byId={byId} onOpen={onOpen} />
            ))}
          </ul>
          {next.memories.length > NEXT_SHOWN && (
            <p className={styles.more}>{t('memories.nextMore', { count: next.memories.length - NEXT_SHOWN })}</p>
          )}
        </div>
      )}
    </>
  )
}

function MemoriesPanel({ close }: { close: () => void }) {
  const { t, formatDate, locale } = useI18n()
  const { today, events, memories, error, retry } = useMemories()
  const categories = useCategories()
  const byId = useMemo(() => categoriesById(categories.data), [categories.data])

  let body: ReactNode
  if (events === null || memories === null) {
    body = error ? (
      <div className={cx(styles.state, styles.error)}>
        <IconAlertTriangle size={24} stroke={2} aria-hidden="true" className={styles.stateIcon} />
        <p role="alert">{t('memories.error')}</p>
        <Button size="sm" onPress={retry}>
          {t('common.retry')}
        </Button>
      </div>
    ) : (
      <LoadingState message={t('memories.loading')} className={styles.loading} />
    )
  } else if (memories.length === 0) {
    body = <NoMemories events={events} today={today} byId={byId} onOpen={close} />
  } else {
    body = byAge(memories).map(({ age, memories: group }) => (
      <div key={`${age.unit}-${age.count}`} className={styles.group}>
        <h3 className={styles.age}>{capitalize(t(`memories.ago.${age.unit}`, { count: age.count }), locale)}</h3>
        <ul role="list" className={styles.list}>
          {group.map(({ event }) => (
            <MemoryItem key={event.id} event={event} byId={byId} onOpen={close} />
          ))}
        </ul>
      </div>
    ))
  }

  return (
    <>
      <header className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          <IconHistory size={20} stroke={2} />
        </span>
        <div className={styles.heading}>
          <Heading slot="title" level={2} className={styles.title}>
            {t('memories.title')}
          </Heading>
          <p className={styles.date}>{formatDate(today, 'long')}</p>
        </div>
      </header>
      <div className={styles.body}>{body}</div>
    </>
  )
}

/**
 * Header button of the memories: the number of today's that have not been looked at on its badge,
 * and a panel with all of them by age (or, without any today, the next ones).
 */
export function MemoriesButton() {
  const { t, formatNumber } = useI18n()
  const { unseen, isOpen, setOpen } = useMemories()
  const label = unseen > 0 ? t('memories.button.unseen', { count: unseen }) : t('memories.button.label')
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <IconButton
        label={label}
        icon={IconHistory}
        className={cx(unseen > 0 && styles.unseen)}
        badge={unseen > 0 ? (unseen > 9 ? '9+' : formatNumber(unseen)) : undefined}
      />
      <Popover placement="bottom end" offset={8} className={cx(overlay.popover, styles.popover)}>
        <Dialog className={styles.dialog}>{({ close }) => <MemoriesPanel close={close} />}</Dialog>
      </Popover>
    </DialogTrigger>
  )
}
