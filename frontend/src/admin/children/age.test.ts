import { describe, expect, it } from 'vitest'
import { childAge } from './age'

describe('childAge', () => {
  const today = new Date(2026, 9, 20)

  it('counts months until two years, then years', () => {
    expect(childAge('2026-10-01', today)).toEqual({ unit: 'months', count: 0 })
    expect(childAge('2026-01-15', today)).toEqual({ unit: 'months', count: 9 })
    expect(childAge('2024-10-21', today)).toEqual({ unit: 'months', count: 23 })
    expect(childAge('2024-10-20', today)).toEqual({ unit: 'years', count: 2 })
    expect(childAge('2019-03-01', today)).toEqual({ unit: 'years', count: 7 })
  })

  it('ignores missing, invalid and future dates', () => {
    expect(childAge(null, today)).toBeNull()
    expect(childAge('2026-02-30', today)).toBeNull()
    expect(childAge('2026-10-21', today)).toBeNull()
  })
})
