import { describe, expect, it } from 'vitest'
import type { TimelineEventOut } from '../api/schema.gen'
import { computeLayout, nodeByKey } from './layout'
import { buildTimelineModel } from './model'
import {
  anchoredScroll,
  createZoomAccumulator,
  keyZoomDirection,
  MAX_STAGGER,
  normalizeWheelDelta,
  pinchStep,
  planIntro,
  planZoom,
  PULSE_LEAD,
  staggerDelay,
  stepLevel,
  zoomDirection,
  zoomInLevel,
  zoomOutLevel,
} from './zoom'

function event(id: number, date: string): TimelineEventOut {
  return { id, title: `Hito ${id}`, date, day_order: 0, category_ids: [1], child_ids: [1], cover: null, image_count: 0, created_at: `${date}T10:00:00Z` }
}

// 3 years, several months each, a few events per month.
const EVENTS = [
  ...[1, 2, 3].map((day) => event(day, `2026-03-0${day}`)),
  ...[1, 2].map((day) => event(10 + day, `2026-01-1${day}`)),
  ...[1, 2, 3, 4].map((day) => event(20 + day, `2025-11-0${day}`)),
  ...[1, 2].map((day) => event(30 + day, `2025-06-0${day}`)),
  ...[1, 2, 3].map((day) => event(40 + day, `2024-09-0${day}`)),
]
const MODEL = buildTimelineModel(EVENTS)
const VIEWPORT = 1000
const layoutAt = (level: 'years' | 'months' | 'events', viewport = VIEWPORT) =>
  computeLayout(MODEL, level, { orientation: 'horizontal', viewport })

describe('levels', () => {
  it('steps between years, months and events', () => {
    expect(zoomInLevel('years')).toBe('months')
    expect(zoomInLevel('months')).toBe('events')
    expect(zoomInLevel('events')).toBeNull()
    expect(zoomOutLevel('events')).toBe('months')
    expect(zoomOutLevel('years')).toBeNull()
    expect(stepLevel('months', 'out')).toBe('years')
    expect(zoomDirection('years', 'events')).toBe('in')
    expect(zoomDirection('events', 'months')).toBe('out')
    expect(zoomDirection('months', 'months')).toBeNull()
  })
})

describe('anchoring', () => {
  it('zooming out keeps the anchor’s ancestor where the anchor was on screen', () => {
    const from = layoutAt('events')
    const to = layoutAt('months')
    const anchor = nodeByKey(from, 'e22')
    const scroll = (anchor?.main ?? 0) - 400
    const { scroll: next, focusKey } = anchoredScroll({ model: MODEL, from, to, anchorKey: 'e22', scroll })
    const parent = nodeByKey(to, 'm2025-11')
    expect(focusKey).toBe('m2025-11')
    expect((parent?.main ?? 0) - next).toBeCloseTo(400)
  })

  it('zooming in centres the children on the anchor when they fit', () => {
    const from = layoutAt('years', 3000)
    const to = layoutAt('months', 3000)
    const anchorScreen = nodeByKey(from, 'y2025')?.main ?? 0
    const { scroll, focusKey } = anchoredScroll({ model: MODEL, from, to, anchorKey: 'y2025', scroll: 0 })
    const first = nodeByKey(to, 'm2025-11')
    const last = nodeByKey(to, 'm2025-06')
    expect(focusKey).toBe('m2025-11')
    const centre = ((first?.main ?? 0) + (last?.main ?? 0)) / 2 - scroll
    // The track may be too short to scroll exactly there; otherwise the group is centred on the anchor.
    expect(Math.abs(centre - anchorScreen)).toBeLessThan(400)
  })

  it('zooming in keeps the newest child and its chips on screen when the group is wide', () => {
    const narrow = 500
    const from = layoutAt('months', narrow)
    const to = layoutAt('events', narrow)
    const { scroll, focusKey } = anchoredScroll({ model: MODEL, from, to, anchorKey: 'm2025-11', scroll: 400 })
    const first = nodeByKey(to, 'e24')
    expect(focusKey).toBe('e24')
    expect((first?.main ?? 0) - scroll - (first?.lead ?? 0)).toBeGreaterThanOrEqual(0)
    expect((first?.main ?? 0) - scroll).toBeLessThan(narrow)
  })
})

describe('planZoom', () => {
  it('bursts children out of their parents and staggers them by distance', () => {
    const from = layoutAt('years', 1400)
    const to = layoutAt('months', 1400)
    const plan = planZoom({ model: MODEL, from, to, anchorKey: 'y2025', scroll: 0 })
    expect(plan.direction).toBe('in')
    expect(plan.focusKey).toBe('m2025-11')
    const spec = plan.enter.get('m2025-11')
    expect(spec?.kind).toBe('burst')
    const parent = nodeByKey(from, 'y2025')
    const child = nodeByKey(to, 'm2025-11')
    // Starts at the parent's centre (old screen position mapped into the new track).
    expect((child?.main ?? 0) + (spec?.offset ?? 0)).toBeCloseTo((parent?.main ?? 0) - 0 + plan.scroll)
    const delays = [...plan.enter.values()].map((item) => item.delay)
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(PULSE_LEAD)
    expect(Math.max(...delays)).toBeLessThanOrEqual(PULSE_LEAD + MAX_STAGGER)
    expect(plan.ghosts.find((ghost) => ghost.key === 'y2025')).toMatchObject({ mode: 'source', isAnchor: true })
    expect(plan.ghosts.find((ghost) => ghost.key === 'y2026')).toMatchObject({ mode: 'source', isAnchor: false })
    expect(plan.duration).toBeGreaterThan(600)
  })

  it('merges children into their parent’s new position when zooming out', () => {
    const from = layoutAt('events', 1400)
    const to = layoutAt('months', 1400)
    const scroll = 900
    const plan = planZoom({ model: MODEL, from, to, anchorKey: 'e22', scroll })
    expect(plan.direction).toBe('out')
    const ghost = plan.ghosts.find((item) => item.key === 'e22')
    const parent = nodeByKey(to, 'm2025-11')
    expect(ghost?.mode).toBe('merge')
    expect(ghost?.to).toBeCloseTo((parent?.main ?? 0) - plan.scroll)
    expect(ghost?.from).toBeCloseTo((nodeByKey(from, 'e22')?.main ?? 0) - scroll)
    expect(plan.enter.get('m2025-11')?.kind).toBe('pop')
  })

  it('only animates nodes near the viewport', () => {
    const from = layoutAt('events', 400)
    const to = layoutAt('months', 400)
    const plan = planZoom({ model: MODEL, from, to, anchorKey: 'e1', scroll: 0 })
    expect(plan.ghosts.length).toBeLessThan(from.nodes.length)
    expect(plan.ghosts.every((ghost) => ghost.from > -400 && ghost.from < 800)).toBe(true)
  })

  it('cross-fades in place for reduced motion', () => {
    const from = layoutAt('years', 1400)
    const to = layoutAt('months', 1400)
    const plan = planZoom({ model: MODEL, from, to, anchorKey: 'y2026', scroll: 0, reducedMotion: true })
    expect([...plan.enter.values()].every((spec) => spec.kind === 'fade' && spec.offset === 0 && spec.delay === 0)).toBe(true)
    expect(plan.ghosts.every((ghost) => ghost.mode === 'fade' && ghost.to === ghost.from)).toBe(true)
    expect(plan.duration).toBeLessThanOrEqual(200)
  })

  it('accepts an explicit target scroll (search jumps)', () => {
    const from = layoutAt('years', 600)
    const to = layoutAt('events', 600)
    const plan = planZoom({ model: MODEL, from, to, anchorKey: 'y2024', scroll: 0, targetScroll: 123 })
    expect(plan.scroll).toBe(123)
  })

  it('reveals the first view in a wave from the start', () => {
    const layout = layoutAt('events', 900)
    const intro = planIntro(layout, 0)
    const delays = layout.nodes.filter((node) => intro.has(node.key)).map((node) => intro.get(node.key)?.delay ?? 0)
    expect(delays.length).toBeGreaterThan(2)
    expect(delays).toEqual(delays.toSorted((a, b) => a - b))
    expect(planIntro(layout, 0, true).get(layout.nodes[0].key)?.kind).toBe('fade')
  })

  it('caps the stagger', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(-200)).toBeCloseTo(staggerDelay(200))
    expect(staggerDelay(1e6)).toBe(MAX_STAGGER)
  })
})

describe('gestures', () => {
  it('normalises wheel deltas', () => {
    expect(normalizeWheelDelta(3, 0, 800)).toBe(3)
    expect(normalizeWheelDelta(3, 1, 800)).toBe(48)
    expect(normalizeWheelDelta(1, 2, 800)).toBe(800)
  })

  it('accumulates zoom deltas into one step per gesture step', () => {
    const accumulator = createZoomAccumulator({ threshold: 50, cooldown: 400, idleReset: 250 })
    expect(accumulator.push(-20, 0)).toBeNull()
    expect(accumulator.push(-20, 16)).toBeNull()
    expect(accumulator.push(-20, 32)).toBe('in')
    // Same gesture: ignored during the cooldown…
    expect(accumulator.push(-80, 48)).toBeNull()
    expect(accumulator.push(-80, 300)).toBeNull()
    // …then it can step again.
    expect(accumulator.push(-60, 500)).toBe('in')
    expect(accumulator.push(120, 1000)).toBe('out')
  })

  it('forgets partial gestures after a pause', () => {
    const accumulator = createZoomAccumulator({ threshold: 50, cooldown: 400, idleReset: 250 })
    expect(accumulator.push(-40, 0)).toBeNull()
    expect(accumulator.push(-40, 600)).toBeNull()
    expect(accumulator.push(-20, 620)).toBe('in')
    accumulator.reset()
    expect(accumulator.push(-49, 700)).toBeNull()
  })

  it('detects two-finger pinch steps', () => {
    expect(pinchStep(100, 140)).toBe('in')
    expect(pinchStep(100, 70)).toBe('out')
    expect(pinchStep(100, 110)).toBeNull()
    expect(pinchStep(0, 110)).toBeNull()
  })

  it('maps + / = / - keys (not browser zoom shortcuts)', () => {
    expect(keyZoomDirection({ key: '+' })).toBe('in')
    expect(keyZoomDirection({ key: '=' })).toBe('in')
    expect(keyZoomDirection({ key: '-' })).toBe('out')
    expect(keyZoomDirection({ key: '+', ctrlKey: true })).toBeNull()
    expect(keyZoomDirection({ key: '-', metaKey: true })).toBeNull()
    expect(keyZoomDirection({ key: 'a' })).toBeNull()
  })
})
