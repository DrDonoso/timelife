/**
 * Memories ("on this day"): the milestones that turn a whole number of months (1 to 11) or of
 * years old on a day. Months count from the same day of the month: a milestone on a day some
 * months lack (29th to 31st) is remembered on their last day, and one on 29 February on the 28th
 * in the other years. Dates are `YYYY-MM-DD` on the device's calendar.
 */
import type { TimelineEventOut } from '../api/schema.gen'
import { monthOf, shiftISODate, yearOf } from '../utils/dates'

export interface MemoryAge {
  /** `months`: 1 to 11; `years`: 1 or more. */
  readonly unit: 'months' | 'years'
  readonly count: number
}

export interface Memory extends MemoryAge {
  readonly event: TimelineEventOut
}

export interface NextMemories {
  /** The first day after today with memories. */
  readonly day: string
  readonly memories: readonly Memory[]
}

/** Calendar months from `from` to `to`, whatever their days. */
function monthsBetween(from: string, to: string): number {
  return (yearOf(to) - yearOf(from)) * 12 + monthOf(to) - monthOf(from)
}

/** Ages worth remembering: 1 to 11 months, then whole years. */
function remembered(months: number): boolean {
  return months >= 1 && (months < 12 || months % 12 === 0)
}

/** How old a milestone of `date` is on `day`, when that makes it one of the day's memories. */
export function memoryAge(date: string, day: string): MemoryAge | null {
  const months = monthsBetween(date, day)
  if (!remembered(months) || shiftISODate(date, { months }) !== day) return null
  return months < 12 ? { unit: 'months', count: months } : { unit: 'years', count: months / 12 }
}

function inMonths({ unit, count }: MemoryAge): number {
  return unit === 'years' ? count * 12 : count
}

/** The memories of `day`: the most recent first; those of the same age in the order of `events`. */
export function memoriesOn(events: readonly TimelineEventOut[], day: string): Memory[] {
  const memories: Memory[] = []
  for (const event of events) {
    const age = memoryAge(event.date, day)
    if (age) memories.push({ event, ...age })
  }
  return memories.toSorted((a, b) => inMonths(a) - inMonths(b))
}

/** The first day after `today` on which a milestone of `date` is a memory. */
function nextDay(date: string, today: string): string | null {
  const first = Math.max(1, monthsBetween(date, today))
  // It falls in today's month or the next one, or else on the next whole year.
  for (let months = first; months <= first + 12; months += 1) {
    if (!remembered(months)) continue
    const day = shiftISODate(date, { months })
    if (day > today) return day
  }
  return null
}

/** The first day after `today` with memories, and its memories (null without milestones). */
export function nextMemories(events: readonly TimelineEventOut[], today: string): NextMemories | null {
  let next: string | null = null
  for (const event of events) {
    const day = nextDay(event.date, today)
    if (day !== null && (next === null || day < next)) next = day
  }
  return next === null ? null : { day: next, memories: memoriesOn(events, next) }
}
