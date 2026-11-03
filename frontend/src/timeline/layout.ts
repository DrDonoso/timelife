import { entriesAt, type TimelineEntry, type TimelineLane, type TimelineModel } from './model'
import type { NodeKind, Orientation, ZoomLevel } from './types'

/**
 * Pure ordinal layout engine (no DOM): evenly spaced node slots along the main axis (x when
 * horizontal, y when vertical), newest first, with extra space + boundary markers where the month
 * (events level) or the year (events and months levels) changes. Year and month hubs grow with
 * their number of milestones (the busiest hub of the level gets the largest size) while the space
 * between neighbouring circles stays the same. Positions are node centres in px from the start of
 * the scroll track.
 */

export interface LevelMetrics {
  /** Distance between consecutive node centres (with hubs: for hubs of `node` diameter). */
  slot: number
  /** Node diameter (events level; hubs use `hubSize`). */
  node: number
  /** Hub levels: diameter of the hub with the fewest → the most milestones (see {@link hubSize}). */
  hubSize?: readonly [min: number, max: number]
  /** Extra space holding a year marker (start of every year group). */
  yearGap: number
  /** Extra space holding a month marker (events level only). */
  monthGap: number
  /** Moves markers off-centre inside their gap (vertical events: titles sit above the circles). */
  markerShift: number
}

export interface OrientationMetrics {
  paddingStart: number
  paddingEnd: number
  levels: Readonly<Record<ZoomLevel, LevelMetrics>>
}

export const TIMELINE_METRICS: Readonly<Record<Orientation, OrientationMetrics>> = {
  horizontal: {
    paddingStart: 88,
    paddingEnd: 160,
    levels: {
      years: { slot: 260, node: 148, hubSize: [116, 184], yearGap: 0, monthGap: 0, markerShift: 0 },
      months: { slot: 176, node: 104, hubSize: [76, 132], yearGap: 112, monthGap: 0, markerShift: 0 },
      events: { slot: 184, node: 104, yearGap: 100, monthGap: 168, markerShift: 0 },
    },
  },
  vertical: {
    paddingStart: 28,
    paddingEnd: 140,
    levels: {
      years: { slot: 196, node: 124, hubSize: [100, 148], yearGap: 0, monthGap: 0, markerShift: 0 },
      months: { slot: 140, node: 88, hubSize: [64, 108], yearGap: 64, monthGap: 0, markerShift: 0 },
      events: { slot: 200, node: 88, yearGap: 52, monthGap: 64, markerShift: -16 },
    },
  },
}

/** Horizontal line on a phone (a direction setting can ask for it): smaller circles and gaps. */
export const COMPACT_HORIZONTAL_METRICS: OrientationMetrics = {
  paddingStart: 48,
  paddingEnd: 72,
  levels: {
    years: { slot: 196, node: 124, hubSize: [100, 148], yearGap: 0, monthGap: 0, markerShift: 0 },
    months: { slot: 140, node: 88, hubSize: [64, 108], yearGap: 88, monthGap: 0, markerShift: 0 },
    events: { slot: 156, node: 88, yearGap: 84, monthGap: 136, markerShift: 0 },
  },
}

/** Metrics of a frame: the orientation's, or the compact ones for a horizontal line on a phone. */
export function metricsFor(orientation: Orientation, compact = false): OrientationMetrics {
  return compact && orientation === 'horizontal' ? COMPACT_HORIZONTAL_METRICS : TIMELINE_METRICS[orientation]
}

/**
 * Diameter of a hub holding `count` milestones when the busiest hub of its level holds `maxCount`:
 * `min + (max − min) · √(count / maxCount)`, so small differences stay visible at the low end.
 */
export function hubSize(count: number, maxCount: number, [min, max]: readonly [number, number]): number {
  if (!(maxCount > 0)) return max
  const ratio = Math.min(1, Math.max(0, count / maxCount))
  return Math.round(min + (max - min) * Math.sqrt(ratio))
}

export interface LayoutNode {
  key: string
  kind: NodeKind
  /** Position in the level's list (0 = newest). */
  index: number
  /** Centre along the main axis. */
  main: number
  /** Offset across the axis (0 = on the line; family timeline: the child's lane, see {@link LayoutLane}). */
  cross: number
  /** Diameter. */
  size: number
  year: number
  /** 1..12, `null` for year nodes. */
  month: number | null
  /** Distance from the centre back to the start of the boundary markers right before this node (or half a slot). */
  lead: number
}

export interface LayoutMarker {
  /** `by2026` (year) or `bm2026-03` (month). */
  key: string
  kind: 'year' | 'month'
  main: number
  year: number
  month: number | null
}

/** Main-axis extent of every year (used to tint the axis line by year colour). */
export interface YearSpan {
  year: number
  start: number
  end: number
}

/**
 * Piece of a lane's line between two main-axis positions: straight when `c0 === c1`, otherwise an
 * S-curve whose cross offset follows smoothstep (a cubic Bézier with its control points at thirds).
 */
export interface LaneSegment {
  from: number
  to: number
  /** Cross offsets at `from` and at `to`. */
  c0: number
  c1: number
}

/**
 * A child's own line on the family timeline (events level): it starts at the newest end (where the
 * child's avatar sits), runs along its own cross offset through the child's milestones and curves
 * into the shared ones (placed between the lanes they belong to); it ends at the child's oldest one.
 */
export interface LayoutLane {
  /** Child id. */
  id: number
  /** Position in the model's lanes (stable colour whatever the filters). */
  index: number
  /** Cross offset of the lane's own line. */
  offset: number
  /** Main-axis start of the line, at the newest end. */
  head: number
  /** Main-axis end of the line (its oldest milestone). */
  tail: number
  /** From the head to the tail, contiguous. */
  segments: readonly LaneSegment[]
}

export interface TimelineLayout {
  level: ZoomLevel
  orientation: Orientation
  /** Shown mirrored: the newest milestone at the right / bottom end (see `direction.ts`). */
  reversed: boolean
  /** Main-axis size of the viewport the layout was computed for. */
  viewport: number
  nodes: readonly LayoutNode[]
  markers: readonly LayoutMarker[]
  years: readonly YearSpan[]
  /** Family timeline at the events level, with milestones of two or more children: one line each (else empty). */
  lanes: readonly LayoutLane[]
  /** Scrollable track length (≥ viewport). */
  length: number
  /** Visible extent of the axis line. */
  axisStart: number
  axisEnd: number
  indexByKey: ReadonlyMap<string, number>
}

export interface LayoutOptions {
  orientation: Orientation
  /** Main-axis viewport size: short timelines are centred in it. */
  viewport: number
  /**
   * Mirrored frame: positions stay logical (newest first), but the paddings and marker shifts are
   * swapped so that they keep their place on screen.
   */
  reversed?: boolean
  /** Phone-sized screen (compact metrics for a horizontal line). */
  compact?: boolean
  metrics?: OrientationMetrics
}

const AXIS_OVERHANG = 40

const NO_LANES: readonly LayoutLane[] = []
/** Room between two neighbouring lanes beyond a circle's diameter. */
const LANE_MARGIN = 56
/** Lanes spread over at most this many gaps (horizontal; vertical lines are on narrow screens). */
const LANE_SPREAD = { horizontal: 2, vertical: 1.5 } as const
/** Merged lines run side by side, this far apart, like the strands of a cord. */
const LANE_STRAND = 3.5
/** Length of a lane's curve towards / away from a shared milestone, in slots. */
const LANE_EASE = 0.8

interface LanePoint {
  main: number
  cross: number
}

/** Segments joining two consecutive points of a lane whose own offset is `own` (see {@link LayoutLane}). */
function linkLane(a: LanePoint, b: LanePoint, own: number, ease: number, out: LaneSegment[]): void {
  const distance = b.main - a.main
  const push = (from: number, to: number, c0: number, c1: number) => {
    if (to > from) out.push({ from, to, c0, c1 })
  }
  if (a.cross === b.cross && (a.cross === own || distance <= 2 * ease)) {
    push(a.main, b.main, a.cross, b.cross)
  } else if (a.cross === own) {
    const curve = Math.min(distance, ease)
    push(a.main, b.main - curve, own, own)
    push(b.main - curve, b.main, own, b.cross)
  } else if (b.cross === own) {
    const curve = Math.min(distance, ease)
    push(a.main, a.main + curve, a.cross, own)
    push(a.main + curve, b.main, own, own)
  } else if (distance <= 2 * ease) {
    push(a.main, b.main, a.cross, b.cross)
  } else {
    // Between two shared milestones far apart, the line goes back to its own place meanwhile.
    push(a.main, a.main + ease, a.cross, own)
    push(a.main + ease, b.main - ease, own, own)
    push(b.main - ease, b.main, own, b.cross)
  }
}

/**
 * Family timeline at the events level: one lane per child with milestones (in the model's order,
 * centred across the axis); shared milestones sit at the mean offset of their children's lanes.
 * Sets the nodes' `cross`; fewer than two lanes → a single line (no lanes).
 */
function placeLanes(
  lanes: readonly TimelineLane[],
  entries: readonly TimelineEntry[],
  nodes: LayoutNode[],
  head: number,
  sizes: LevelMetrics,
  orientation: Orientation,
): readonly LayoutLane[] {
  if (lanes.length < 2) return NO_LANES
  const members = entries.map((entry) => (entry.kind === 'event' ? entry.event.child_ids : []))
  const present = lanes.flatMap((lane, index) => (members.some((ids) => ids.includes(lane.id)) ? [{ id: lane.id, index }] : []))
  if (present.length < 2) return NO_LANES

  const span = present.length - 1
  const gap = Math.min(sizes.node + LANE_MARGIN, ((sizes.node + LANE_MARGIN) * LANE_SPREAD[orientation]) / span)
  const offsets = new Map(present.map((lane, position) => [lane.id, (position - span / 2) * gap]))
  const strands = new Map(present.map((lane, position) => [lane.id, (position - span / 2) * LANE_STRAND]))
  const owners = members.map((ids) => ids.filter((id) => offsets.has(id)))
  nodes.forEach((node, index) => {
    const own = owners[index]
    if (own.length > 0) node.cross = own.reduce((sum, id) => sum + (offsets.get(id) ?? 0), 0) / own.length
  })

  const ease = sizes.slot * LANE_EASE
  return present.map(({ id, index }) => {
    const own = offsets.get(id) ?? 0
    const strand = strands.get(id) ?? 0
    const points: LanePoint[] = [{ main: head, cross: own }]
    nodes.forEach((node, position) => {
      const ids = owners[position]
      if (ids.includes(id)) points.push({ main: node.main, cross: ids.length > 1 ? node.cross + strand : node.cross })
    })
    const segments: LaneSegment[] = []
    for (let point = 1; point < points.length; point += 1) linkLane(points[point - 1], points[point], own, ease, segments)
    return { id, index, offset: own, head, tail: points.at(-1)?.main ?? head, segments }
  })
}

/** Cross offset of a lane's line at the main-axis position `main` (its ends beyond them). */
export function laneCrossAt(lane: LayoutLane, main: number): number {
  const { segments } = lane
  const first = segments[0]
  if (!first) return lane.offset
  if (main <= first.from) return first.c0
  let low = 0
  let high = segments.length - 1
  while (low < high) {
    const mid = (low + high + 1) >>> 1
    if (segments[mid].from <= main) low = mid
    else high = mid - 1
  }
  const segment = segments[low]
  if (main >= segment.to) return segment.c1
  const progress = (main - segment.from) / (segment.to - segment.from)
  return segment.c0 + (segment.c1 - segment.c0) * progress * progress * (3 - 2 * progress)
}

export function computeLayout(
  model: TimelineModel,
  level: ZoomLevel,
  { orientation, viewport, reversed = false, compact = false, metrics }: LayoutOptions,
): TimelineLayout {
  const chosen = metrics ?? metricsFor(orientation, compact)
  const [paddingStart, paddingEnd] = reversed ? [chosen.paddingEnd, chosen.paddingStart] : [chosen.paddingStart, chosen.paddingEnd]
  const sizes = chosen.levels[level]
  const markerShift = reversed ? -sizes.markerShift : sizes.markerShift
  const entries = entriesAt(model, level)
  const range = sizes.hubSize
  // Space between neighbouring circles: hubs keep it whatever their size.
  const spacing = sizes.slot - sizes.node
  let maxCount = 0
  if (range) for (const entry of entries) if (entry.kind !== 'event') maxCount = Math.max(maxCount, entry.count)
  const nodes: LayoutNode[] = []
  const markers: LayoutMarker[] = []
  const years: YearSpan[] = []
  let cursor = paddingStart
  let previousYear: number | null = null
  let previousMonth: string | null = null

  for (const entry of entries) {
    const month = entry.kind === 'year' ? null : entry.month
    const leadStart = cursor
    if (entry.year !== previousYear) {
      years.push({ year: entry.year, start: cursor, end: cursor })
      if (level !== 'years' && sizes.yearGap > 0) {
        const main = cursor + sizes.yearGap / 2 + markerShift
        markers.push({ key: `by${entry.year}`, kind: 'year', main, year: entry.year, month: null })
        cursor += sizes.yearGap
      }
      previousYear = entry.year
    }
    if (entry.kind === 'event' && entry.monthKey !== previousMonth) {
      if (sizes.monthGap > 0) {
        const main = cursor + sizes.monthGap / 2 + markerShift
        markers.push({ key: `b${entry.monthKey}`, kind: 'month', main, year: entry.year, month })
        cursor += sizes.monthGap
      }
      previousMonth = entry.monthKey
    }
    const size = range && entry.kind !== 'event' ? hubSize(entry.count, maxCount, range) : sizes.node
    const slot = range ? size + spacing : sizes.slot
    const main = cursor + slot / 2
    nodes.push({ key: entry.key, kind: entry.kind, index: nodes.length, main, cross: 0, size, year: entry.year, month, lead: main - leadStart })
    cursor += slot
    const span = years.at(-1)
    if (span) span.end = cursor
  }

  const blocks = cursor - paddingStart
  const natural = paddingStart + blocks + paddingEnd
  // Short timelines are centred in the viewport instead of hugging the start.
  const offset = natural < viewport ? (viewport - blocks) / 2 - paddingStart : 0
  if (offset !== 0) {
    for (const node of nodes) node.main += offset
    for (const marker of markers) marker.main += offset
    for (const span of years) {
      span.start += offset
      span.end += offset
    }
  }
  const length = Math.max(viewport, natural)
  const first = years[0]?.start ?? paddingStart + offset
  const last = years.at(-1)?.end ?? first
  // The lanes start beside the newest year chip (or half a slot before the newest milestone).
  const head = markers[0]?.main ?? (nodes[0] ? nodes[0].main - sizes.slot / 2 : first)
  const lanes = level === 'events' ? placeLanes(model.lanes, entries, nodes, head, sizes, orientation) : NO_LANES

  return {
    level,
    orientation,
    reversed,
    viewport,
    nodes,
    markers,
    years,
    lanes,
    length,
    axisStart: Math.max(0, first - AXIS_OVERHANG),
    axisEnd: Math.min(length, last + AXIS_OVERHANG),
    indexByKey: new Map(nodes.map((node) => [node.key, node.index])),
  }
}

const cache = new WeakMap<TimelineModel, Map<string, TimelineLayout>>()
const CACHE_LIMIT = 12

/** {@link computeLayout} memoised per model (handlers and render share the same result). */
export function cachedLayout(model: TimelineModel, level: ZoomLevel, options: LayoutOptions): TimelineLayout {
  if (options.metrics) return computeLayout(model, level, options)
  let layouts = cache.get(model)
  if (!layouts) {
    layouts = new Map()
    cache.set(model, layouts)
  }
  const key = `${level}|${options.orientation}|${options.reversed ? 'r' : ''}${options.compact ? 'c' : ''}|${Math.round(options.viewport)}`
  let layout = layouts.get(key)
  if (!layout) {
    if (layouts.size >= CACHE_LIMIT) layouts.clear()
    layout = computeLayout(model, level, { ...options, viewport: Math.round(options.viewport) })
    layouts.set(key, layout)
  }
  return layout
}

export function nodeByKey(layout: TimelineLayout, key: string | null | undefined): LayoutNode | undefined {
  if (key == null) return undefined
  const index = layout.indexByKey.get(key)
  return index === undefined ? undefined : layout.nodes[index]
}

/** First index whose `main` is ≥ `value` (items sorted by `main`). */
function lowerBound(items: readonly { main: number }[], value: number): number {
  let low = 0
  let high = items.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (items[mid].main < value) low = mid + 1
    else high = mid
  }
  return low
}

/** `[start, end)` indices of the items whose centre lies in `[from, to]`. */
export function rangeIndices(items: readonly { main: number }[], from: number, to: number): [number, number] {
  return [lowerBound(items, from), lowerBound(items, to + 0.001)]
}

/** Index of the node closest to `main` (-1 when there are none). */
export function nearestNodeIndex(layout: TimelineLayout, main: number): number {
  const { nodes } = layout
  if (nodes.length === 0) return -1
  const index = lowerBound(nodes, main)
  if (index === 0) return 0
  if (index >= nodes.length) return nodes.length - 1
  return main - nodes[index - 1].main <= nodes[index].main - main ? index - 1 : index
}

export function maxScroll(layout: TimelineLayout): number {
  return Math.max(0, layout.length - layout.viewport)
}

export function clampScroll(layout: TimelineLayout, scroll: number): number {
  return Math.min(maxScroll(layout), Math.max(0, scroll))
}

/** Scroll offset that puts `key` in the middle of the viewport (clamped). */
export function scrollToCenter(layout: TimelineLayout, key: string | null | undefined): number | null {
  const node = nodeByKey(layout, key)
  return node ? clampScroll(layout, node.main - layout.viewport / 2) : null
}
