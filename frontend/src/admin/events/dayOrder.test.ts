import { describe, expect, it } from 'vitest'
import { applyDayOrder, groupByDay } from './dayOrder'

const item = (id: number, date: string) => ({ id, date })

describe('groupByDay', () => {
  it('groups consecutive items of the same date', () => {
    const items = [item(1, '2026-03-12'), item(2, '2026-03-12'), item(3, '2026-03-10'), item(4, '2026-03-09'), item(5, '2026-03-09')]
    expect(groupByDay(items).map((group) => group.map((entry) => entry.id))).toEqual([[1, 2], [3], [4, 5]])
    expect(groupByDay([])).toEqual([])
  })
})

describe('applyDayOrder', () => {
  const items = [item(1, '2026-03-12'), item(2, '2026-03-11'), item(3, '2026-03-11'), item(4, '2026-03-11'), item(5, '2026-03-10')]

  it('reorders the events of the day', () => {
    expect(applyDayOrder(items, '2026-03-11', [4, 2, 3]).map((entry) => entry.id)).toEqual([1, 4, 2, 3, 5])
  })

  it('moves a subset among its own places', () => {
    expect(applyDayOrder(items, '2026-03-11', [4, 2]).map((entry) => entry.id)).toEqual([1, 4, 3, 2, 5])
  })

  it('ignores ids of other days or not listed', () => {
    expect(applyDayOrder(items, '2026-03-11', [5, 9, 3, 2]).map((entry) => entry.id)).toEqual([1, 3, 2, 4, 5])
    expect(applyDayOrder(items, '2026-03-11', [])).toEqual(items)
  })
})
