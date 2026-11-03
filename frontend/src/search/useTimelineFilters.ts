import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useCategories, type TimelineFilters } from '../api/queries'
import { isISODate, yearOf } from '../utils/dates'
import { normalizeQuery } from './searchText'

export interface TimelineFiltersApi {
  /** Parsed, validated filters. Same object while q/from/to/cat don't change (safe in query keys and deps). */
  filters: TimelineFilters
  /** Search text (trimmed, single-spaced, ≤ 200 characters); '' removes it. */
  setQuery: (q: string) => void
  /** Inclusive `YYYY-MM-DD` bounds (null = open); invalid dates are dropped, reversed bounds swapped. */
  setRange: (from: string | null, to: string | null) => void
  setCategories: (ids: number[]) => void
  toggleCategory: (id: number) => void
  /** Removes q, from, to and cat (zoom, focus and any other parameter stay). */
  clear: () => void
  /** Active filters: the search query (1), the date range (1, however many bounds) and each category. */
  activeCount: number
}

/** URL parameters owned by the filters (spec 30). */
export const FILTER_PARAMS = ['q', 'from', 'to', 'cat'] as const

/** Plausible years for the date filters (same bounds as the year colours API). */
export const MIN_FILTER_YEAR = 1900
export const MAX_FILTER_YEAR = 2200

const MAX_ID = 2_147_483_647
const MAX_CATEGORY_IDS = 100

function isFilterDate(value: string | null | undefined): value is string {
  if (!isISODate(value)) return false
  const year = yearOf(value)
  return year >= MIN_FILTER_YEAR && year <= MAX_FILTER_YEAR
}

/** Valid, distinct, ascending ids from a comma-separated list (`"3,x,1,3"` → `[1, 3]`). */
export function parseCategoryIds(value: string | null | undefined): number[] {
  if (!value) return []
  const ids = new Set<number>()
  for (const part of value.split(',')) {
    const text = part.trim()
    if (!/^\d{1,10}$/.test(text)) continue
    const id = Number(text)
    if (id >= 1 && id <= MAX_ID) ids.add(id)
  }
  return [...ids].toSorted((a, b) => a - b).slice(0, MAX_CATEGORY_IDS)
}

/** Valid bounds in order (`from` ≤ `to`); invalid or implausible dates become null. */
export function parseRange(from: string | null | undefined, to: string | null | undefined): [string | null, string | null] {
  const start = isFilterDate(from) ? from : null
  const end = isFilterDate(to) ? to : null
  return start && end && start > end ? [end, start] : [start, end]
}

/** Filters encoded in URL search params; anything invalid is ignored. */
export function parseTimelineFilters(params: URLSearchParams): TimelineFilters {
  const [from, to] = parseRange(params.get('from'), params.get('to'))
  return {
    q: normalizeQuery(params.get('q')),
    from,
    to,
    categoryIds: parseCategoryIds(params.get('cat')),
  }
}

/** Number of active filters: query (1) + date range (1) + one per category. */
export function countActiveFilters(filters: TimelineFilters): number {
  return (filters.q ? 1 : 0) + (filters.from || filters.to ? 1 : 0) + filters.categoryIds.length
}

/** `?a=1&cat=1,3` (or '' when empty); commas stay readable instead of `%2C`. */
export function searchString(params: URLSearchParams): string {
  const search = params.toString().replace(/%2C/gi, ',')
  return search ? `?${search}` : ''
}

interface LocationSnapshot {
  pathname: string
  search: string
  state: unknown
}

/**
 * Timeline filters synced with the URL (`q`, `from`, `to`, `cat` = comma ids), replacing the
 * current history entry and preserving every other parameter (`zoom`, `focus`, …) and the
 * location state. Category ids unknown to `/api/categories` are ignored once it has loaded.
 */
export function useTimelineFilters(): TimelineFiltersApi {
  const location = useLocation()
  const navigate = useNavigate()
  const categories = useCategories()

  const parsed = parseTimelineFilters(new URLSearchParams(location.search))
  const known = categories.data
  const categoryKey = (known ? parsed.categoryIds.filter((id) => known.some((category) => category.id === id)) : parsed.categoryIds).join(',')
  const { q, from, to } = parsed
  const filters = useMemo<TimelineFilters>(
    () => ({ q, from, to, categoryIds: categoryKey ? categoryKey.split(',').map(Number) : [] }),
    [q, from, to, categoryKey],
  )

  // Setters may run from timers or handlers created in an earlier render: they always start from
  // the latest location (also after several updates in the same tick) instead of a stale one.
  const latest = useRef<LocationSnapshot>({ pathname: location.pathname, search: location.search, state: location.state })
  const knownIds = useRef<ReadonlySet<number> | null>(null)
  useLayoutEffect(() => {
    latest.current = { pathname: location.pathname, search: location.search, state: location.state }
  }, [location])
  useLayoutEffect(() => {
    knownIds.current = known ? new Set(known.map((category) => category.id)) : null
  }, [known])

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const current = latest.current
      const before = new URLSearchParams(current.search)
      const next = new URLSearchParams(current.search)
      mutate(next)
      if (next.toString() === before.toString()) return
      const search = searchString(next)
      latest.current = { ...current, search }
      void navigate(
        { pathname: current.pathname, search },
        { replace: true, preventScrollReset: true, state: current.state },
      )
    },
    [navigate],
  )

  const writeCategories = useCallback((next: URLSearchParams, ids: readonly number[]) => {
    const valid = knownIds.current
    const list = parseCategoryIds(ids.join(',')).filter((id) => !valid || valid.has(id))
    if (list.length) next.set('cat', list.join(','))
    else next.delete('cat')
  }, [])

  const setQuery = useCallback(
    (value: string) =>
      update((next) => {
        const text = normalizeQuery(value)
        if (text) next.set('q', text)
        else next.delete('q')
      }),
    [update],
  )

  const setRange = useCallback(
    (fromValue: string | null, toValue: string | null) =>
      update((next) => {
        const [start, end] = parseRange(fromValue, toValue)
        if (start) next.set('from', start)
        else next.delete('from')
        if (end) next.set('to', end)
        else next.delete('to')
      }),
    [update],
  )

  const setCategories = useCallback(
    (ids: number[]) => update((next) => writeCategories(next, ids)),
    [update, writeCategories],
  )

  const toggleCategory = useCallback(
    (id: number) =>
      update((next) => {
        const current = parseCategoryIds(next.get('cat'))
        writeCategories(next, current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
      }),
    [update, writeCategories],
  )

  const clear = useCallback(
    () =>
      update((next) => {
        for (const key of FILTER_PARAMS) next.delete(key)
      }),
    [update],
  )

  const activeCount = countActiveFilters(filters)
  return useMemo(
    () => ({ filters, setQuery, setRange, setCategories, toggleCategory, clear, activeCount }),
    [filters, setQuery, setRange, setCategories, toggleCategory, clear, activeCount],
  )
}
