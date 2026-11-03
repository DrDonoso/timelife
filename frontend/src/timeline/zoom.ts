import { clampScroll, nodeByKey, rangeIndices, type TimelineLayout } from './layout'
import { ancestorKey, descendantKeys, type TimelineModel } from './model'
import { levelDepth, ZOOM_LEVELS, type NodeKind, type ZoomLevel } from './types'

/**
 * Zoom math (pure): level steps, anchoring (the node under the pointer / at the centre keeps its
 * screen position), burst origins for zooming in, merge targets for zooming out, stagger, and the
 * gesture helpers (wheel delta accumulation, pinch thresholds, keyboard shortcuts).
 *
 * "Screen" positions are main-axis offsets from the viewport start (`main - scroll`).
 */

export type ZoomDirection = 'in' | 'out'

export function zoomInLevel(level: ZoomLevel): ZoomLevel | null {
  return ZOOM_LEVELS[levelDepth(level) + 1] ?? null
}

export function zoomOutLevel(level: ZoomLevel): ZoomLevel | null {
  return ZOOM_LEVELS[levelDepth(level) - 1] ?? null
}

export function stepLevel(level: ZoomLevel, direction: ZoomDirection): ZoomLevel | null {
  return direction === 'in' ? zoomInLevel(level) : zoomOutLevel(level)
}

export function zoomDirection(from: ZoomLevel, to: ZoomLevel): ZoomDirection | null {
  const delta = levelDepth(to) - levelDepth(from)
  return delta === 0 ? null : delta > 0 ? 'in' : 'out'
}

/** How a node arrives: burst out of its parent, pop in (zoom out), first-load reveal, or a plain fade. */
export type EnterKind = 'burst' | 'pop' | 'intro' | 'fade'

export interface EnterSpec {
  kind: EnterKind
  /** Start offset along the main axis relative to the final slot (burst origin = parent centre). */
  offset: number
  /** Seconds. */
  delay: number
}

/** Old-level nodes kept on screen during a transition: burst sources (zoom in) or merging children (zoom out). */
export type GhostMode = 'source' | 'merge' | 'fade'

export interface GhostSpec {
  key: string
  kind: NodeKind
  /** Screen position when the transition starts. */
  from: number
  /** Screen position it travels to (the parent's new position when merging). */
  to: number
  /** Seconds. */
  delay: number
  mode: GhostMode
  /** The node the zoom was anchored on (its pulse is the most visible one). */
  isAnchor: boolean
}

export interface ZoomPlan {
  from: ZoomLevel
  to: ZoomLevel
  direction: ZoomDirection
  anchorKey: string
  /** Node that represents the anchor on the new level (focus + URL `focus`). */
  focusKey: string | null
  /** New scroll offset. */
  scroll: number
  enter: ReadonlyMap<string, EnterSpec>
  ghosts: readonly GhostSpec[]
  /** Milliseconds until every animation has settled. */
  duration: number
}

export interface PlanZoomInput {
  model: TimelineModel
  from: TimelineLayout
  to: TimelineLayout
  anchorKey: string
  /** Scroll offset when the zoom starts. */
  scroll: number
  /** Overrides the anchored scroll (e.g. to centre a searched event). */
  targetScroll?: number | null
  reducedMotion?: boolean
}

/** Nodes this far outside the viewport still animate; the rest simply appear. */
export const ANIMATION_MARGIN = 160
/** Upper bound for distance-based stagger (seconds). */
export const MAX_STAGGER = 0.4
const STAGGER_PER_PX = 0.00045
/** Children start bursting once the parent's pulse peaks. */
export const PULSE_LEAD = 0.12
/** Parents pop in while their children are still converging. */
export const MERGE_LEAD = 0.16
const MAX_ANIMATED_NODES = 90
const REDUCED_DURATION = 200
/** Space kept between the viewport start and the first chip of a group zoomed into. */
const EDGE_GAP = 8

/** Distance-based delay (seconds), capped at {@link MAX_STAGGER}. */
export function staggerDelay(distance: number, cap = MAX_STAGGER): number {
  return Math.min(cap, Math.abs(distance) * STAGGER_PER_PX)
}

function bandIndices(layout: TimelineLayout, scroll: number): [number, number] {
  return rangeIndices(layout.nodes, scroll - ANIMATION_MARGIN, scroll + layout.viewport + ANIMATION_MARGIN)
}

/**
 * Where the new level should scroll so the anchor stays put: zooming out puts the anchor's
 * ancestor exactly where the anchor was; zooming in centres the anchor's children on it, keeping
 * the newest child on screen when the group is wider than the viewport.
 */
export function anchoredScroll(input: Omit<PlanZoomInput, 'reducedMotion' | 'targetScroll'>): { scroll: number; focusKey: string | null } {
  const { model, from, to, anchorKey, scroll } = input
  const anchor = nodeByKey(from, anchorKey)
  const anchorScreen = anchor ? anchor.main - scroll : from.viewport / 2
  const direction = zoomDirection(from.level, to.level)

  if (direction === 'out') {
    const focusKey = ancestorKey(model, anchorKey, to.level)
    const parent = nodeByKey(to, focusKey)
    return { scroll: clampScroll(to, parent ? parent.main - anchorScreen : scroll), focusKey: parent ? focusKey : null }
  }

  const children = descendantKeys(model, anchorKey, to.level)
  const first = nodeByKey(to, children[0])
  const last = nodeByKey(to, children.at(-1))
  if (!first || !last) return { scroll: clampScroll(to, scroll), focusKey: null }
  const viewport = to.viewport
  const margin = Math.min(120, viewport * 0.12)
  const span = last.main - first.main
  let firstScreen = anchorScreen - span / 2
  firstScreen = Math.min(firstScreen, viewport - margin - span)
  // Never push the newest child (nor the month / year chips right before it) off the start.
  firstScreen = Math.max(firstScreen, margin, first.lead + EDGE_GAP)
  return { scroll: clampScroll(to, first.main - firstScreen), focusKey: first.key }
}

/** Full transition plan between two levels of the same model. */
export function planZoom(input: PlanZoomInput): ZoomPlan {
  const { model, from, to, anchorKey, scroll, targetScroll = null, reducedMotion = false } = input
  const direction = zoomDirection(from.level, to.level) ?? 'in'
  const anchored = anchoredScroll(input)
  const nextScroll = targetScroll === null ? anchored.scroll : clampScroll(to, targetScroll)
  const focusKey = anchored.focusKey
  const anchor = nodeByKey(from, anchorKey)
  const anchorScreen = anchor ? anchor.main - scroll : from.viewport / 2

  const enter = new Map<string, EnterSpec>()
  const ghosts: GhostSpec[] = []
  const [enterStart, enterEnd] = bandIndices(to, nextScroll)
  const [ghostStart, ghostEnd] = bandIndices(from, scroll)
  let maxDelay = 0

  for (let index = enterStart; index < enterEnd && enter.size < MAX_ANIMATED_NODES; index += 1) {
    const node = to.nodes[index]
    const screen = node.main - nextScroll
    if (reducedMotion) {
      enter.set(node.key, { kind: 'fade', offset: 0, delay: 0 })
      continue
    }
    if (direction === 'in') {
      const parent = nodeByKey(from, ancestorKey(model, node.key, from.level))
      // Burst from the parent's centre as it was on screen, expressed in the new track.
      const origin = parent ? parent.main - scroll + nextScroll : node.main
      const delay = PULSE_LEAD + staggerDelay(screen - anchorScreen)
      maxDelay = Math.max(maxDelay, delay)
      enter.set(node.key, { kind: 'burst', offset: origin - node.main, delay })
    } else {
      const delay = MERGE_LEAD + staggerDelay(screen - anchorScreen, 0.24)
      maxDelay = Math.max(maxDelay, delay)
      enter.set(node.key, { kind: 'pop', offset: 0, delay })
    }
  }

  for (let index = ghostStart; index < ghostEnd && ghosts.length < MAX_ANIMATED_NODES; index += 1) {
    const node = from.nodes[index]
    const screen = node.main - scroll
    const isAnchor = node.key === anchorKey
    if (reducedMotion) {
      ghosts.push({ key: node.key, kind: node.kind, from: screen, to: screen, delay: 0, mode: 'fade', isAnchor })
    } else if (direction === 'in') {
      ghosts.push({ key: node.key, kind: node.kind, from: screen, to: screen, delay: 0, mode: 'source', isAnchor })
    } else {
      const parent = nodeByKey(to, ancestorKey(model, node.key, to.level))
      const target = parent ? parent.main - nextScroll : screen
      ghosts.push({ key: node.key, kind: node.kind, from: screen, to: target, delay: staggerDelay(screen - anchorScreen, 0.1), mode: 'merge', isAnchor })
    }
  }

  const duration = reducedMotion ? REDUCED_DURATION : Math.round((maxDelay + (direction === 'in' ? 0.85 : 0.75)) * 1000)
  return { from: from.level, to: to.level, direction, anchorKey, focusKey, scroll: nextScroll, enter, ghosts, duration }
}

/** First-load reveal: nodes rise into place in a wave from the start of the timeline. */
export function planIntro(layout: TimelineLayout, scroll: number, reducedMotion = false): ReadonlyMap<string, EnterSpec> {
  const enter = new Map<string, EnterSpec>()
  const [start, end] = bandIndices(layout, scroll)
  for (let index = start; index < end && enter.size < MAX_ANIMATED_NODES; index += 1) {
    const node = layout.nodes[index]
    const screen = Math.max(0, node.main - scroll)
    enter.set(node.key, reducedMotion ? { kind: 'fade', offset: 0, delay: 0 } : { kind: 'intro', offset: 0, delay: 0.08 + staggerDelay(screen, 0.5) })
  }
  return enter
}

// ── Gestures ────────────────────────────────────────────────────────────────────────────────

const LINE_HEIGHT = 16

/** Wheel delta in pixels (`deltaMode` 1 = lines, 2 = pages). */
export function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT
  if (deltaMode === 2) return delta * pageSize
  return delta
}

export interface ZoomAccumulatorOptions {
  /** Accumulated |delta| (px) that triggers one level step. */
  threshold?: number
  /** After a step, further deltas are ignored for this long (ms) — one level per gesture step. */
  cooldown?: number
  /** A pause longer than this (ms) starts a new gesture. */
  idleReset?: number
}

export interface ZoomAccumulator {
  /** Adds a (normalised) Ctrl/⌘ + wheel or trackpad-pinch delta; returns a step when the threshold is reached. */
  push: (delta: number, time: number) => ZoomDirection | null
  reset: () => void
}

/** Turns streams of zoom wheel deltas (negative = zoom in) into discrete level steps. */
export function createZoomAccumulator({ threshold = 50, cooldown = 420, idleReset = 260 }: ZoomAccumulatorOptions = {}): ZoomAccumulator {
  let total = 0
  let lastTime = -Infinity
  let blockedUntil = -Infinity
  return {
    push(delta, time) {
      if (time - lastTime > idleReset) total = 0
      lastTime = time
      if (time < blockedUntil || !Number.isFinite(delta)) return null
      total += delta
      if (Math.abs(total) < threshold) return null
      const direction: ZoomDirection = total < 0 ? 'in' : 'out'
      total = 0
      blockedUntil = time + cooldown
      return direction
    },
    reset() {
      total = 0
      lastTime = -Infinity
      blockedUntil = -Infinity
    },
  }
}

export interface PinchThresholds {
  /** Finger distance ratio that zooms in (spread). */
  zoomIn?: number
  /** Finger distance ratio that zooms out (pinch). */
  zoomOut?: number
}

/** Two-finger pinch: a step once the distance ratio crosses a threshold (then re-baseline). */
export function pinchStep(startDistance: number, distance: number, { zoomIn = 1.3, zoomOut = 0.77 }: PinchThresholds = {}): ZoomDirection | null {
  if (!(startDistance > 0) || !(distance > 0)) return null
  const ratio = distance / startDistance
  if (ratio >= zoomIn) return 'in'
  if (ratio <= zoomOut) return 'out'
  return null
}

/** `+` / `=` zoom in, `-` zooms out (no Ctrl/⌘/Alt: those belong to the browser). */
export function keyZoomDirection(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): ZoomDirection | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === '+' || event.key === '=' || event.key === 'Add') return 'in'
  if (event.key === '-' || event.key === '_' || event.key === 'Subtract') return 'out'
  return null
}
