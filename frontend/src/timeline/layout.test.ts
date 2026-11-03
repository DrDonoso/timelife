import { describe, expect, it } from 'vitest'
import type { TimelineEventOut } from '../api/schema.gen'
import {
  cachedLayout,
  clampScroll,
  COMPACT_HORIZONTAL_METRICS,
  computeLayout,
  hubSize,
  laneCrossAt,
  maxScroll,
  metricsFor,
  nearestNodeIndex,
  nodeByKey,
  rangeIndices,
  scrollToCenter,
  TIMELINE_METRICS,
} from './layout'
import { buildTimelineModel } from './model'
import { demoEvents } from './testing/demoData'

function event(id: number, date: string): TimelineEventOut {
  return { id, title: `Hito ${id}`, date, day_order: 0, category_ids: [1], child_ids: [1], cover: null, image_count: 0, created_at: `${date}T10:00:00Z` }
}

// 2026: March ×2, January ×1 · 2025: December ×1
const MODEL = buildTimelineModel([event(1, '2026-03-12'), event(2, '2026-03-02'), event(3, '2026-01-20'), event(4, '2025-12-24')])
const H = TIMELINE_METRICS.horizontal
const V = TIMELINE_METRICS.vertical

describe('computeLayout', () => {
  it('places events newest first with even slots, month gaps and bigger year gaps', () => {
    const layout = computeLayout(MODEL, 'events', { orientation: 'horizontal', viewport: 400 })
    const { slot, yearGap, monthGap } = H.levels.events
    const mains = layout.nodes.map((node) => node.main)
    expect(layout.nodes.map((node) => node.key)).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(mains[0]).toBe(H.paddingStart + yearGap + monthGap + slot / 2)
    expect(mains[1] - mains[0]).toBe(slot)
    expect(mains[2] - mains[1]).toBe(slot + monthGap)
    expect(mains[3] - mains[2]).toBe(slot + yearGap + monthGap)
    expect(layout.nodes.every((node) => node.size === H.levels.events.node)).toBe(true)
  })

  it('emits a year chip and a month chip before every group, in order', () => {
    const layout = computeLayout(MODEL, 'events', { orientation: 'horizontal', viewport: 400 })
    expect(layout.markers.map((marker) => marker.key)).toEqual(['by2026', 'bm2026-03', 'bm2026-01', 'by2025', 'bm2025-12'])
    const [e1, , e3, e4] = layout.nodes
    const markerMain = (key: string) => layout.markers.find((marker) => marker.key === key)?.main ?? NaN
    expect(markerMain('by2026')).toBeLessThan(markerMain('bm2026-03'))
    expect(markerMain('bm2026-03')).toBeLessThan(e1.main)
    expect(markerMain('bm2026-01')).toBeGreaterThan(layout.nodes[1].main)
    expect(markerMain('bm2026-01')).toBeLessThan(e3.main)
    expect(markerMain('by2025')).toBeLessThan(e4.main)
    // Every node knows how far its leading chips reach (used to keep them on screen).
    expect(e1.lead).toBe(H.levels.events.yearGap + H.levels.events.monthGap + H.levels.events.slot / 2)
    expect(layout.nodes[1].lead).toBe(H.levels.events.slot / 2)
  })

  it('shows only year chips at the months level and none at the years level', () => {
    const months = computeLayout(MODEL, 'months', { orientation: 'horizontal', viewport: 400 })
    expect(months.nodes.map((node) => node.key)).toEqual(['m2026-03', 'm2026-01', 'm2025-12'])
    expect(months.markers.map((marker) => marker.kind)).toEqual(['year', 'year'])
    const years = computeLayout(MODEL, 'years', { orientation: 'horizontal', viewport: 400 })
    expect(years.nodes.map((node) => node.key)).toEqual(['y2026', 'y2025'])
    expect(years.markers).toEqual([])
    const spacing = H.levels.years.slot - H.levels.years.node
    expect(years.nodes[1].main - years.nodes[0].main).toBe((years.nodes[0].size + years.nodes[1].size) / 2 + spacing)
  })

  it('sizes year and month hubs by their number of milestones', () => {
    const [min, max] = H.levels.months.hubSize ?? [0, 0]
    const months = computeLayout(MODEL, 'months', { orientation: 'horizontal', viewport: 400 })
    // March holds 2 milestones (the most), January and December 1 each.
    expect(months.nodes.map((node) => node.size)).toEqual([max, hubSize(1, 2, [min, max]), hubSize(1, 2, [min, max])])
    expect(months.nodes[0].size).toBeGreaterThan(months.nodes[1].size)
    // The gap between neighbouring circles stays the same whatever their size.
    const spacing = H.levels.months.slot - H.levels.months.node
    const [march, january] = months.nodes
    expect(january.main - january.size / 2 - (march.main + march.size / 2)).toBe(spacing)

    const years = computeLayout(MODEL, 'years', { orientation: 'vertical', viewport: 400 })
    const yearRange = V.levels.years.hubSize ?? [0, 0]
    expect(years.nodes.map((node) => node.size)).toEqual([yearRange[1], hubSize(1, 3, yearRange)])
  })

  it('gives every hub the same size when they hold as many milestones', () => {
    const model = buildTimelineModel([event(1, '2026-03-12'), event(2, '2026-02-02'), event(3, '2025-01-20')])
    const months = computeLayout(model, 'months', { orientation: 'horizontal', viewport: 400 })
    expect(new Set(months.nodes.map((node) => node.size))).toEqual(new Set([H.levels.months.hubSize?.[1]]))
  })

  it('uses the vertical metrics on mobile', () => {
    const layout = computeLayout(MODEL, 'events', { orientation: 'vertical', viewport: 300 })
    const { slot, node, markerShift, yearGap } = V.levels.events
    expect(layout.orientation).toBe('vertical')
    expect(layout.nodes[1].main - layout.nodes[0].main).toBe(slot)
    expect(layout.nodes[0].size).toBe(node)
    expect(layout.markers[0].main).toBe(V.paddingStart + yearGap / 2 + markerShift)
  })

  it('keeps paddings and marker shifts in place on screen when the frame is mirrored', () => {
    const normal = computeLayout(MODEL, 'events', { orientation: 'vertical', viewport: 300 })
    const mirrored = computeLayout(MODEL, 'events', { orientation: 'vertical', viewport: 300, reversed: true })
    const { yearGap, markerShift } = V.levels.events
    expect(normal.reversed).toBe(false)
    expect(mirrored.reversed).toBe(true)
    // Logical positions start after the padding of the newest end, which is the bottom one here…
    expect(mirrored.nodes[0].main - normal.nodes[0].main).toBe(V.paddingEnd - V.paddingStart)
    expect(mirrored.length).toBe(normal.length)
    // …and the chips still move up on screen (towards larger logical positions).
    expect(mirrored.markers[0].main).toBe(V.paddingEnd + yearGap / 2 - markerShift)
    expect(mirrored.nodes.map((item) => item.key)).toEqual(normal.nodes.map((item) => item.key))
  })

  it('uses smaller circles for a horizontal line on a phone', () => {
    const layout = computeLayout(MODEL, 'events', { orientation: 'horizontal', viewport: 390, compact: true })
    const { slot, node } = COMPACT_HORIZONTAL_METRICS.levels.events
    expect(layout.nodes[0].size).toBe(node)
    expect(layout.nodes[1].main - layout.nodes[0].main).toBe(slot)
    expect(metricsFor('horizontal', true)).toBe(COMPACT_HORIZONTAL_METRICS)
    expect(metricsFor('vertical', true)).toBe(V)
    expect(metricsFor('horizontal')).toBe(H)
    expect(cachedLayout(MODEL, 'events', { orientation: 'horizontal', viewport: 390, compact: true })).not.toBe(
      cachedLayout(MODEL, 'events', { orientation: 'horizontal', viewport: 390 }),
    )
  })

  it('centres short timelines in the viewport', () => {
    const viewport = 2000
    const layout = computeLayout(MODEL, 'years', { orientation: 'horizontal', viewport })
    const [first, last] = [layout.nodes[0], layout.nodes[1]]
    const spacing = H.levels.years.slot - H.levels.years.node
    expect(first.main - (first.size + spacing) / 2 + (last.main + (last.size + spacing) / 2)).toBeCloseTo(viewport)
    expect(layout.length).toBe(viewport)
    expect(maxScroll(layout)).toBe(0)
  })

  it('computes the track length, axis extent and year spans of long timelines', () => {
    const layout = computeLayout(MODEL, 'events', { orientation: 'horizontal', viewport: 400 })
    const last = layout.nodes.at(-1)
    expect(layout.length).toBe((last?.main ?? 0) + H.levels.events.slot / 2 + H.paddingEnd)
    expect(layout.axisStart).toBeLessThan(layout.nodes[0].main)
    expect(layout.axisEnd).toBeGreaterThan(last?.main ?? 0)
    expect(layout.years.map((span) => span.year)).toEqual([2026, 2025])
    expect(layout.years[0].end).toBeLessThanOrEqual(layout.years[1].start)
    expect(maxScroll(layout)).toBe(layout.length - 400)
  })

  it('lays out 2000 events quickly', () => {
    const events = Array.from({ length: 2000 }, (_, index) => {
      const day = new Date(2026, 0, 1 - Math.floor(index / 3))
      const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
      return event(index + 1, date)
    })
    const started = performance.now()
    const model = buildTimelineModel(events)
    const layouts = (['events', 'months', 'years'] as const).map((level) =>
      computeLayout(model, level, { orientation: 'horizontal', viewport: 1440 }),
    )
    const elapsed = performance.now() - started
    expect(layouts[0].nodes).toHaveLength(2000)
    expect(layouts[0].nodes.every((node, index) => index === 0 || node.main > layouts[0].nodes[index - 1].main)).toBe(true)
    expect(elapsed).toBeLessThan(250)
  })

  it('handles an empty model', () => {
    const layout = computeLayout(buildTimelineModel([]), 'events', { orientation: 'horizontal', viewport: 800 })
    expect(layout.nodes).toEqual([])
    expect(layout.length).toBe(800)
    expect(nearestNodeIndex(layout, 100)).toBe(-1)
  })
})

describe('hubSize', () => {
  it('grows with the square root of the share of the busiest hub', () => {
    expect(hubSize(16, 16, [80, 120])).toBe(120)
    expect(hubSize(4, 16, [80, 120])).toBe(100)
    expect(hubSize(1, 16, [80, 120])).toBe(90)
    expect(hubSize(0, 16, [80, 120])).toBe(80)
  })

  it('stays within its range for odd input', () => {
    expect(hubSize(30, 16, [80, 120])).toBe(120)
    expect(hubSize(-1, 16, [80, 120])).toBe(80)
    expect(hubSize(3, 0, [80, 120])).toBe(120)
  })
})

describe('layout queries', () => {
  const layout = computeLayout(buildTimelineModel(demoEvents()), 'events', { orientation: 'horizontal', viewport: 1000 })

  it('finds nodes by key, nearest to a position and within a range', () => {
    const node = layout.nodes[10]
    expect(nodeByKey(layout, node.key)).toBe(node)
    expect(nodeByKey(layout, 'e999999')).toBeUndefined()
    expect(nearestNodeIndex(layout, node.main + 10)).toBe(10)
    expect(nearestNodeIndex(layout, -500)).toBe(0)
    expect(nearestNodeIndex(layout, 1e9)).toBe(layout.nodes.length - 1)
    const [start, end] = rangeIndices(layout.nodes, layout.nodes[3].main, layout.nodes[7].main)
    expect([start, end]).toEqual([3, 8])
  })

  it('centres and clamps scroll offsets', () => {
    const node = layout.nodes[20]
    expect(scrollToCenter(layout, node.key)).toBe(node.main - 500)
    expect(scrollToCenter(layout, layout.nodes[0].key)).toBe(0)
    expect(scrollToCenter(layout, 'nope')).toBeNull()
    expect(clampScroll(layout, -40)).toBe(0)
    expect(clampScroll(layout, 1e9)).toBe(maxScroll(layout))
  })

  it('memoises layouts per model, level, orientation and viewport', () => {
    const model = buildTimelineModel(demoEvents())
    const a = cachedLayout(model, 'months', { orientation: 'horizontal', viewport: 1200 })
    expect(cachedLayout(model, 'months', { orientation: 'horizontal', viewport: 1200.2 })).toBe(a)
    expect(cachedLayout(model, 'months', { orientation: 'vertical', viewport: 1200 })).not.toBe(a)
  })
})

describe('family lanes', () => {
  const LANES = [
    { id: 1, name: 'Emma', avatar: null },
    { id: 2, name: 'Leo', avatar: null },
  ]

  function of(id: number, date: string, childIds: number[]): TimelineEventOut {
    return { ...event(id, date), child_ids: childIds }
  }

  // Newest first: Leo's, both children's, Emma's, Emma's (2025).
  const FAMILY = buildTimelineModel(
    [of(1, '2026-03-12', [2]), of(2, '2026-03-02', [1, 2]), of(3, '2026-01-20', [1]), of(4, '2025-12-24', [1])],
    LANES,
  )
  const options = { orientation: 'horizontal', viewport: 400 } as const

  it('puts each child on their own lane across the axis and shared milestones between the lanes', () => {
    const layout = computeLayout(FAMILY, 'events', options)
    const [leo, both, emma, emmaOld] = layout.nodes
    const [emmaLane, leoLane] = layout.lanes
    expect(layout.lanes.map((lane) => [lane.id, lane.index])).toEqual([[1, 0], [2, 1]])
    // Children in their order, centred on the axis, far enough apart for their circles.
    expect(emmaLane.offset).toBe(-leoLane.offset)
    expect(leoLane.offset).toBeGreaterThan(H.levels.events.node / 2)
    expect(leo.cross).toBe(leoLane.offset)
    expect([emma.cross, emmaOld.cross]).toEqual([emmaLane.offset, emmaLane.offset])
    expect(both.cross).toBe(0)
    // Lines start beside the newest year chip and end at the child's oldest milestone.
    expect([emmaLane.head, leoLane.head]).toEqual([layout.markers[0].main, layout.markers[0].main])
    expect(emmaLane.tail).toBe(emmaOld.main)
    expect(leoLane.tail).toBe(both.main)
  })

  it('draws contiguous lines along each lane that curve into the shared milestones', () => {
    const layout = computeLayout(FAMILY, 'events', options)
    for (const lane of layout.lanes) {
      expect(lane.segments[0].from).toBe(lane.head)
      expect(lane.segments.at(-1)?.to).toBe(lane.tail)
      expect(lane.segments.every((segment) => segment.to > segment.from)).toBe(true)
      expect(lane.segments.slice(1).map((segment) => segment.from)).toEqual(lane.segments.slice(0, -1).map((segment) => segment.to))
    }
    const [emmaLane, leoLane] = layout.lanes
    const [leo, both, emma] = layout.nodes
    expect(laneCrossAt(emmaLane, emmaLane.head)).toBe(emmaLane.offset)
    expect(laneCrossAt(leoLane, leo.main)).toBe(leoLane.offset)
    expect(laneCrossAt(emmaLane, emma.main)).toBe(emmaLane.offset)
    // Merged, the two lines run side by side into the shared milestone.
    const [emmaAtBoth, leoAtBoth] = [laneCrossAt(emmaLane, both.main), laneCrossAt(leoLane, both.main)]
    expect(emmaAtBoth).toBeLessThan(leoAtBoth)
    expect(Math.abs(emmaAtBoth - both.cross)).toBeLessThan(5)
    expect(Math.abs(leoAtBoth - both.cross)).toBeLessThan(5)
    // An S-curve: halfway through, halfway across; the line stays put before it starts.
    const curve = emmaLane.segments.find((segment) => segment.c0 !== segment.c1) ?? emmaLane.segments[0]
    expect(curve.c0).not.toBe(curve.c1)
    expect(laneCrossAt(emmaLane, (curve.from + curve.to) / 2)).toBeCloseTo((curve.c0 + curve.c1) / 2)
    expect(curve.to - curve.from).toBeLessThan(both.main - emmaLane.head)
    expect(laneCrossAt(emmaLane, curve.from - 1)).toBe(emmaLane.offset)
  })

  it('keeps a single line at the hub levels and when only one child has milestones', () => {
    for (const level of ['months', 'years'] as const) {
      const layout = computeLayout(FAMILY, level, options)
      expect(layout.lanes).toEqual([])
      expect(layout.nodes.every((node) => node.cross === 0)).toBe(true)
    }
    // E.g. filters leaving Emma's milestones only, or a child's own timeline.
    const onlyEmma = computeLayout(buildTimelineModel([of(1, '2026-03-12', [1]), of(2, '2026-03-02', [1])], LANES), 'events', options)
    expect(onlyEmma.lanes).toEqual([])
    expect(onlyEmma.nodes.every((node) => node.cross === 0)).toBe(true)
    expect(computeLayout(MODEL, 'events', options).lanes).toEqual([])
  })

  it('keeps each child’s colour and fits many lanes in a narrower spread', () => {
    const lanes = [...LANES, { id: 3, name: 'Ona', avatar: null }, { id: 4, name: 'Pau', avatar: null }, { id: 5, name: 'Bru', avatar: null }]
    const events = [of(1, '2026-03-12', [3]), of(2, '2026-03-02', [4]), of(3, '2026-02-02', [5]), of(4, '2026-01-01', [2])]
    const layout = computeLayout(buildTimelineModel(events, lanes), 'events', { orientation: 'vertical', viewport: 800 })
    // Emma has no milestones here: no line, the others keep their place in the children's order.
    expect(layout.lanes.map((lane) => [lane.id, lane.index])).toEqual([[2, 1], [3, 2], [4, 3], [5, 4]])
    const offsets = layout.lanes.map((lane) => lane.offset)
    expect(offsets[0]).toBe(-offsets[3])
    const two = computeLayout(FAMILY, 'events', { orientation: 'vertical', viewport: 800 }).lanes
    const pair = two[1].offset - two[0].offset
    expect(offsets[3] - offsets[0]).toBeLessThanOrEqual(1.5 * pair)
    expect(offsets[1] - offsets[0]).toBeLessThan(pair)
  })
})
