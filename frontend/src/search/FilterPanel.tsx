import { IconFilterOff, IconSearch, IconX } from '@tabler/icons-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Dialog, Heading, type PressEvent } from 'react-aria-components'
import { useTimeline } from '../api/queries'
import { Button } from '../components/Button'
import { Drawer } from '../components/Drawer'
import { IconButton } from '../components/IconButton'
import { Spinner } from '../components/Spinner'
import { cx } from '../components/utils'
import { useCurrentChild } from '../contexts/CurrentChildContext'
import { useI18n } from '../i18n'
import { useIsMobile } from '../utils/useMediaQuery'
import { CategoryFilter } from './CategoryFilter'
import { DateRangeFilter } from './DateRangeFilter'
import { useFilterPanel } from './FilterPanelContext'
import styles from './FilterPanel.module.css'
import { useTimelineFilters } from './useTimelineFilters'

type TimelineQuery = ReturnType<typeof useTimeline>

/**
 * Keeps keyboard focus inside the panel when the pressed control is about to disappear (exit
 * animation) or become disabled: focus moves to the enclosing dialog instead of being lost.
 */
function focusEnclosingDialog(event: PressEvent) {
  const pressed = event.target
  const dialog = pressed.closest<HTMLElement>('[role="dialog"]')
  window.requestAnimationFrame(() => {
    if (!dialog?.isConnected) return
    const active = document.activeElement
    if (!active || active === document.body || pressed.contains(active) || !dialog.contains(active)) dialog.focus()
  })
}

function SearchSummary({ query, onRemove }: { query: string; onRemove: (event: PressEvent) => void }) {
  const { t } = useI18n()
  const headingId = useId()
  return (
    <motion.section
      className={cx(styles.section, styles.clip)}
      aria-labelledby={headingId}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
    >
      <h3 id={headingId} className={styles.sectionTitle}>
        {t('search.panel.searchTitle')}
      </h3>
      <div className={styles.searchChip}>
        <IconSearch size={15} stroke={2.4} aria-hidden="true" className={styles.searchChipIcon} />
        <span className={styles.searchChipText} title={query}>
          {query}
        </span>
        <IconButton
          size="sm"
          label={t('search.panel.removeSearch', { query })}
          icon={IconX}
          tooltip={false}
          onPress={onRemove}
          className={styles.searchChipRemove}
        />
      </div>
    </motion.section>
  )
}

/** Live "12 of 48 milestones" (whole count when nothing is filtered) with a proportion bar. */
function ResultSummary({ timeline, filtered }: { timeline: TimelineQuery; filtered: boolean }) {
  const { t, formatNumber } = useI18n()
  const updating = timeline.isFetching && (timeline.isPlaceholderData || !timeline.data)
  let text: string
  let ratio: number | null = null
  if (timeline.data) {
    const shown = timeline.data.events.length
    const total = timeline.data.total
    text = filtered
      ? t('search.panel.count', { shown: formatNumber(shown), count: total })
      : t('common.milestones', { count: total })
    if (filtered) ratio = total > 0 ? Math.min(1, shown / total) : 0
  } else if (timeline.isError) {
    text = t('search.panel.countError')
  } else {
    text = t('search.panel.counting')
  }
  return (
    <div className={styles.summary}>
      <p className={cx(styles.summaryText, updating && styles.summaryUpdating)} aria-live="polite" aria-atomic="true">
        {text}
        {updating && <Spinner size={14} decorative className={styles.summarySpinner} />}
      </p>
      {ratio !== null && (
        <span className={styles.meter} aria-hidden="true">
          <motion.span
            className={styles.meterFill}
            initial={false}
            animate={{ scaleX: ratio }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          />
        </span>
      )}
    </div>
  )
}

function FilterPanelBody({ variant, onDone }: { variant: 'panel' | 'drawer'; onDone?: () => void }) {
  const { t } = useI18n()
  const { scope } = useCurrentChild()
  const { filters, setQuery, setRange, setCategories, clear, activeCount } = useTimelineFilters()
  const timeline = useTimeline(scope, filters)
  // Bumped by "clear filters" so the date fields drop drafts and pending (not yet applied) edits.
  const [resets, setResets] = useState(0)
  const drawer = variant === 'drawer'
  const shown = timeline.data?.events.length

  return (
    <>
      <div className={cx(styles.body, drawer && styles.bodyDrawer)}>
        <AnimatePresence initial={false}>
          {filters.q && (
            <SearchSummary
              key="search"
              query={filters.q}
              onRemove={(event) => {
                setQuery('')
                focusEnclosingDialog(event)
              }}
            />
          )}
        </AnimatePresence>
        <DateRangeFilter key={resets} from={filters.from} to={filters.to} onChange={setRange} />
        <CategoryFilter selected={filters.categoryIds} onChange={setCategories} />
      </div>
      <footer className={cx(styles.footer, drawer && styles.footerDrawer)}>
        <ResultSummary timeline={timeline} filtered={activeCount > 0} />
        <div className={styles.footerActions}>
          <Button
            variant="ghost"
            size="sm"
            icon={IconFilterOff}
            isDisabled={activeCount === 0}
            onPress={(event) => {
              clear()
              setResets((count) => count + 1)
              focusEnclosingDialog(event)
            }}
          >
            {t('search.panel.clear')}
          </Button>
          {drawer && (
            <Button variant="primary" onPress={onDone} className={styles.done}>
              {shown === undefined ? t('common.close') : t('search.panel.showResults', { count: shown })}
            </Button>
          )}
        </div>
      </footer>
    </>
  )
}

/**
 * Desktop: non-modal 360 px panel floating over the right side of the timeline (no backdrop, the
 * timeline stays interactive). Esc or the close button close it and give focus back to the toggle.
 */
function DesktopFilterPanel() {
  const { t } = useI18n()
  const { isOpen, close, panelId, triggerRef } = useFilterPanel()
  const panelRef = useRef<HTMLDivElement>(null)

  const closeFromPanel = useCallback(() => {
    const active = document.activeElement
    const hadFocus = !active || active === document.body || Boolean(panelRef.current?.contains(active))
    close()
    if (hadFocus) triggerRef.current?.focus()
  }, [close, triggerRef])

  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const active = document.activeElement
      // Only when the panel (or nothing in particular) has focus: Esc in the search field or in a
      // dialog belongs to them.
      if (active && active !== document.body && !panelRef.current?.contains(active)) return
      event.preventDefault()
      closeFromPanel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, closeFromPanel])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="filter-panel"
          ref={panelRef}
          className={styles.panel}
          initial={{ opacity: 0, x: 48, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 48, scale: 0.98, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        >
          <Dialog id={panelId} className={styles.dialog}>
            <header className={styles.header}>
              <Heading slot="title" className={styles.title}>
                {t('search.panel.title')}
              </Heading>
              <IconButton label={t('search.panel.close')} icon={IconX} tooltip={false} onPress={closeFromPanel} />
            </header>
            <FilterPanelBody variant="panel" />
          </Dialog>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Timeline filters: floating right panel on desktop, full-height drawer with backdrop on mobile. */
export function FilterPanel() {
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const { isOpen, open, close, panelId } = useFilterPanel()
  if (!isMobile) return <DesktopFilterPanel />
  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={(next) => (next ? open() : close())}
      side="right"
      title={t('search.panel.title')}
      width="min(400px, 92vw)"
    >
      {(closeDrawer) => (
        <div id={panelId} className={styles.drawerContent}>
          <FilterPanelBody variant="drawer" onDone={closeDrawer} />
        </div>
      )}
    </Drawer>
  )
}
