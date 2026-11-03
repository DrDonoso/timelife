import { clampScroll, type TimelineLayout } from './layout'

/**
 * Opening sweep (once per browser session): a glowing front runs along the line from the oldest
 * milestone to the newest one, lighting each circle as it passes, while the view follows it and
 * comes to rest on the newest end. Pure planning: when the front reaches each node and where it
 * (and the scroll) are at any moment. Times are seconds from the start of the sweep.
 */

const STORAGE_KEY = 'timelife.intro'

/** Pause before the front starts moving (the page settles first). */
export const SWEEP_LEAD = 0.35
const SWEEP_BASE = 0.9
const SWEEP_PER_NODE = 0.06
const SWEEP_MIN = 1.4
const SWEEP_MAX = 4.2

/** True until the sweep has been shown in this browser session (tab). */
export function introPending(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) !== '1'
  } catch {
    // Storage blocked: never animate rather than replay on every visit.
    return false
  }
}

export function markIntroSeen(): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Storage unavailable: nothing to remember.
  }
}

/** Cubic ease-in-out (slow start and arrival, fast flight over the middle of long lines). */
export function easeInOut(progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2
}

/** Inverse of {@link easeInOut}: the progress at which the eased value reaches `value`. */
export function easeInOutInverse(value: number): number {
  const v = Math.min(1, Math.max(0, value))
  return v < 0.5 ? Math.cbrt(v / 4) : 1 - Math.cbrt(2 * (1 - v)) / 2
}

export interface SweepPlan {
  /** Seconds the front takes from the oldest to the newest node (after {@link SWEEP_LEAD}). */
  duration: number
  /** Front positions (logical `main`): the oldest node, then the newest one. */
  from: number
  to: number
  /** When the front reaches each node (seconds from the start, lead included). */
  times: ReadonlyMap<string, number>
}

/** Plan of the sweep over `layout` (`null` with fewer than two nodes: nothing to travel). */
export function planSweep(layout: TimelineLayout): SweepPlan | null {
  const { nodes } = layout
  const newest = nodes[0]
  const oldest = nodes.at(-1)
  if (!newest || !oldest || nodes.length < 2) return null
  const duration = Math.min(SWEEP_MAX, Math.max(SWEEP_MIN, SWEEP_BASE + SWEEP_PER_NODE * nodes.length))
  const distance = oldest.main - newest.main
  const times = new Map<string, number>()
  for (const node of nodes) {
    const travelled = distance > 0 ? (oldest.main - node.main) / distance : 1
    times.set(node.key, SWEEP_LEAD + duration * easeInOutInverse(travelled))
  }
  return { duration, from: oldest.main, to: newest.main, times }
}

/** Total length of the sweep in seconds. */
export function sweepLength(plan: SweepPlan): number {
  return SWEEP_LEAD + plan.duration
}

/** Logical position of the front `elapsed` seconds after the start. */
export function sweepFront(plan: SweepPlan, elapsed: number): number {
  const progress = easeInOut((elapsed - SWEEP_LEAD) / plan.duration)
  return plan.from + (plan.to - plan.from) * progress
}

/** Scroll that keeps the front in the middle of the viewport (clamped: the ends stay put). */
export function sweepScroll(layout: TimelineLayout, front: number): number {
  return clampScroll(layout, front - layout.viewport / 2)
}
