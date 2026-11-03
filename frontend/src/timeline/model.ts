import type { ImageOut, TimelineEventOut } from '../api/schema.gen'
import { LEVEL_BY_KIND, levelDepth, type ZoomLevel } from './types'

/**
 * Timeline hierarchy (years → months → events), newest first, built from the API's flat list.
 *
 * Node keys double as the URL `focus` values: `y2026` (year), `m2026-03` (month), `e123` (event).
 */

export interface EventEntry {
  kind: 'event'
  key: string
  event: TimelineEventOut
  year: number
  /** 1..12 */
  month: number
  yearKey: string
  monthKey: string
}

export interface MonthEntry {
  kind: 'month'
  key: string
  year: number
  /** 1..12 */
  month: number
  yearKey: string
  /** Events in this month. */
  count: number
  events: EventEntry[]
}

export interface YearEntry {
  kind: 'year'
  key: string
  year: number
  /** Events in this year. */
  count: number
  months: MonthEntry[]
}

export type TimelineEntry = YearEntry | MonthEntry | EventEntry

/** A child with its own line on the family timeline ("All together"). */
export interface TimelineLane {
  id: number
  name: string
  avatar: ImageOut | null
  /** The child's own line colour (as chosen; painted adapted to the palette), else automatic. */
  color?: string | null
}

export interface TimelineModel {
  years: YearEntry[]
  /** Every month of every year, newest first. */
  months: MonthEntry[]
  /** Every event, newest first. */
  events: EventEntry[]
  byKey: ReadonlyMap<string, TimelineEntry>
  /**
   * Family timeline: every child in display order, each drawn on its own line at the events level
   * (merging at shared milestones). Empty for a single child's timeline.
   */
  lanes: readonly TimelineLane[]
}

export type ParsedKey =
  | { kind: 'year'; year: number }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'event'; id: number }

const MAX_ID = 2 ** 31 - 1
const KEY_PATTERN = /^(?:y(\d{4})|m(\d{4})-(\d{2})|e([1-9]\d{0,9}))$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function yearKey(year: number): string {
  return `y${year}`
}

export function monthKey(year: number, month: number): string {
  return `m${year}-${String(month).padStart(2, '0')}`
}

export function eventKey(id: number): string {
  return `e${id}`
}

/** Parses a node key / URL `focus` value; anything malformed → `null`. */
export function parseNodeKey(value: string | null | undefined): ParsedKey | null {
  if (typeof value !== 'string') return null
  const match = KEY_PATTERN.exec(value)
  if (!match) return null
  const [, year, monthYear, month, id] = match
  if (year !== undefined) return { kind: 'year', year: Number(year) }
  if (monthYear !== undefined) {
    const monthNumber = Number(month)
    return monthNumber >= 1 && monthNumber <= 12 ? { kind: 'month', year: Number(monthYear), month: monthNumber } : null
  }
  const eventId = Number(id)
  return eventId <= MAX_ID ? { kind: 'event', id: eventId } : null
}

/** Level a key lives on (`y…` → years, `m…` → months, `e…` → events). */
export function levelOfKey(key: string | null | undefined): ZoomLevel | null {
  const parsed = parseNodeKey(key)
  return parsed ? LEVEL_BY_KIND[parsed.kind] : null
}

function descending(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? 1 : -1
}

/** API order: date DESC, day_order ASC, created_at DESC, id DESC. */
export function compareEvents(a: TimelineEventOut, b: TimelineEventOut): number {
  return descending(a.date, b.date) || a.day_order - b.day_order || descending(a.created_at, b.created_at) || b.id - a.id
}

/**
 * Groups events into years → months → events (newest first) with counts; ignores malformed dates.
 * `lanes`: the children of the family timeline (see {@link TimelineModel.lanes}).
 */
export function buildTimelineModel(events: readonly TimelineEventOut[], lanes: readonly TimelineLane[] = []): TimelineModel {
  const years: YearEntry[] = []
  const months: MonthEntry[] = []
  const entries: EventEntry[] = []
  const byKey = new Map<string, TimelineEntry>()
  let currentYear = null as YearEntry | null
  let currentMonth = null as MonthEntry | null

  for (const event of events.toSorted(compareEvents)) {
    const match = DATE_PATTERN.exec(event.date)
    if (!match) continue
    const year = Number(match[1])
    const month = Number(match[2])
    if (month < 1 || month > 12 || byKey.has(eventKey(event.id))) continue

    if (currentYear?.year !== year) {
      currentYear = { kind: 'year', key: yearKey(year), year, count: 0, months: [] }
      currentMonth = null
      years.push(currentYear)
      byKey.set(currentYear.key, currentYear)
    }
    if (currentMonth?.month !== month) {
      currentMonth = { kind: 'month', key: monthKey(year, month), year, month, yearKey: currentYear.key, count: 0, events: [] }
      currentYear.months.push(currentMonth)
      months.push(currentMonth)
      byKey.set(currentMonth.key, currentMonth)
    }
    const entry: EventEntry = {
      kind: 'event',
      key: eventKey(event.id),
      event,
      year,
      month,
      yearKey: currentYear.key,
      monthKey: currentMonth.key,
    }
    currentMonth.events.push(entry)
    currentMonth.count += 1
    currentYear.count += 1
    entries.push(entry)
    byKey.set(entry.key, entry)
  }

  return { years, months, events: entries, byKey, lanes }
}

/** Nodes shown at a zoom level, in timeline order (newest first). */
export function entriesAt(model: TimelineModel, level: ZoomLevel): readonly TimelineEntry[] {
  if (level === 'years') return model.years
  if (level === 'months') return model.months
  return model.events
}

function entryLevel(entry: TimelineEntry): ZoomLevel {
  return LEVEL_BY_KIND[entry.kind]
}

/** The node at `level` containing `key` (itself when it already lives there); `null` for deeper levels. */
export function ancestorKey(model: TimelineModel, key: string, level: ZoomLevel): string | null {
  const entry = model.byKey.get(key)
  if (!entry) return null
  const depth = levelDepth(level)
  const own = levelDepth(entryLevel(entry))
  if (depth > own) return null
  if (depth === own) return entry.key
  if (level === 'years') return entry.kind === 'year' ? entry.key : entry.yearKey
  return entry.kind === 'event' ? entry.monthKey : null
}

/** Nodes at `level` inside `key` (newest first; `[key]` itself on its own level). */
export function descendantKeys(model: TimelineModel, key: string, level: ZoomLevel): string[] {
  const entry = model.byKey.get(key)
  if (!entry) return []
  const depth = levelDepth(level)
  const own = levelDepth(entryLevel(entry))
  if (depth < own) return []
  if (depth === own) return [entry.key]
  if (entry.kind === 'year') {
    return level === 'months'
      ? entry.months.map((month) => month.key)
      : entry.months.flatMap((month) => month.events.map((event) => event.key))
  }
  return entry.kind === 'month' ? entry.events.map((event) => event.key) : []
}

/** `key` expressed at `level`: its ancestor when zooming out, its newest descendant when zooming in. */
export function representativeKey(model: TimelineModel, key: string, level: ZoomLevel): string | null {
  const entry = model.byKey.get(key)
  if (!entry) return null
  if (levelDepth(level) <= levelDepth(entryLevel(entry))) return ancestorKey(model, key, level)
  return descendantKeys(model, key, level)[0] ?? null
}

function monthOrdinal(year: number, month: number): number {
  return year * 12 + (month - 1)
}

function entryOrdinal(entry: TimelineEntry): number {
  return entry.kind === 'year' ? monthOrdinal(entry.year, 12) : monthOrdinal(entry.year, entry.month)
}

/**
 * Node at `level` for a URL `focus` value. Years/months without (filtered) events fall back to the
 * closest period in time, so a stale focus still lands somewhere sensible; unknown events → `null`.
 */
export function resolveFocusKey(model: TimelineModel, focus: string | null | undefined, level: ZoomLevel): string | null {
  const parsed = parseNodeKey(focus)
  if (!parsed || !focus) return null
  const direct = representativeKey(model, focus, level)
  if (direct || parsed.kind === 'event') return direct
  const target = parsed.kind === 'year' ? monthOrdinal(parsed.year, 12) : monthOrdinal(parsed.year, parsed.month)
  const candidates = parsed.kind === 'year' ? model.years : model.months
  let best: TimelineEntry | null = null
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = Math.abs(entryOrdinal(candidate) - target)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best ? representativeKey(model, best.key, level) : null
}
