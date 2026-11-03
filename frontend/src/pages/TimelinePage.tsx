import { useCallback, useMemo } from 'react'
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router'
import { useAppearance, useCategories, useTimeline } from '../api/queries'
import type { YearColorOut } from '../api/schema.gen'
import type { OriginRect } from '../components/Modal'
import { LoadingState } from '../components/Spinner'
import { useAuth } from '../contexts/AuthContext'
import { FAMILY_PATH, useCurrentChild } from '../contexts/CurrentChildContext'
import { useI18n } from '../i18n'
import { FilterPanel } from '../search/FilterPanel'
import { FILTER_PANEL_INSET, useFilterPanel } from '../search/FilterPanelContext'
import { useTimelineFilters } from '../search/useTimelineFilters'
import { buildTimelineModel, type TimelineLane } from '../timeline/model'
import { DEFAULT_DIRECTIONS } from '../timeline/direction'
import { NewMilestoneButton } from '../timeline/NewMilestoneButton'
import { introPending, markIntroSeen } from '../timeline/sweep'
import { Timeline } from '../timeline/Timeline'
import { TimelineBackground } from '../timeline/TimelineBackground'
import { TimelineEmpty, TimelineError, TimelineNoResults } from '../timeline/TimelineStates'
import { useTimelineUrlState } from '../timeline/useTimelineUrlState'
import { categoriesById } from '../utils/categories'
import { useDocumentTitle } from '../utils/useDocumentTitle'
import { useIsMobile } from '../utils/useMediaQuery'
import styles from './TimelinePage.module.css'

const NO_YEAR_COLORS: YearColorOut[] = []
const NO_LANES: TimelineLane[] = []

/**
 * `/c/:childSlug` (a child's timeline) and `/all` (every child together): the interactive timeline
 * over the appearance background, the search filter panel and the event detail route
 * (`<Outlet/>`). Zoom level and focused node live in the URL (`zoom`, `focus`) next to the search
 * filters.
 */
export function TimelinePage() {
  const { t } = useI18n()
  const { child, children, isAll, scope, timelinePath } = useCurrentChild()
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const { search } = useLocation()
  const routeBase = isAll ? FAMILY_PATH : '/c/:childSlug'
  const detailOpen = useMatch(`${routeBase}/e/:eventId`) !== null
  const creating = useMatch(`${routeBase}/new`) !== null
  const filterPanel = useFilterPanel()
  const isMobile = useIsMobile()
  const name = isAll ? t('timeline.family.name') : (child?.name ?? '')
  useDocumentTitle(name)

  const { filters, clear } = useTimelineFilters()
  const timeline = useTimeline(scope, filters)
  const categories = useCategories()
  const appearance = useAppearance()
  const url = useTimelineUrlState(appearance.data?.default_zoom ?? 'events')

  const events = timeline.data?.events
  // The family timeline draws every child on their own line.
  const lanes = isAll ? children : NO_LANES
  const model = useMemo(() => buildTimelineModel(events ?? [], lanes), [events, lanes])
  const categoryMap = useMemo(() => categoriesById(categories.data), [categories.data])
  const desktopDirection = appearance.data?.direction_desktop ?? DEFAULT_DIRECTIONS.desktop
  const mobileDirection = appearance.data?.direction_mobile ?? DEFAULT_DIRECTIONS.mobile
  const directions = useMemo(() => ({ desktop: desktopDirection, mobile: mobileDirection }), [desktopDirection, mobileDirection])
  const base = timelinePath ?? ''
  const eventHref = useCallback((id: number) => `${base}/e/${id}${search}`, [base, search])
  const openEvent = useCallback(
    (id: number, originRect: OriginRect) => navigate(`${base}/e/${id}${search}`, { state: { originRect } }),
    [navigate, base, search],
  )

  // New milestones open in a modal over the timeline (the view, filters included, is kept).
  const createHref = isAdmin && base ? `${base}/new${search}` : null
  let body
  if (timeline.isError && !timeline.data) {
    body = <TimelineError error={timeline.error} onRetry={() => void timeline.refetch()} />
  } else if (categories.isError && !categories.data) {
    body = <TimelineError error={categories.error} onRetry={() => void categories.refetch()} />
  } else if (!timeline.data || !categories.data || appearance.isPending) {
    body = <LoadingState fill message={t('timeline.loading')} />
  } else if (timeline.data.total === 0) {
    body = <TimelineEmpty childName={isAll ? null : name} createHref={createHref} />
  } else if (model.events.length === 0) {
    body = <TimelineNoResults onClear={clear} />
  } else {
    body = (
      <Timeline
        key={isAll ? 'all' : child?.id}
        model={model}
        categories={categoryMap}
        yearColors={appearance.data?.year_colors ?? NO_YEAR_COLORS}
        level={url.level}
        focus={url.focus}
        onViewChange={url.setView}
        eventHref={eventHref}
        onOpenEvent={openEvent}
        label={isAll ? t('timeline.family.regionLabel') : t('timeline.regionLabel', { name })}
        paused={detailOpen || creating}
        controlsInset={filterPanel.isOpen && !isMobile ? FILTER_PANEL_INSET : 0}
        directions={directions}
        // Once per browser session (the timeline skips it when the address points at a node).
        intro={introPending()}
        onIntro={markIntroSeen}
      />
    )
  }
  const showCreate = Boolean(timeline.data?.total) && Boolean(categories.data)

  return (
    <div className={styles.page}>
      <h1 className="visually-hidden">{name}</h1>
      <TimelineBackground image={appearance.data?.background ?? null} opacity={appearance.data?.background_opacity} />
      {body}
      {createHref && showCreate && <NewMilestoneButton href={createHref} />}
      <FilterPanel />
      <Outlet />
    </div>
  )
}
