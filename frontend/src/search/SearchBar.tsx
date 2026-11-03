import { IconAlertTriangle, IconCornerDownLeft, IconSearch, IconSearchOff, IconX } from '@tabler/icons-react'
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ButtonContext, ComboBox, Group, Input, ListBox, ListBoxItem, Popover, Text } from 'react-aria-components'
import { useLocation, useNavigate } from 'react-router'
import { useCategories, useTimeline } from '../api/queries'
import type { CategoryOut, TimelineEventOut } from '../api/schema.gen'
import { IconButton } from '../components/IconButton'
import overlay from '../components/Overlay.module.css'
import { Spinner } from '../components/Spinner'
import { cx } from '../components/utils'
import { useCurrentChild } from '../contexts/CurrentChildContext'
import { CategoryIcon } from '../icons/CategoryIcon'
import { useI18n } from '../i18n'
import { useThemeColors } from '../theme/useThemeColors'
import { categoriesById, pickCategories } from '../utils/categories'
import { NEUTRAL_COLOR, hubFill, segmentedRing } from '../utils/color'
import { useIsMobile } from '../utils/useMediaQuery'
import styles from './SearchBar.module.css'
import { MAX_QUERY_LENGTH, highlightSegments, normalizeQuery, rankMatches, searchTokens } from './searchText'
import { searchString, useTimelineFilters } from './useTimelineFilters'

/** Delay between the last keystroke and the URL `q` update (→ timeline refetch). */
export const SEARCH_DEBOUNCE_MS = 250
/** Suggestions shown in the typeahead. */
export const MAX_SEARCH_RESULTS = 8

type ResultsStatus = 'results' | 'searching' | 'error' | 'empty'

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])
const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])

/** Whether a key press on `target` is the user typing (so `/` must not steal the focus). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type)
  return TEXT_ROLES.has(target.getAttribute('role') ?? '')
}

function Highlight({ text, tokens }: { text: string; tokens: readonly string[] }) {
  const segments = useMemo(() => highlightSegments(text, tokens), [text, tokens])
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index} className={styles.mark}>
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  )
}

/** Small cover circle with the category ring (fallback: category gradient + icon), in the palette's colours. */
function ResultThumb({ event, categories }: { event: TimelineEventOut; categories: readonly CategoryOut[] }) {
  const { adapt } = useThemeColors()
  const colors = categories.length ? categories.map((category) => adapt(category.color)) : [adapt(NEUTRAL_COLOR)]
  const primary = categories[0]
  return (
    <span className={styles.thumb} style={{ '--ring': segmentedRing(colors) } as CSSProperties} data-thumb="">
      <span
        className={styles.thumbInner}
        style={{ background: event.cover ? event.cover.dominant_color : hubFill(colors[0]) }}
      >
        {event.cover ? (
          <img src={event.cover.thumb_url} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <CategoryIcon icon={primary?.icon} size={18} stroke={2} className={styles.thumbIcon} />
        )}
      </span>
    </span>
  )
}

function EmptyResults({ status, query, filtered }: { status: ResultsStatus; query: string; filtered: boolean }) {
  const { t } = useI18n()
  if (status === 'searching') {
    return (
      <div className={styles.empty}>
        <Spinner size={18} decorative className={styles.emptyIcon} />
        <span>{t('search.bar.searching')}</span>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className={cx(styles.empty, styles.emptyError)}>
        <IconAlertTriangle size={20} stroke={2} aria-hidden="true" className={styles.emptyIcon} />
        <span>{t('search.bar.error')}</span>
      </div>
    )
  }
  return (
    <div className={styles.empty}>
      <IconSearchOff size={20} stroke={2} aria-hidden="true" className={styles.emptyIcon} />
      <span className={styles.emptyText}>
        <span className={styles.emptyTitle}>{t('search.bar.noResults', { query })}</span>
        {filtered && <span>{t('search.bar.noResultsFiltered')}</span>}
      </span>
    </div>
  )
}

/**
 * Header search (spec 40): rounded field with `/` shortcut, debounced URL `q` and a typeahead of
 * up to 8 events from the (filtered) timeline query. Choosing one opens its detail with
 * `zoom=events&focus=e<id>` so the timeline jumps to it.
 */
export function SearchBar() {
  const { t, formatDate, formatNumber } = useI18n()
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const location = useLocation()
  const { scope, timelinePath, isLoading: childLoading } = useCurrentChild()
  const { filters, setQuery } = useTimelineFilters()
  const timeline = useTimeline(scope, filters)
  const categories = useCategories()

  const [inputValue, setInputValue] = useState(filters.q)
  const [syncedQuery, setSyncedQuery] = useState(filters.q)
  // Queries this field wrote to the URL that haven't come back yet. The router renders URL updates
  // as a transition, possibly after newer keystrokes: their echo must not undo what was typed since.
  const [sentQueries, setSentQueries] = useState<readonly string[]>([])
  if (syncedQuery !== filters.q) {
    // `q` changed: our own update coming back, or a change made elsewhere (clear filters,
    // back/forward…), shown unless it is what is typed.
    setSyncedQuery(filters.q)
    const echo = sentQueries.indexOf(filters.q)
    if (sentQueries.length > 0) setSentQueries(echo === -1 ? [] : sentQueries.slice(echo + 1))
    if (echo === -1 && normalizeQuery(inputValue) !== filters.q) setInputValue(filters.q)
  }
  const [isOpen, setOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const latestInput = useRef(inputValue)
  useEffect(() => {
    latestInput.current = inputValue
  }, [inputValue])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // `/` focuses the search unless the user is typing somewhere else or a modal covers the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
      const input = inputRef.current
      if (!input || document.activeElement === input || isTypingTarget(event.target)) return
      if (input.closest('[aria-hidden="true"], [inert]')) return
      event.preventDefault()
      input.focus()
      input.select()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function cancelPending() {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }

  /** Writes `q` to the URL, remembering it so that its echo is recognised. */
  function sendQuery(value: string) {
    const text = normalizeQuery(value)
    setSentQueries((sent) => (sent.at(-1) === text ? sent : [...sent, text]))
    setQuery(text)
  }

  function applyNow(value: string) {
    cancelPending()
    sendQuery(value)
  }

  function handleInputChange(value: string) {
    setInputValue(value)
    latestInput.current = value
    cancelPending()
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      // Skip when the field was reset in the meantime (e.g. "clear filters").
      if (normalizeQuery(latestInput.current) === normalizeQuery(value)) sendQuery(value)
    }, SEARCH_DEBOUNCE_MS)
  }

  function clearSearch() {
    cancelPending()
    setInputValue('')
    latestInput.current = ''
    sendQuery('')
    inputRef.current?.focus()
  }

  function openEvent(event: TimelineEventOut) {
    if (!timelinePath) return
    cancelPending()
    const params = new URLSearchParams(location.search)
    const q = normalizeQuery(latestInput.current)
    if (q) params.set('q', q)
    else params.delete('q')
    params.set('zoom', 'events')
    params.set('focus', `e${event.id}`)
    const thumb = listRef.current?.querySelector(`[data-key="${CSS.escape(String(event.id))}"] [data-thumb]`)
    const rect = thumb?.getBoundingClientRect()
    const originRect = rect && rect.width > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined
    void navigate({ pathname: `${timelinePath}/e/${event.id}`, search: searchString(params) }, { state: originRect ? { originRect } : undefined })
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      // With a highlighted suggestion the combobox opens it; otherwise search right away.
      if (!event.currentTarget.getAttribute('aria-activedescendant')) applyNow(event.currentTarget.value)
    } else if (event.key === 'Escape' && !isOpen && event.currentTarget.value !== '') {
      // First Esc closes the suggestions (combobox), the next one clears; only an Esc on an empty
      // field reaches containers such as the mobile search overlay.
      event.stopPropagation()
      clearSearch()
    }
  }

  const query = normalizeQuery(inputValue)
  const tokens = useMemo(() => searchTokens(query), [query])
  const events = timeline.data?.events
  const matches = useMemo(() => (events ? rankMatches(events, tokens) : []), [events, tokens])
  const results = useMemo(() => matches.slice(0, MAX_SEARCH_RESULTS), [matches])
  const byId = useMemo(() => categoriesById(categories.data), [categories.data])

  // Typing may start before the children have loaded: suggestions open right away ("searching").
  const waitingForChild = scope === null && childLoading
  const upToDate = query === filters.q && !timeline.isPlaceholderData
  const status: ResultsStatus =
    results.length > 0
      ? 'results'
      : !upToDate || waitingForChild || (timeline.isPending && timeline.isFetching)
        ? 'searching'
        : timeline.isError && !timeline.data
          ? 'error'
          : 'empty'
  const busy = query !== '' && (query !== filters.q || timeline.isFetching || waitingForChild)
  const otherFilters = Boolean(filters.from || filters.to || filters.categoryIds.length)

  return (
    <div role="search" className={styles.root}>
      <ComboBox
        aria-label={t('search.bar.label')}
        className={styles.combo}
        items={results}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        selectedKey={null}
        allowsCustomValue
        allowsEmptyCollection={query !== '' && (scope !== null || childLoading)}
        menuTrigger="input"
        shouldFocusWrap
        onOpenChange={setOpen}
      >
        <Group className={styles.field}>
          <span className={styles.leading} aria-hidden="true">
            {busy ? <Spinner size={16} decorative /> : <IconSearch size={18} stroke={2.2} />}
          </span>
          <Input
            ref={inputRef}
            className={styles.input}
            placeholder={t('search.bar.placeholder')}
            maxLength={MAX_QUERY_LENGTH}
            enterKeyHint="search"
            aria-keyshortcuts="/"
            onKeyDown={handleKeyDown}
            onBlur={() => applyNow(latestInput.current)}
          />
          {inputValue ? (
            // Plain button, not the combobox trigger (which reads ButtonContext).
            <ButtonContext value={null}>
              <IconButton
                size="sm"
                label={t('search.bar.clear')}
                icon={IconX}
                tooltip={false}
                excludeFromTabOrder
                preventFocusOnPress
                onPress={clearSearch}
                className={styles.clear}
              />
            </ButtonContext>
          ) : (
            !isMobile && (
              <kbd className={styles.shortcut} title={t('search.bar.shortcut')} aria-hidden="true">
                /
              </kbd>
            )
          )}
        </Group>
        <Popover className={cx(overlay.popover, styles.popover)} offset={8} placement="bottom start">
          <ListBox<TimelineEventOut>
            ref={listRef}
            className={styles.list}
            aria-label={t('search.bar.results')}
            // Items are cached by identity: re-render them when the highlighted tokens change.
            dependencies={[tokens, byId]}
            renderEmptyState={() => <EmptyResults status={status} query={query} filtered={otherFilters} />}
          >
            {(event) => (
              <ListBoxItem id={event.id} textValue={event.title} className={styles.option} onAction={() => openEvent(event)}>
                <ResultThumb event={event} categories={pickCategories(event.category_ids, byId)} />
                <span className={styles.optionText}>
                  <Text slot="label" className={styles.optionTitle}>
                    <Highlight text={event.title} tokens={tokens} />
                  </Text>
                  <Text slot="description" className={styles.optionDate}>
                    {formatDate(event.date, 'medium')}
                  </Text>
                </span>
                <IconCornerDownLeft size={16} stroke={2} aria-hidden="true" className={styles.enter} />
              </ListBoxItem>
            )}
          </ListBox>
          {matches.length > results.length && (
            <p className={styles.more}>
              {t('search.bar.more', { shown: formatNumber(results.length), count: matches.length })}
            </p>
          )}
        </Popover>
      </ComboBox>
    </div>
  )
}
