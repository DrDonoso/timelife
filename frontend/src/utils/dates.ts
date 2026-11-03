/**
 * Date helpers. API dates are `YYYY-MM-DD` strings and must be read as LOCAL calendar dates
 * (`new Date('2026-03-12')` would be UTC midnight and can shift to the previous day).
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a valid `YYYY-MM-DD` calendar date. */
export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  const date = new Date(year, month - 1, day)
  date.setFullYear(year, month - 1, day) // years 0..99 would otherwise map to 1900..1999 (date pickers emit 0002 while typing 2026)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

/**
 * `YYYY-MM-DD` → local `Date` at midnight. Full ISO datetimes (`2026-03-12T10:00:00Z`) are parsed
 * as instants. Invalid input → `Invalid Date`.
 */
export function parseISODate(value: string): Date {
  const match = ISO_DATE.exec(value)
  if (match) {
    const [, year, month, day] = match.map(Number)
    const date = new Date(year, month - 1, day)
    date.setFullYear(year) // years 0..99 would otherwise map to 1900..1999
    return date
  }
  return new Date(value)
}

/** Local calendar date of `date` as `YYYY-MM-DD`. */
export function toISODate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4))
}

/** Month 1..12. */
export function monthOf(isoDate: string): number {
  return Number(isoDate.slice(5, 7))
}

export function dayOf(isoDate: string): number {
  return Number(isoDate.slice(8, 10))
}

/** Lexicographic comparison works for `YYYY-MM-DD`; returns -1, 0 or 1. */
export function compareISODate(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** `YYYY-MM-DD` shifted by whole years / months / days (month ends clamp: 31 Jan + 1 month → 28/29 Feb). */
export function shiftISODate(isoDate: string, { years = 0, months = 0, days = 0 }: { years?: number; months?: number; days?: number }): string {
  const date = parseISODate(isoDate)
  if (Number.isNaN(date.getTime())) return isoDate
  const day = date.getDate()
  date.setDate(1)
  date.setFullYear(date.getFullYear() + years)
  date.setMonth(date.getMonth() + months)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  date.setDate(date.getDate() + days)
  return toISODate(date)
}
