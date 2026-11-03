import { motion, useReducedMotion, type TargetAndTransition, type Transition } from 'motion/react'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import type { CategoryOut, YearColorOut } from '../api/schema.gen'
import type { OriginRect } from '../components/Modal'
import { useI18n } from '../i18n'
import { useThemeColors } from '../theme/useThemeColors'
import { pickCategories } from '../utils/categories'
import { MOBILE_QUERY } from '../utils/useMediaQuery'
import { EventNode } from './EventNode'
import { HubNode } from './HubNode'
import {
  cachedLayout,
  clampScroll,
  laneCrossAt,
  nearestNodeIndex,
  nodeByKey,
  rangeIndices,
  scrollToCenter,
  type LayoutNode,
  type TimelineLayout,
} from './layout'
import { levelOfKey, representativeKey, resolveFocusKey, type TimelineEntry, type TimelineModel } from './model'
import { createPalette, type HubColors, type TimelinePalette } from './palette'
import styles from './Timeline.module.css'
import { slotTransform, TimelineAxis, translateTo } from './TimelineAxis'
import { TimelineLanes } from './TimelineLanes'
import { TimelinePeriod } from './TimelinePeriod'
import type { Orientation, ZoomLevel } from './types'
import { maxScrollOf, readScroll, useTimelineGestures, writeScroll } from './useTimelineGestures'
import { DEFAULT_DIRECTIONS, frameFor, mirror, sameFrame, type AxisFrame, type TimelineDirections } from './direction'
import { planSweep, sweepFront, sweepLength, sweepScroll, type SweepPlan } from './sweep'
import {
  MERGE_LEAD,
  PULSE_LEAD,
  keyZoomDirection,
  planIntro,
  planZoom,
  stepLevel,
  type EnterSpec,
  type GhostSpec,
  type ZoomDirection,
} from './zoom'
import { ZoomControls } from './ZoomControls'

export interface TimelineViewChange {
  level: ZoomLevel
  /** Node key for the URL `focus` param. */
  focus: string | null
}

export interface TimelineProps {
  model: TimelineModel
  categories: ReadonlyMap<number, CategoryOut>
  yearColors: readonly YearColorOut[]
  /** Level requested by the URL (`zoom`) or the appearance default. */
  level: ZoomLevel
  /** URL `focus` value (`e123`, `m2026-03`, `y2026`). */
  focus: string | null
  /** The view changed through the timeline itself: mirror it in the URL. */
  onViewChange: (view: TimelineViewChange) => void
  /** Link target of an event (`/c/<slug>/e/<id>?…`). */
  eventHref: (eventId: number) => string
  onOpenEvent: (eventId: number, originRect: OriginRect) => void
  /** Accessible name of the timeline region. */
  label: string
  /** True while something (the event detail) covers the timeline: pulses and shortcuts wait. */
  paused?: boolean
  /** Desktop: px kept free at the right edge for the zoom control (open filter panel). */
  controlsInset?: number
  /** Which way time runs on desktops and on phones (appearance settings). */
  directions?: TimelineDirections
  /**
   * Open with the sweep from the oldest milestone to the newest (read on mount; skipped with
   * reduced motion or a focused node). `onIntro` runs once when it was asked for.
   */
  intro?: boolean
  onIntro?: () => void
}

interface Viewport {
  width: number
  height: number
}

/** Opening sweep in progress. */
interface ActiveSweep {
  plan: SweepPlan
  /** `performance.now()` when it started. */
  start: number
}

interface ActiveTransition {
  id: number
  enter: ReadonlyMap<string, EnterSpec>
  ghosts: readonly GhostSpec[]
  /** Layout the ghosts belong to (the previous level). */
  ghostLayout: TimelineLayout | null
  /** Seconds before boundary chips fade in. */
  markersDelay: number
  /** Milliseconds until it can be cleared. */
  duration: number
}

interface ViewState {
  level: ZoomLevel
  orientation: Orientation
  /** Newest milestone at the right / bottom end (logical positions are mirrored on screen). */
  reversed: boolean
  /** Phone-sized screen. */
  compact: boolean
  viewport: Viewport
  /** Logical scroll offset (from the newest end) used for virtualization (exact after programmatic jumps, approximate while scrolling). */
  scroll: number
  /** Bumped whenever `scroll` must be written to the DOM. */
  scrollToken: number
  transition: ActiveTransition | null
  transitionCount: number
  /** Roving tabindex. */
  activeKey: string | null
  /** Bumped to move DOM focus to `activeKey`. */
  focusToken: number
  pulse: { key: string; token: number } | null
  announcement: string
  /** Opening sweep (oldest → newest) while it runs. */
  sweep: ActiveSweep | null
}

interface ZoomOptions {
  anchorKey?: string | null
  /** Pointer offset inside the viewport (main axis, logical: from the newest end). */
  pointer?: number | null
  /** Scroll to use instead of the anchored one (centre a searched event). */
  targetScroll?: number | null
  /** Move keyboard focus to the new level's anchor node. */
  moveFocus?: boolean
  pulseKey?: string | null
  /** URL `focus` to write instead of the plan's anchor (`false` = leave the URL alone). */
  urlFocus?: string | null
  writeUrl?: boolean
}

/** Header height until the container is measured (phones have the compact header). */
const HEADER_FALLBACK = { regular: 64, compact: 56 }
/** Re-render the virtual window only after scrolling this far. */
const SCROLL_QUANTUM = 96
const PULSE_DURATION = 2000
const INTRO_DURATION = 1500

const REST: TargetAndTransition = { x: 0, y: 0, scale: 1, opacity: 1 }
const BURST_SPRING = { type: 'spring', stiffness: 260, damping: 26 } as const
const POP_SPRING = { type: 'spring', stiffness: 380, damping: 22 } as const
const INTRO_SPRING = { type: 'spring', stiffness: 210, damping: 24 } as const

function isPhone(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(MOBILE_QUERY).matches
}

/** Orientation and side of the newest milestone for this screen size. */
function readFrame(directions: TimelineDirections): AxisFrame {
  return frameFor(directions, isPhone())
}

function windowViewport(frame: AxisFrame): Viewport {
  if (typeof window === 'undefined') return { width: 1280, height: 720 }
  const header = frame.compact ? HEADER_FALLBACK.compact : HEADER_FALLBACK.regular
  return { width: window.innerWidth, height: Math.max(240, window.innerHeight - header) }
}

function mainSize(viewport: Viewport, orientation: Orientation): number {
  return orientation === 'horizontal' ? viewport.width : viewport.height
}

function frameOfView(view: Pick<ViewState, 'orientation' | 'reversed' | 'compact'>): AxisFrame {
  return { orientation: view.orientation, reversed: view.reversed, compact: view.compact }
}

function layoutFor(
  model: TimelineModel,
  level: ZoomLevel,
  view: Pick<ViewState, 'orientation' | 'reversed' | 'compact' | 'viewport'>,
): TimelineLayout {
  return cachedLayout(model, level, {
    orientation: view.orientation,
    reversed: view.reversed,
    compact: view.compact,
    viewport: mainSize(view.viewport, view.orientation),
  })
}

function nodeKeyOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>('[data-node-key]')?.dataset.nodeKey ?? null
}

/**
 * Index steps of the arrow keys: the arrow pointing at the newest end goes to newer nodes. The
 * keys across the line keep their meaning (↑/← newer, ↓/→ older).
 */
function arrowSteps({ orientation, reversed }: Pick<AxisFrame, 'orientation' | 'reversed'>): Record<string, number> {
  const towardsEnd = reversed ? -1 : 1
  return orientation === 'horizontal'
    ? { ArrowLeft: -towardsEnd, ArrowRight: towardsEnd, ArrowUp: -1, ArrowDown: 1 }
    : { ArrowUp: -towardsEnd, ArrowDown: towardsEnd, ArrowLeft: -1, ArrowRight: 1 }
}

/** `clip-path` of the axis layer during the sweep: hides what the front has not reached yet (the newest side). */
function sweepClip(layout: Pick<TimelineLayout, 'orientation' | 'reversed'>, front: number): string {
  const hidden = `${Math.max(0, Math.round(front))}px`
  if (layout.orientation === 'horizontal') return layout.reversed ? `inset(0 ${hidden} 0 0)` : `inset(0 0 0 ${hidden})`
  return layout.reversed ? `inset(0 0 ${hidden} 0)` : `inset(${hidden} 0 0 0)`
}

/**
 * Places the sweep's glowing front(s) at the main-axis position `front`: one on the axis, or one
 * per family lane (on its line, shown only where the line exists).
 */
function placeFronts(layout: TimelineLayout, front: number, elements: Iterable<HTMLElement>): void {
  for (const element of elements) {
    const id = element.dataset.lane
    const lane = id === undefined ? undefined : layout.lanes.find((item) => String(item.id) === id)
    element.style.transform = slotTransform(layout, front, lane ? laneCrossAt(lane, front) : 0)
    if (lane) element.style.opacity = front >= lane.head && front <= lane.tail + 0.5 ? '1' : '0'
  }
}

function createInitialView(
  model: TimelineModel,
  requested: ZoomLevel,
  focus: string | null,
  reducedMotion: boolean,
  directions: TimelineDirections,
  intro: boolean,
): ViewState {
  const frame = readFrame(directions)
  const viewport = windowViewport(frame)
  // A searched event (focus=e123) always opens the events level.
  const level: ZoomLevel = focus && levelOfKey(focus) === 'events' && model.byKey.has(focus) ? 'events' : requested
  const layout = layoutFor(model, level, { ...frame, viewport })
  const target = resolveFocusKey(model, focus, level)
  const plan = intro && !reducedMotion && !target ? planSweep(layout) : null
  // Without a focus the line rests on its newest end (logical scroll 0), whatever the direction;
  // the opening sweep starts from the oldest end and comes back there.
  const scroll = plan ? sweepScroll(layout, plan.from) : target ? (scrollToCenter(layout, target) ?? 0) : 0
  return {
    level,
    ...frame,
    viewport,
    scroll,
    scrollToken: 1,
    transition: plan
      ? null
      : {
          id: 1,
          enter: planIntro(layout, scroll, reducedMotion),
          ghosts: [],
          ghostLayout: null,
          markersDelay: 0.35,
          duration: INTRO_DURATION,
        },
    transitionCount: 1,
    activeKey: target ?? layout.nodes[0]?.key ?? null,
    focusToken: 0,
    pulse: target && target === focus && levelOfKey(target) === 'events' ? { key: target, token: 1 } : null,
    announcement: '',
    sweep: plan ? { plan, start: performance.now() } : null,
  }
}

// ── Items ─────────────────────────────────────────────────────────────────────────────────

/** Initial state of an arriving node; main-axis offsets are logical (mirrored when `reversed`). Bursts start on the axis (`cross` back). */
function enterInitial(enter: EnterSpec | undefined, horizontal: boolean, reversed: boolean, cross: number): TargetAndTransition | false {
  if (!enter) return false
  const main = horizontal ? 'x' : 'y'
  const across = horizontal ? 'y' : 'x'
  switch (enter.kind) {
    case 'burst':
      return { [main]: reversed ? -enter.offset : enter.offset, [across]: -cross, scale: 0.22, opacity: 0 }
    case 'pop':
      return { x: 0, y: 0, scale: 0.45, opacity: 0 }
    case 'intro':
      return { [main]: 0, [across]: horizontal ? 22 : 0, scale: 0.84, opacity: 0 }
    default:
      return { opacity: 0 }
  }
}

function enterTransition(enter: EnterSpec | undefined): Transition | undefined {
  if (!enter) return undefined
  const { delay } = enter
  switch (enter.kind) {
    case 'burst':
      return { ...BURST_SPRING, delay, opacity: { duration: 0.2, delay } }
    case 'pop':
      return { ...POP_SPRING, delay, opacity: { duration: 0.18, delay } }
    case 'intro':
      return { ...INTRO_SPRING, delay, opacity: { duration: 0.4, delay } }
    default:
      return { duration: 0.15 }
  }
}

interface ItemProps {
  node: LayoutNode
  entry: TimelineEntry
  categories: readonly CategoryOut[] | undefined
  colors: HubColors | undefined
  /** Family timeline: whose milestone it is (added to its accessible name). */
  people: string | undefined
  orientation: Orientation
  /** Mirrored frame (newest at the right / bottom end). */
  reversed: boolean
  /** CSS transform of the slot (physical position). */
  transform: string
  setSize: number
  enter: EnterSpec | undefined
  /** Opening sweep: seconds after its start when the front reaches this node (`null` = no sweep). */
  sweepAt: number | null
  /** `performance.now()` at the start of the sweep. */
  sweepStart: number
  tabIndex: number
  pulse: number | null
  href: string | undefined
  labelWidth: number
  onOpenEvent: (key: string, eventId: number, event: MouseEvent<HTMLAnchorElement>) => void
  onActivateHub: (key: string) => void
}

/** Hidden until the sweep's front arrives. */
const SWEEP_HIDDEN: TargetAndTransition = { x: 0, y: 0, scale: 0.5, opacity: 0 }
const SWEEP_ARRIVAL: Transition = { ...POP_SPRING, opacity: { duration: 0.2 } }

/**
 * During the opening sweep a node stays hidden until the front reaches it, then pops in (its own
 * timer, so it also works for nodes mounted on the way); it shows at once when the sweep ends early.
 */
function useSweepArrival(sweepAt: number | null, sweepStart: number): { sweeping: boolean; arrived: boolean } {
  const [sweeping] = useState(() => sweepAt !== null)
  const [arrived, setArrived] = useState(() => sweepAt === null)
  useEffect(() => {
    if (arrived) return
    const wait = sweepAt === null ? 0 : Math.max(0, sweepAt * 1000 - (performance.now() - sweepStart))
    const timer = window.setTimeout(() => setArrived(true), wait)
    return () => window.clearTimeout(timer)
  }, [arrived, sweepAt, sweepStart])
  return { sweeping, arrived }
}

const TimelineItem = memo(function TimelineItem({
  node,
  entry,
  categories,
  colors,
  people,
  orientation,
  reversed,
  transform,
  setSize,
  enter,
  sweepAt,
  sweepStart,
  tabIndex,
  pulse,
  href,
  labelWidth,
  onOpenEvent,
  onActivateHub,
}: ItemProps) {
  const { sweeping, arrived } = useSweepArrival(sweepAt, sweepStart)
  const reveal = sweeping ? arrived : enter !== undefined && enter.kind !== 'fade' && enter.kind !== 'pop'
  const revealDelay = sweeping ? 0.04 : (enter?.delay ?? 0) + 0.08
  return (
    <div
      role="listitem"
      aria-setsize={setSize}
      aria-posinset={node.index + 1}
      className={styles.slot}
      style={{ transform }}
      data-sweep={sweeping ? (arrived ? 'lit' : 'waiting') : undefined}
    >
      <motion.div
        className={styles.anchor}
        initial={sweeping ? SWEEP_HIDDEN : enterInitial(enter, orientation === 'horizontal', reversed, node.cross)}
        animate={sweeping && !arrived ? SWEEP_HIDDEN : REST}
        transition={sweeping ? SWEEP_ARRIVAL : enterTransition(enter)}
      >
        <div className={styles.center}>
          {entry.kind === 'event' ? (
            <EventNode
              nodeKey={entry.key}
              title={entry.event.title}
              date={entry.event.date}
              categories={categories ?? []}
              people={people}
              cover={entry.event.cover}
              size={node.size}
              labelWidth={labelWidth}
              href={href}
              tabIndex={tabIndex}
              reveal={reveal}
              revealDelay={revealDelay}
              pulse={pulse}
              onOpen={(event) => onOpenEvent(entry.key, entry.event.id, event)}
            />
          ) : (
            colors && (
              <HubNode
                nodeKey={entry.key}
                kind={entry.kind}
                year={entry.year}
                month={entry.kind === 'month' ? entry.month : null}
                count={entry.count}
                colors={colors}
                size={node.size}
                tabIndex={tabIndex}
                countFrom={enter?.kind === 'pop' ? 0 : null}
                countDelay={enter?.delay ?? 0}
                onActivate={() => onActivateHub(entry.key)}
              />
            )
          )}
        </div>
      </motion.div>
    </div>
  )
})

// ── Ghosts (previous level, animating out) ────────────────────────────────────────────────

function ghostAnimation(ghost: GhostSpec, horizontal: boolean, reversed: boolean, cross: number): TargetAndTransition {
  switch (ghost.mode) {
    case 'source':
      // The anchor pulses before its children burst out of it; the other parents just shrink away.
      return ghost.isAnchor ? { scale: [1, 1.12, 0.4], opacity: [1, 1, 0] } : { scale: 0.6, opacity: 0 }
    case 'merge': {
      // Into the parent on the axis (family lanes converge too).
      const travel = ghost.to - ghost.from
      return { [horizontal ? 'x' : 'y']: reversed ? -travel : travel, [horizontal ? 'y' : 'x']: -cross, scale: 0.28, opacity: 0, filter: 'blur(6px)' }
    }
    default:
      return { opacity: 0 }
  }
}

function ghostTransition(ghost: GhostSpec): Transition {
  switch (ghost.mode) {
    case 'source':
      return ghost.isAnchor
        ? { duration: 0.44, times: [0, 0.3, 1], ease: ['easeOut', 'easeIn'] }
        : { duration: 0.3, ease: [0.4, 0, 1, 1] }
    case 'merge':
      return {
        duration: 0.5,
        delay: ghost.delay,
        ease: [0.55, 0, 0.75, 0.3],
        opacity: { duration: 0.4, delay: ghost.delay + 0.1, ease: 'easeIn' },
      }
    default:
      return { duration: 0.15 }
  }
}

interface GhostsProps {
  transition: ActiveTransition
  model: TimelineModel
  palette: TimelinePalette
  eventCategories: ReadonlyMap<string, readonly CategoryOut[]>
  orientation: Orientation
  reversed: boolean
  labelWidth: number
}

function TimelineGhosts({ transition, model, palette, eventCategories, orientation, reversed, labelWidth }: GhostsProps) {
  const horizontal = orientation === 'horizontal'
  const layout = transition.ghostLayout
  if (!layout) return null
  return (
    <div className={styles.ghosts} aria-hidden="true">
      {transition.ghosts.map((ghost) => {
        const entry = model.byKey.get(ghost.key)
        const node = nodeByKey(layout, ghost.key)
        if (!entry || !node) return null
        const colors = entry.kind === 'year' ? palette.year(entry.year) : entry.kind === 'month' ? palette.month(entry.year, entry.month) : null
        // Ghost positions are screen offsets from the newest end of the viewport.
        const transform = translateTo(orientation, mirror(ghost.from, layout.viewport, reversed), node.cross)
        return (
          <div key={`${transition.id}:${ghost.key}`} className={styles.slot} style={{ transform }}>
            <motion.div
              className={styles.anchor}
              initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
              animate={ghostAnimation(ghost, horizontal, reversed, node.cross)}
              transition={ghostTransition(ghost)}
            >
              {ghost.mode === 'source' && ghost.isAnchor && (
                <motion.span
                  className={styles.shockwave}
                  style={{ '--wave-size': `${node.size}px`, '--wave-color': colors?.color ?? 'var(--color-primary)' } as CSSProperties}
                  initial={{ scale: 1, opacity: 0.55 }}
                  animate={{ scale: 2.3, opacity: 0 }}
                  transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
              <div className={styles.center}>
                {entry.kind === 'event' ? (
                  <EventNode
                    decorative
                    title={entry.event.title}
                    date={entry.event.date}
                    categories={eventCategories.get(entry.key) ?? []}
                    cover={entry.event.cover}
                    size={node.size}
                    labelWidth={labelWidth}
                  />
                ) : (
                  colors && (
                    <HubNode
                      decorative
                      kind={entry.kind}
                      year={entry.year}
                      month={entry.kind === 'month' ? entry.month : null}
                      count={entry.count}
                      colors={colors}
                      size={node.size}
                    />
                  )
                )}
              </div>
            </motion.div>
          </div>
        )
      })}
    </div>
  )
}

// ── Timeline ──────────────────────────────────────────────────────────────────────────────

/**
 * Interactive zoomable timeline (years → months → events), newest first along the direction the
 * appearance settings choose for the screen size (by default horizontal with the newest on the
 * left on desktop, vertical with the newest at the top on phones). Virtualised absolutely-positioned
 * nodes inside a native scroll container, Motion transitions between levels (burst / merge), roving
 * keyboard focus, wheel / drag / pinch gestures and floating zoom controls. Level & focus are
 * mirrored in the URL by the page. Positions and scroll offsets are logical (from the newest end);
 * reversed frames mirror them on screen.
 */
export function Timeline({
  model,
  categories,
  yearColors,
  level: requestedLevel,
  focus,
  onViewChange,
  eventHref,
  onOpenEvent,
  label,
  paused = false,
  controlsInset = 0,
  directions = DEFAULT_DIRECTIONS,
  intro = false,
  onIntro,
}: TimelineProps) {
  const { t, lang } = useI18n()
  const reducedMotion = useReducedMotion() ?? false
  const [view, setView] = useState<ViewState>(() => createInitialView(model, requestedLevel, focus, reducedMotion, directions, intro))
  const containerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const frontsRef = useRef<HTMLDivElement>(null)

  const { orientation, level, reversed } = view
  const horizontal = orientation === 'horizontal'
  const viewportMain = mainSize(view.viewport, orientation)
  const layout = layoutFor(model, level, view)
  const themeColors = useThemeColors()
  const palette = useMemo(() => createPalette(yearColors, themeColors), [yearColors, themeColors])
  const eventCategories = useMemo(
    () => new Map(model.events.map((entry) => [entry.key, pickCategories(entry.event.category_ids, categories)])),
    [model, categories],
  )
  // Family timeline: the children of each milestone, in lane order ("Emma y Leo").
  const eventPeople = useMemo(() => {
    if (model.lanes.length === 0) return null
    const list = new Intl.ListFormat(lang, { type: 'conjunction' })
    return new Map(
      model.events.map((entry) => [
        entry.key,
        list.format(model.lanes.filter((lane) => entry.event.child_ids.includes(lane.id)).map((lane) => lane.name)),
      ]),
    )
  }, [model, lang])
  const labelWidth = horizontal ? (view.compact ? 128 : 150) : 210

  // Latest values for event handlers and effects.
  const latest = useRef({ view, layout, model, reducedMotion, paused, onViewChange, onOpenEvent, t, directions, onIntro })
  useLayoutEffect(() => {
    latest.current = { view, layout, model, reducedMotion, paused, onViewChange, onOpenEvent, t, directions, onIntro }
  })
  const scrollRef = useRef(view.scroll)
  const recentWrites = useRef<TimelineViewChange[]>([])
  const seen = useRef({ level: requestedLevel, focus })

  const announce = useCallback(
    (target: TimelineLayout) => {
      const levelName = t(`timeline.levelView.${target.level}`)
      return t('timeline.announce', { level: levelName, count: target.nodes.length })
    },
    [t],
  )

  const writeUrl = useCallback((change: TimelineViewChange) => {
    recentWrites.current = [...recentWrites.current.slice(-5), change]
    latest.current.onViewChange(change)
  }, [])

  const scroller = useTimelineGestures(containerRef, orientation, {
    onZoom: (direction, pointer) => {
      const { view: current } = latest.current
      const size = mainSize(current.viewport, current.orientation)
      zoomStep(direction, { pointer: pointer === null ? null : mirror(pointer, size, current.reversed) })
    },
  })

  /** Eases (or jumps) to a logical scroll offset. */
  const scrollTo = useCallback(
    (target: number, smooth: boolean) => {
      const container = containerRef.current
      const { view: current } = latest.current
      if (!container) return
      scroller.scrollTo(mirror(target, maxScrollOf(container, current.orientation), current.reversed), smooth)
    },
    [scroller],
  )

  const zoomTo = useCallback(
    (target: ZoomLevel, options: ZoomOptions = {}) => {
      const container = containerRef.current
      const { view: current, model: currentModel, reducedMotion: reduced } = latest.current
      if (!container || target === current.level) return
      scroller.stop()
      const from = layoutFor(currentModel, current.level, current)
      const to = layoutFor(currentModel, target, current)
      const scroll = readScroll(container, current.orientation, current.reversed)
      const pointer = options.pointer ?? from.viewport / 2
      const anchorKey =
        options.anchorKey && from.indexByKey.has(options.anchorKey)
          ? options.anchorKey
          : (from.nodes[nearestNodeIndex(from, scroll + pointer)]?.key ?? null)
      const plan = anchorKey
        ? planZoom({ model: currentModel, from, to, anchorKey, scroll, targetScroll: options.targetScroll, reducedMotion: reduced })
        : null
      const nextScroll = plan?.scroll ?? clampScroll(to, options.targetScroll ?? 0)
      const focusKey = plan?.focusKey ?? to.nodes[nearestNodeIndex(to, nextScroll + to.viewport / 2)]?.key ?? null
      setView((state) => ({
        ...state,
        level: target,
        scroll: nextScroll,
        scrollToken: state.scrollToken + 1,
        transitionCount: state.transitionCount + 1,
        transition: plan
          ? {
              id: state.transitionCount + 1,
              enter: plan.enter,
              ghosts: plan.ghosts,
              ghostLayout: from,
              markersDelay: reduced ? 0 : plan.direction === 'in' ? PULSE_LEAD + 0.3 : MERGE_LEAD + 0.15,
              duration: plan.duration,
            }
          : null,
        activeKey: options.pulseKey ?? focusKey,
        focusToken: options.moveFocus ? state.focusToken + 1 : state.focusToken,
        pulse: options.pulseKey ? { key: options.pulseKey, token: (state.pulse?.token ?? 0) + 1 } : null,
        announcement: announce(to),
      }))
      if (options.writeUrl !== false) writeUrl({ level: target, focus: options.urlFocus ?? focusKey })
    },
    [announce, scroller, writeUrl],
  )

  const zoomStep = useCallback(
    (direction: ZoomDirection, options: ZoomOptions = {}) => {
      const target = stepLevel(latest.current.view.level, direction)
      if (target) zoomTo(target, options)
    },
    [zoomTo],
  )

  // ── URL → view (back/forward, search jumps) ────────────────────────────────────────────
  // Runs in the next frame (never setState synchronously in the effect); a newer run cancels it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const previous = seen.current
      if (previous.level === requestedLevel && previous.focus === focus) return
      seen.current = { level: requestedLevel, focus }
      if (recentWrites.current.some((write) => write.level === requestedLevel && write.focus === focus)) return
      const { view: current, model: currentModel, reducedMotion: reduced } = latest.current
      let targetLevel = requestedLevel
      let focusKey: string | null = null
      if (focus !== previous.focus && focus) {
        if (levelOfKey(focus) === 'events' && currentModel.byKey.has(focus)) targetLevel = 'events'
        focusKey = resolveFocusKey(currentModel, focus, targetLevel)
      }
      const pulseKey = focusKey && focusKey === focus && levelOfKey(focusKey) === 'events' ? focusKey : null
      if (targetLevel !== current.level) {
        const to = layoutFor(currentModel, targetLevel, current)
        zoomTo(targetLevel, {
          anchorKey: focusKey ? representativeKey(currentModel, focusKey, current.level) : null,
          targetScroll: focusKey ? scrollToCenter(to, focusKey) : null,
          pulseKey,
          urlFocus: focus,
          writeUrl: targetLevel !== requestedLevel,
        })
        return
      }
      if (!focusKey) return
      const target = scrollToCenter(layoutFor(currentModel, current.level, current), focusKey)
      if (target !== null) scrollTo(target, !reduced)
      setView((state) => ({
        ...state,
        activeKey: focusKey,
        pulse: pulseKey ? { key: pulseKey, token: (state.pulse?.token ?? 0) + 1 } : state.pulse,
      }))
    })
    return () => cancelAnimationFrame(frame)
  }, [requestedLevel, focus, scrollTo, zoomTo])

  // A searched event forced the events level on first render: mirror it in the URL.
  useEffect(() => {
    const { view: initial } = latest.current
    if (initial.level !== seen.current.level) writeUrl({ level: initial.level, focus: seen.current.focus })
  }, [writeUrl])

  // ── DOM scroll sync ────────────────────────────────────────────────────────────────────
  const appliedScrollToken = useRef(0)
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || appliedScrollToken.current === view.scrollToken) return
    appliedScrollToken.current = view.scrollToken
    writeScroll(container, orientation, view.scroll, reversed)
    scrollRef.current = view.scroll
  }, [view.scrollToken, view.scroll, orientation, reversed])

  // Same level, new data / size / frame: keep the node at the centre where it was.
  const previousLayout = useRef<TimelineLayout | null>(null)
  useLayoutEffect(() => {
    const previous = previousLayout.current
    previousLayout.current = layout
    const container = containerRef.current
    if (!container || !previous || previous === layout || previous.level !== layout.level) return
    const scroll = scrollRef.current
    const centre = nearestNodeIndex(previous, scroll + previous.viewport / 2)
    if (centre < 0) return
    const sameFrameAsBefore = previous.orientation === layout.orientation && previous.reversed === layout.reversed
    for (let distance = 0; distance < previous.nodes.length; distance += 1) {
      for (const index of [centre - distance, centre + distance]) {
        const before = previous.nodes[index]
        const after = before && nodeByKey(layout, before.key)
        if (!before || !after) continue
        const ratio = sameFrameAsBefore ? (before.main - scroll) / previous.viewport : 0.5
        const next = clampScroll(layout, after.main - ratio * layout.viewport)
        writeScroll(container, layout.orientation, next, layout.reversed)
        scrollRef.current = next
        return
      }
    }
  }, [layout])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frame = 0
    const onScroll = () => {
      scrollRef.current = readScroll(container, orientation, reversed)
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const value = scrollRef.current
        setView((state) => (Math.abs(state.scroll - value) < SCROLL_QUANTUM ? state : { ...state, scroll: value }))
      })
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [orientation, reversed])

  // Container size and frame (orientation, side of the newest end) follow the window and the settings.
  const syncFrame = useCallback(() => {
    const container = containerRef.current
    const width = container?.clientWidth ?? 0
    const height = container?.clientHeight ?? 0
    const next = readFrame(latest.current.directions)
    setView((state) => {
      const viewport = width && height ? { width, height } : state.viewport
      const unchanged = state.viewport.width === viewport.width && state.viewport.height === viewport.height && sameFrame(frameOfView(state), next)
      return unchanged ? state : { ...state, viewport, ...next }
    })
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncFrame)
    observer.observe(container)
    return () => observer.disconnect()
  }, [syncFrame])

  // New appearance settings (another admin changed the direction).
  const { desktop: desktopDirection, mobile: mobileDirection } = directions
  useEffect(() => {
    const frame = requestAnimationFrame(syncFrame)
    return () => cancelAnimationFrame(frame)
  }, [desktopDirection, mobileDirection, syncFrame])

  // ── Timers ─────────────────────────────────────────────────────────────────────────────
  const transitionId = view.transition?.id
  const transitionDuration = view.transition?.duration ?? 0
  useEffect(() => {
    if (transitionId === undefined) return
    const timer = window.setTimeout(() => {
      setView((state) => (state.transition?.id === transitionId ? { ...state, transition: null } : state))
    }, transitionDuration + 120)
    return () => window.clearTimeout(timer)
  }, [transitionId, transitionDuration])

  const pulseToken = view.pulse?.token
  useEffect(() => {
    if (pulseToken === undefined || paused) return
    const timer = window.setTimeout(() => {
      setView((state) => (state.pulse?.token === pulseToken ? { ...state, pulse: null } : state))
    }, PULSE_DURATION)
    return () => window.clearTimeout(timer)
  }, [pulseToken, paused])

  // ── Focus ──────────────────────────────────────────────────────────────────────────────
  const activeKey = view.activeKey && layout.indexByKey.has(view.activeKey)
    ? view.activeKey
    : (layout.nodes[nearestNodeIndex(layout, view.scroll + viewportMain / 2)]?.key ?? null)

  const appliedFocusToken = useRef(0)
  useLayoutEffect(() => {
    if (appliedFocusToken.current === view.focusToken) return
    appliedFocusToken.current = view.focusToken
    const key = latest.current.view.activeKey
    if (!key) return
    const element = containerRef.current?.querySelector<HTMLElement>(`[data-node-key="${key}"]`)
    element?.focus({ preventScroll: true })
  }, [view.focusToken])

  const bringIntoView = useCallback(
    (key: string) => {
      const container = containerRef.current
      const { layout: current, reducedMotion: reduced } = latest.current
      const node = nodeByKey(current, key)
      if (!container || !node) return
      const scroll = readScroll(container, current.orientation, current.reversed)
      const screen = node.main - scroll
      const margin = Math.min(220, current.viewport * 0.2)
      if (screen < margin || screen > current.viewport - margin) {
        scrollTo(node.main - current.viewport / 2, !reduced)
      }
    },
    [scrollTo],
  )

  // ── Opening sweep ──────────────────────────────────────────────────────────────────────
  // Asked for on mount: the page remembers it was shown (even when reduced motion skips it).
  const introRequested = useRef(intro)
  useEffect(() => {
    if (introRequested.current) latest.current.onIntro?.()
  }, [])

  /** Ends the sweep: completed, the newest milestone pulses and the line glides to its resting place. */
  const finishSweep = useCallback(
    (completed: boolean) => {
      if (!latest.current.view.sweep) return
      const newest = latest.current.layout.nodes[0]
      setView((state) =>
        state.sweep
          ? {
              ...state,
              sweep: null,
              activeKey: completed && newest ? newest.key : state.activeKey,
              pulse: completed && newest?.kind === 'event' ? { key: newest.key, token: (state.pulse?.token ?? 0) + 1 } : state.pulse,
            }
          : state,
      )
      if (completed) scrollTo(0, true)
    },
    [scrollTo],
  )

  const sweep = view.sweep
  useEffect(() => {
    const container = containerRef.current
    const track = trackRef.current
    if (!sweep || !container || !track) return
    let frame = requestAnimationFrame(tick)
    function tick() {
      const { layout: current } = latest.current
      // Same clock as the start and the nodes' own timers (not the frame's timestamp).
      const elapsed = (performance.now() - (sweep?.start ?? 0)) / 1000
      const plan = sweep?.plan
      const newest = current.nodes[0]
      const oldest = current.nodes.at(-1)
      if (!plan || !newest || !oldest || !container || !track) return
      // The current layout's ends (the viewport may have been measured since the plan was made).
      const front = sweepFront({ ...plan, from: oldest.main, to: newest.main }, elapsed)
      const scroll = sweepScroll(current, front)
      writeScroll(container, current.orientation, scroll, current.reversed)
      scrollRef.current = scroll
      track.style.setProperty('--sweep-clip', sweepClip(current, front))
      const fronts = frontsRef.current?.querySelectorAll<HTMLElement>('[data-front]')
      if (fronts) placeFronts(current, front, fronts)
      if (elapsed >= sweepLength(plan)) finishSweep(true)
      else frame = requestAnimationFrame(tick)
    }
    return () => cancelAnimationFrame(frame)
  }, [sweep, finishSweep])

  // Any interaction (scroll, drag, pinch, keys, focus, the zoom controls) ends it at once.
  useEffect(() => {
    const root = rootRef.current
    if (!sweep || !root) return
    const stop = () => finishSweep(false)
    const types = ['pointerdown', 'wheel', 'touchstart', 'focusin'] as const
    for (const type of types) root.addEventListener(type, stop, { passive: true })
    window.addEventListener('keydown', stop)
    return () => {
      for (const type of types) root.removeEventListener(type, stop)
      window.removeEventListener('keydown', stop)
    }
  }, [sweep, finishSweep])

  // Roving focus along the line: the arrow pointing at the newest end goes newer, the opposite
  // one older (↑/← newer, ↓/→ older across the line), Home/End; native listeners on the list.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { layout: current, view: state } = latest.current
      const steps = arrowSteps(current)
      const fromKey = nodeKeyOf(event.target) ?? state.activeKey
      const index = fromKey ? (current.indexByKey.get(fromKey) ?? -1) : -1
      let next: number
      if (event.key in steps) next = Math.min(current.nodes.length - 1, Math.max(0, index + steps[event.key]))
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = current.nodes.length - 1
      else return
      event.preventDefault()
      const key = current.nodes[next]?.key
      if (!key || key === fromKey) return
      setView((value) => ({ ...value, activeKey: key, focusToken: value.focusToken + 1 }))
      bringIntoView(key)
    }
    function onFocusIn(event: globalThis.FocusEvent) {
      const key = nodeKeyOf(event.target)
      if (key) setView((state) => (state.activeKey === key ? state : { ...state, activeKey: key }))
    }
    list.addEventListener('keydown', onKeyDown)
    list.addEventListener('focusin', onFocusIn)
    return () => {
      list.removeEventListener('keydown', onKeyDown)
      list.removeEventListener('focusin', onFocusIn)
    }
  }, [bringIntoView])

  // `+` / `=` and `-` zoom (unless typing, inside an overlay, or with browser modifiers).
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const direction = keyZoomDirection(event)
      if (!direction || event.defaultPrevented || latest.current.paused) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.isContentEditable || target?.closest('input, textarea, select, [role="dialog"], [role="menu"], [role="listbox"]')) return
      const inside = Boolean(target && rootRef.current?.contains(target))
      if (!inside && target && target !== document.body && !target.closest('main')) return
      event.preventDefault()
      const key = inside ? nodeKeyOf(target) : null
      // Keyboard focus follows the zoom only when it was on a node of the line.
      zoomStep(direction, key ? { anchorKey: key, moveFocus: true } : {})
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [zoomStep])

  // ── Item callbacks ─────────────────────────────────────────────────────────────────────
  const handleOpenEvent = useCallback((key: string, eventId: number, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const circle = event.currentTarget.querySelector('[data-circle]') ?? event.currentTarget
    const rect = circle.getBoundingClientRect()
    setView((state) => (state.activeKey === key ? state : { ...state, activeKey: key }))
    latest.current.onOpenEvent(eventId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  }, [])

  const handleActivateHub = useCallback(
    (key: string) => zoomStep('in', { anchorKey: key, moveFocus: true }),
    [zoomStep],
  )

  // ── Render ─────────────────────────────────────────────────────────────────────────────
  const overscan = Math.max(360, viewportMain)
  const windowStart = view.scroll - overscan
  const windowEnd = view.scroll + viewportMain + overscan
  const [start, end] = rangeIndices(layout.nodes, windowStart, windowEnd)
  const visible = layout.nodes.slice(start, end)
  for (const key of [activeKey, view.pulse?.key]) {
    const node = nodeByKey(layout, key)
    if (node && (node.index < start || node.index >= end) && !visible.includes(node)) visible.push(node)
  }
  const transition = view.transition
  const pulse = !paused && view.pulse ? view.pulse : null
  const setSize = layout.nodes.length
  const listLabel = t(`timeline.listLabel.${level}`, { count: setSize })
  const trackStyle = (horizontal ? { width: layout.length } : { height: layout.length }) as CSSProperties & Record<string, string | number>
  // Initial clip of the sweep; later frames update the custom property directly.
  if (sweep) trackStyle['--sweep-clip'] = sweepClip(layout, sweep.plan.from)

  return (
    <section
      ref={rootRef}
      className={styles.root}
      data-orientation={orientation}
      data-newest={reversed ? 'end' : 'start'}
      data-level={level}
      data-transitioning={transition && transition.ghosts.length > 0 ? '' : undefined}
      data-sweeping={sweep ? '' : undefined}
      aria-label={label}
    >
      {transition && transition.ghosts.length > 0 && (
        <TimelineGhosts
          key={transition.id}
          transition={transition}
          model={model}
          palette={palette}
          eventCategories={eventCategories}
          orientation={orientation}
          reversed={reversed}
          labelWidth={labelWidth}
        />
      )}
      <div ref={containerRef} className={styles.viewport}>
        <div ref={trackRef} className={styles.track} style={trackStyle}>
          <div className={styles.axisLayer}>
            <TimelineAxis
              layout={layout}
              palette={palette}
              from={windowStart}
              to={windowEnd}
              revealDelay={transition ? transition.markersDelay : null}
            />
            <TimelineLanes
              layout={layout}
              people={model.lanes}
              from={windowStart}
              to={windowEnd}
              revealDelay={transition ? transition.markersDelay : null}
              avatarSize={horizontal && !view.compact ? 32 : 28}
            />
          </div>
          {sweep && (
            <div ref={frontsRef} className={styles.sweepFronts} aria-hidden="true">
              {layout.lanes.length > 0 ? (
                layout.lanes.map((lane) => (
                  <span
                    key={lane.id}
                    className={styles.sweepFront}
                    data-front=""
                    data-lane={lane.id}
                    style={
                      {
                        transform: slotTransform(layout, sweep.plan.from, laneCrossAt(lane, sweep.plan.from)),
                        opacity: sweep.plan.from <= lane.tail + 0.5 ? 1 : 0,
                        '--front-color': themeColors.lane(lane.index, model.lanes[lane.index]?.color),
                      } as CSSProperties
                    }
                  />
                ))
              ) : (
                <span className={styles.sweepFront} data-front="" style={{ transform: slotTransform(layout, sweep.plan.from) }} />
              )}
            </div>
          )}
          <div ref={listRef} role="list" aria-label={listLabel} className={styles.list}>
            {visible.map((node) => {
              const entry = model.byKey.get(node.key)
              if (!entry) return null
              const colors =
                entry.kind === 'year'
                  ? palette.year(entry.year)
                  : entry.kind === 'month'
                    ? palette.month(entry.year, entry.month)
                    : undefined
              return (
                <TimelineItem
                  key={node.key}
                  node={node}
                  entry={entry}
                  categories={entry.kind === 'event' ? eventCategories.get(entry.key) : undefined}
                  colors={colors}
                  people={eventPeople?.get(entry.key)}
                  orientation={orientation}
                  reversed={reversed}
                  transform={slotTransform(layout, node.main, node.cross)}
                  setSize={setSize}
                  enter={transition?.enter.get(node.key)}
                  sweepAt={sweep ? (sweep.plan.times.get(node.key) ?? 0) : null}
                  sweepStart={sweep?.start ?? 0}
                  tabIndex={node.key === activeKey ? 0 : -1}
                  pulse={pulse?.key === node.key ? pulse.token : null}
                  href={entry.kind === 'event' ? eventHref(entry.event.id) : undefined}
                  labelWidth={labelWidth}
                  onOpenEvent={handleOpenEvent}
                  onActivateHub={handleActivateHub}
                />
              )
            })}
          </div>
        </div>
      </div>
      {horizontal && <TimelinePeriod model={model} layout={layout} palette={palette} centre={view.scroll + viewportMain / 2} />}
      <ZoomControls
        level={level}
        onLevelChange={(next) => zoomTo(next)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        inset={horizontal ? controlsInset : 0}
      />
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {view.announcement}
      </div>
    </section>
  )
}
