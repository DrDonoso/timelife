import { describe, expect, it } from 'vitest'
import type { TimelineEventOut } from '../api/schema.gen'
import {
  ancestorKey,
  buildTimelineModel,
  compareEvents,
  descendantKeys,
  entriesAt,
  levelOfKey,
  parseNodeKey,
  representativeKey,
  resolveFocusKey,
} from './model'
import { demoEvents } from './testing/demoData'

function event(id: number, date: string, created = `${date}T10:00:00Z`, dayOrder = 0): TimelineEventOut {
  return { id, title: `Hito ${id}`, date, day_order: dayOrder, category_ids: [1], child_ids: [1], cover: null, image_count: 0, created_at: created }
}

const EVENTS = [
  event(1, '2024-05-02'),
  event(2, '2026-03-12'),
  event(3, '2026-03-12', '2026-03-12T18:00:00Z'),
  event(4, '2025-12-31'),
  event(5, '2026-01-05'),
  event(6, '2026-03-01'),
]

describe('buildTimelineModel', () => {
  it('groups years → months → events, newest first, with counts', () => {
    const model = buildTimelineModel(EVENTS)
    expect(model.years.map((year) => [year.key, year.count])).toEqual([
      ['y2026', 4],
      ['y2025', 1],
      ['y2024', 1],
    ])
    expect(model.months.map((month) => [month.key, month.count])).toEqual([
      ['m2026-03', 3],
      ['m2026-01', 1],
      ['m2025-12', 1],
      ['m2024-05', 1],
    ])
    // Same day: the most recently created first; then the earlier day of the month.
    expect(model.events.map((entry) => entry.key)).toEqual(['e3', 'e2', 'e6', 'e5', 'e4', 'e1'])
    expect(model.years[0].months[0].events.map((entry) => entry.event.id)).toEqual([3, 2, 6])
  })

  it('links every node to its parents and indexes keys', () => {
    const model = buildTimelineModel(EVENTS)
    const entry = model.byKey.get('e6')
    expect(entry).toMatchObject({ kind: 'event', year: 2026, month: 3, yearKey: 'y2026', monthKey: 'm2026-03' })
    expect(model.byKey.get('m2025-12')).toMatchObject({ kind: 'month', yearKey: 'y2025', count: 1 })
    expect(model.byKey.size).toBe(3 + 4 + 6)
  })

  it('does not depend on the input order and skips malformed or duplicated events', () => {
    const shuffled = [EVENTS[3], EVENTS[0], EVENTS[5], EVENTS[1], EVENTS[4], EVENTS[2]]
    const model = buildTimelineModel([...shuffled, event(9, 'not-a-date'), event(10, '2026-13-01'), EVENTS[2]])
    expect(model.events.map((entry) => entry.key)).toEqual(['e3', 'e2', 'e6', 'e5', 'e4', 'e1'])
  })

  it('handles an empty timeline', () => {
    const model = buildTimelineModel([])
    expect(model.years).toEqual([])
    expect(entriesAt(model, 'events')).toEqual([])
    expect(model.lanes).toEqual([])
  })

  it('keeps the children of the family timeline, in their order, as its lanes', () => {
    const lanes = [
      { id: 2, name: 'Leo', avatar: null },
      { id: 1, name: 'Emma', avatar: null },
    ]
    expect(buildTimelineModel(EVENTS, lanes).lanes).toBe(lanes)
  })

  it('orders like the API: date (descending), day order, then created_at and id (descending)', () => {
    const a = event(1, '2026-01-01', '2026-01-01T10:00:00Z')
    const b = event(2, '2026-01-01', '2026-01-01T10:00:00Z')
    expect([a, b].toSorted(compareEvents).map((item) => item.id)).toEqual([2, 1])
    // The administrators' order of the day wins over creation times.
    const first = event(3, '2026-01-01', '2026-01-01T08:00:00Z', -1)
    const last = event(4, '2026-01-01', '2026-01-01T23:00:00Z', 5)
    expect([a, last, b, first].toSorted(compareEvents).map((item) => item.id)).toEqual([3, 2, 1, 4])
    expect(buildTimelineModel([last, a, first]).events.map((entry) => entry.key)).toEqual(['e3', 'e1', 'e4'])
  })

  it('builds the demo dataset (≥ 80 uneven events across 2024–2026)', () => {
    const model = buildTimelineModel(demoEvents())
    expect(model.events.length).toBeGreaterThanOrEqual(80)
    expect(model.years.map((year) => year.year)).toEqual([2026, 2025, 2024])
    const counts = model.months.map((month) => month.count)
    expect(Math.max(...counts)).toBeGreaterThan(Math.min(...counts))
    expect(model.events.some((entry, index) => entry.event.date === model.events[index + 1]?.event.date)).toBe(true)
  })
})

describe('node keys', () => {
  it('parses focus values', () => {
    expect(parseNodeKey('y2026')).toEqual({ kind: 'year', year: 2026 })
    expect(parseNodeKey('m2026-03')).toEqual({ kind: 'month', year: 2026, month: 3 })
    expect(parseNodeKey('e123')).toEqual({ kind: 'event', id: 123 })
    for (const invalid of ['', 'y26', 'm2026-13', 'm2026-00', 'e0', 'e-1', 'e99999999999', 'x1', null, undefined]) {
      expect(parseNodeKey(invalid)).toBeNull()
    }
    expect(levelOfKey('m2026-03')).toBe('months')
    expect(levelOfKey('e5')).toBe('events')
    expect(levelOfKey('nope')).toBeNull()
  })

  it('maps keys across levels', () => {
    const model = buildTimelineModel(EVENTS)
    expect(ancestorKey(model, 'e6', 'months')).toBe('m2026-03')
    expect(ancestorKey(model, 'e6', 'years')).toBe('y2026')
    expect(ancestorKey(model, 'm2026-01', 'years')).toBe('y2026')
    expect(ancestorKey(model, 'y2026', 'months')).toBeNull()
    expect(descendantKeys(model, 'y2026', 'months')).toEqual(['m2026-03', 'm2026-01'])
    expect(descendantKeys(model, 'y2026', 'events')).toEqual(['e3', 'e2', 'e6', 'e5'])
    expect(descendantKeys(model, 'm2026-03', 'events')).toEqual(['e3', 'e2', 'e6'])
    expect(descendantKeys(model, 'e3', 'months')).toEqual([])
    expect(representativeKey(model, 'y2025', 'events')).toBe('e4')
    expect(representativeKey(model, 'e1', 'years')).toBe('y2024')
    expect(representativeKey(model, 'y1999', 'years')).toBeNull()
  })

  it('resolves focus values, falling back to the closest period in time', () => {
    const model = buildTimelineModel(EVENTS)
    expect(resolveFocusKey(model, 'e6', 'events')).toBe('e6')
    expect(resolveFocusKey(model, 'e6', 'years')).toBe('y2026')
    expect(resolveFocusKey(model, 'm2026-02', 'months')).toBe('m2026-03')
    expect(resolveFocusKey(model, 'm2025-02', 'months')).toBe('m2024-05')
    expect(resolveFocusKey(model, 'y2023', 'years')).toBe('y2024')
    expect(resolveFocusKey(model, 'e999', 'events')).toBeNull()
    expect(resolveFocusKey(model, 'garbage', 'events')).toBeNull()
    expect(resolveFocusKey(model, null, 'events')).toBeNull()
  })
})
