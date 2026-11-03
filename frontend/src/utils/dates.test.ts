import { describe, expect, it } from 'vitest'
import { compareISODate, isISODate, monthOf, parseISODate, shiftISODate, toISODate, yearOf } from './dates'

describe('dates', () => {
  it('parses API dates as local calendar dates (no timezone shift)', () => {
    const date = parseISODate('2026-03-12')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(2)
    expect(date.getDate()).toBe(12)
    expect(date.getHours()).toBe(0)
    expect(toISODate(date)).toBe('2026-03-12')
  })

  it('parses ISO datetimes as instants', () => {
    expect(parseISODate('2026-03-12T10:00:00Z').toISOString()).toBe('2026-03-12T10:00:00.000Z')
    expect(Number.isNaN(parseISODate('nope').getTime())).toBe(true)
  })

  it('validates calendar dates', () => {
    expect(isISODate('2026-02-28')).toBe(true)
    expect(isISODate('2028-02-29')).toBe(true)
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('2026-3-1')).toBe(false)
    expect(isISODate(null)).toBe(false)
  })

  it('extracts parts and compares', () => {
    expect(yearOf('2026-03-12')).toBe(2026)
    expect(monthOf('2026-03-12')).toBe(3)
    expect(compareISODate('2025-12-31', '2026-01-01')).toBe(-1)
    expect(compareISODate('2026-01-01', '2026-01-01')).toBe(0)
  })

  it('shifts dates clamping month ends', () => {
    expect(shiftISODate('2026-01-31', { months: 1 })).toBe('2026-02-28')
    expect(shiftISODate('2026-03-12', { years: -1 })).toBe('2025-03-12')
    expect(shiftISODate('2026-03-12', { days: 20 })).toBe('2026-04-01')
  })
})
