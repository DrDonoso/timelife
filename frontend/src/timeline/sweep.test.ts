import { afterEach, describe, expect, it } from 'vitest'
import type { TimelineEventOut } from '../api/schema.gen'
import { computeLayout } from './layout'
import { buildTimelineModel } from './model'
import {
  SWEEP_LEAD,
  easeInOut,
  easeInOutInverse,
  introPending,
  markIntroSeen,
  planSweep,
  sweepFront,
  sweepLength,
  sweepScroll,
} from './sweep'

function event(id: number, date: string): TimelineEventOut {
  return { id, title: `Hito ${id}`, date, day_order: 0, category_ids: [1], child_ids: [1], cover: null, image_count: 0, created_at: `${date}T10:00:00Z` }
}

const DATES = ['2026-03-12', '2026-03-02', '2026-01-20', '2025-12-24', '2025-06-10', '2025-02-01', '2024-11-11', '2024-05-05']
const LAYOUT = computeLayout(buildTimelineModel(DATES.map((date, index) => event(index + 1, date))), 'events', {
  orientation: 'horizontal',
  viewport: 600,
})

afterEach(() => sessionStorage.clear())

describe('opening sweep', () => {
  it('is pending once per session', () => {
    sessionStorage.clear()
    expect(introPending()).toBe(true)
    markIntroSeen()
    expect(introPending()).toBe(false)
  })

  it('eases in and out, with an exact inverse', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBeCloseTo(0.5)
    expect(easeInOut(1)).toBe(1)
    for (const progress of [0, 0.1, 0.3, 0.5, 0.62, 0.9, 1]) expect(easeInOutInverse(easeInOut(progress))).toBeCloseTo(progress, 6)
  })

  it('reaches the oldest milestone first and the newest one last, in order', () => {
    const plan = planSweep(LAYOUT)
    expect(plan).not.toBeNull()
    if (!plan) return
    const times = LAYOUT.nodes.map((node) => plan.times.get(node.key) ?? Number.NaN)
    // Nodes are newest first: their times decrease along the list.
    expect(times.every((time, index) => index === 0 || time < times[index - 1])).toBe(true)
    expect(times.at(-1)).toBeCloseTo(SWEEP_LEAD)
    expect(times[0]).toBeCloseTo(sweepLength(plan))
    expect(plan.duration).toBeGreaterThanOrEqual(1.4)
    expect(plan.duration).toBeLessThanOrEqual(4.2)
  })

  it('moves the front from the oldest to the newest node and the scroll to the newest end', () => {
    const plan = planSweep(LAYOUT)
    if (!plan) throw new Error('no plan')
    const oldest = LAYOUT.nodes.at(-1)?.main ?? 0
    const newest = LAYOUT.nodes[0].main
    expect(sweepFront(plan, 0)).toBe(oldest)
    expect(sweepFront(plan, SWEEP_LEAD)).toBe(oldest)
    expect(sweepFront(plan, sweepLength(plan))).toBe(newest)
    expect(sweepFront(plan, sweepLength(plan) + 5)).toBe(newest)
    // Each node is reached exactly at its time.
    for (const node of LAYOUT.nodes) expect(sweepFront(plan, plan.times.get(node.key) ?? 0)).toBeCloseTo(node.main, 3)
    // The view starts at the oldest end and ends centred on the newest milestone (the timeline
    // then glides to its usual resting place, the newest end).
    expect(sweepScroll(LAYOUT, oldest)).toBe(LAYOUT.length - LAYOUT.viewport)
    expect(sweepScroll(LAYOUT, newest)).toBe(Math.max(0, newest - LAYOUT.viewport / 2))
  })

  it('has nothing to travel with fewer than two milestones', () => {
    const single = computeLayout(buildTimelineModel([event(1, '2026-03-12')]), 'events', { orientation: 'horizontal', viewport: 600 })
    expect(planSweep(single)).toBeNull()
  })
})
