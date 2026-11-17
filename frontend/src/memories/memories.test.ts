import { describe, expect, it } from 'vitest'
import type { TimelineEventOut } from '../api/schema.gen'
import { memoriesOn, memoryAge, nextMemories } from './memories'

function event(id: number, date: string): TimelineEventOut {
  return { id, title: `Hito ${id}`, date, day_order: 0, category_ids: [], child_ids: [1], cover: null, image_count: 0, created_at: `${date}T20:00:00Z` }
}

const ids = (memories: readonly { event: TimelineEventOut }[]) => memories.map((memory) => memory.event.id)

describe('memoryAge', () => {
  it('counts months on the same day of the month up to 11, then whole years', () => {
    expect(memoryAge('2026-10-17', '2026-11-17')).toEqual({ unit: 'months', count: 1 })
    expect(memoryAge('2025-12-17', '2026-11-17')).toEqual({ unit: 'months', count: 11 })
    expect(memoryAge('2025-11-17', '2026-11-17')).toEqual({ unit: 'years', count: 1 })
    expect(memoryAge('2023-11-17', '2026-11-17')).toEqual({ unit: 'years', count: 3 })
    for (const date of ['2026-11-17', '2026-11-16', '2026-10-16', '2025-10-17', '2024-05-17', '2026-12-17']) {
      expect(memoryAge(date, '2026-11-17')).toBeNull()
    }
  })

  it('remembers the 29th to 31st on the last day of shorter months, and 29 February on the 28th', () => {
    for (const date of ['2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31']) {
      expect(memoryAge(date, '2026-02-28')).toEqual({ unit: 'months', count: 1 })
    }
    expect(memoryAge('2026-03-31', '2026-04-30')).toEqual({ unit: 'months', count: 1 })
    expect(memoryAge('2026-01-31', '2026-03-31')).toEqual({ unit: 'months', count: 2 })
    expect(memoryAge('2026-01-31', '2026-03-28')).toBeNull()
    expect(memoryAge('2028-01-31', '2028-02-29')).toEqual({ unit: 'months', count: 1 })
    expect(memoryAge('2028-01-31', '2028-02-28')).toBeNull()
    expect(memoryAge('2024-02-29', '2025-02-28')).toEqual({ unit: 'years', count: 1 })
    expect(memoryAge('2024-02-29', '2028-02-29')).toEqual({ unit: 'years', count: 4 })
    expect(memoryAge('2024-02-29', '2028-02-28')).toBeNull()
  })
})

describe('memoriesOn', () => {
  it('lists the most recent first, keeping the order of the milestones of the same age', () => {
    const events = [event(1, '2026-11-17'), event(2, '2024-11-17'), event(3, '2026-10-17'), event(4, '2025-11-17'), event(5, '2026-08-17'), event(6, '2026-10-17'), event(7, '2026-10-18')]
    expect(memoriesOn(events, '2026-11-17').map(({ event: { id }, unit, count }) => [id, unit, count])).toEqual([
      [3, 'months', 1],
      [6, 'months', 1],
      [5, 'months', 3],
      [4, 'years', 1],
      [2, 'years', 2],
    ])
    expect(memoriesOn([], '2026-11-17')).toEqual([])
  })
})

describe('nextMemories', () => {
  it('finds the first day after today with memories, and all of them', () => {
    const events = [event(1, '2026-11-17'), event(2, '2025-11-20'), event(3, '2026-10-20'), event(4, '2026-09-21')]
    const next = nextMemories(events, '2026-11-17')
    expect(next?.day).toBe('2026-11-20')
    expect(ids(next?.memories ?? [])).toEqual([3, 2])
    expect(nextMemories([], '2026-11-17')).toBeNull()
  })

  it('skips today and goes on to the next month, or to the next whole year after 11 months', () => {
    expect(nextMemories([event(1, '2026-10-17')], '2026-11-17')?.day).toBe('2026-12-17')
    expect(nextMemories([event(1, '2026-01-31')], '2026-02-28')?.day).toBe('2026-03-31')
    expect(nextMemories([event(1, '2025-12-17')], '2026-11-17')?.day).toBe('2026-12-17')
    expect(nextMemories([event(1, '2025-12-17')], '2026-11-18')?.day).toBe('2026-12-17')
    expect(nextMemories([event(1, '2025-11-17')], '2026-11-17')?.day).toBe('2027-11-17')
    expect(nextMemories([event(1, '2024-02-29')], '2026-03-01')?.day).toBe('2027-02-28')
    // Milestones of today or later start a month after their day.
    expect(nextMemories([event(1, '2026-11-17')], '2026-11-17')?.day).toBe('2026-12-17')
    expect(nextMemories([event(1, '2026-12-25')], '2026-11-17')?.day).toBe('2027-01-25')
  })
})
