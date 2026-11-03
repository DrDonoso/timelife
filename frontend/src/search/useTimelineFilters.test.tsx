import { act, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { TEST_CATEGORIES, mockSignedIn, reply } from '../utils/test-utils'
import { currentUrl, renderSearch } from './testing'
import { countActiveFilters, parseCategoryIds, parseTimelineFilters, useTimelineFilters, type TimelineFiltersApi } from './useTimelineFilters'

const parse = (search: string) => parseTimelineFilters(new URLSearchParams(search))

describe('parseTimelineFilters', () => {
  it('reads q, from, to and cat', () => {
    expect(parse('q=%20primeros%20%20pasos%20&from=2026-01-01&to=2026-03-31&cat=3,1')).toEqual({
      q: 'primeros pasos',
      from: '2026-01-01',
      to: '2026-03-31',
      categoryIds: [1, 3],
    })
    expect(parse('')).toEqual({ q: '', from: null, to: null, categoryIds: [] })
  })

  it('ignores invalid dates and swaps reversed bounds', () => {
    expect(parse('from=2026-02-30&to=ayer')).toMatchObject({ from: null, to: null })
    expect(parse('from=2026-13-01&to=2026-05-01')).toMatchObject({ from: null, to: '2026-05-01' })
    expect(parse('from=2026-12-31&to=2026-01-01')).toMatchObject({ from: '2026-01-01', to: '2026-12-31' })
    // Implausible years (outside 1900 … 2200) are ignored too.
    expect(parse('from=0002-01-01&to=2300-01-01')).toMatchObject({ from: null, to: null })
    expect(parse('from=1900-01-01&to=2200-12-31')).toMatchObject({ from: '1900-01-01', to: '2200-12-31' })
  })

  it('keeps only valid, distinct category ids (1 … 2³¹-1)', () => {
    expect(parseCategoryIds('2, 2,x,-1,0,1.5,1e3, 7 ,2147483647,2147483648,99999999999')).toEqual([2, 7, 2147483647])
    expect(parseCategoryIds('')).toEqual([])
    expect(parseCategoryIds(null)).toEqual([])
  })

  it('counts the query, the date range once and each category', () => {
    expect(countActiveFilters(parse(''))).toBe(0)
    expect(countActiveFilters(parse('from=2026-01-01&to=2026-12-31'))).toBe(1)
    expect(countActiveFilters(parse('to=2026-12-31&cat=1,2'))).toBe(3)
    expect(countActiveFilters(parse('q=luna&from=2026-01-01&cat=1,2,3'))).toBe(5)
  })
})

const probe: { api: TimelineFiltersApi | null } = { api: null }

/** Latest hook result (published after each commit). */
function api(): TimelineFiltersApi {
  if (!probe.api) throw new Error('Probe not rendered')
  return probe.api
}

function Probe() {
  const value = useTimelineFilters()
  useLayoutEffect(() => {
    probe.api = value
  })
  return <output>{JSON.stringify(value.filters)}</output>
}

function setup(route: string, extra = {}) {
  probe.api = null
  mockSignedIn(undefined, extra)
  return renderSearch(route, <Probe />)
}

describe('useTimelineFilters', () => {
  it('parses the URL and keeps the same filters object while other params change', async () => {
    const { router } = setup('/c/ana?q=pasos&cat=2&zoom=months')
    await screen.findByText(/"categoryIds":\[2\]/)
    const before = api().filters
    expect(before).toEqual({ q: 'pasos', from: null, to: null, categoryIds: [2] })
    expect(api().activeCount).toBe(2)

    await act(() => router.navigate('/c/ana?zoom=events&q=pasos&focus=e3&cat=2'))
    expect(api().filters).toBe(before)
  })

  it('updates the URL, preserving zoom, focus and unrelated params', async () => {
    const { router } = setup('/c/ana?zoom=months&focus=m2026-03&utm=x')
    await screen.findByText(/"q":""/)

    act(() => api().setQuery('  primeros   pasos '))
    expect(currentUrl(router)).toBe('/c/ana?zoom=months&focus=m2026-03&utm=x&q=primeros pasos')

    act(() => api().setRange('2026-12-31', '2026-01-01'))
    expect(router.state.location.search).toContain('from=2026-01-01&to=2026-12-31')

    act(() => api().setCategories([3, 1, 3]))
    expect(router.state.location.search).toContain('cat=1,3')

    act(() => api().toggleCategory(2))
    expect(router.state.location.search).toContain('cat=1,2,3')
    act(() => api().toggleCategory(1))
    expect(router.state.location.search).toContain('cat=2,3')
    expect(api().filters).toEqual({ q: 'primeros pasos', from: '2026-01-01', to: '2026-12-31', categoryIds: [2, 3] })
    expect(api().activeCount).toBe(4)

    act(() => api().setRange('2026-05-01', 'no-date'))
    expect(api().filters).toMatchObject({ from: '2026-05-01', to: null })

    act(() => api().clear())
    expect(currentUrl(router)).toBe('/c/ana?zoom=months&focus=m2026-03&utm=x')
    expect(api().activeCount).toBe(0)
  })

  it('replaces the history entry and keeps the location state', async () => {
    const { router } = setup('/c/ana')
    await screen.findByText(/"q":""/)
    const state = { originRect: { x: 1, y: 2, width: 3, height: 4 } }
    await act(() => router.navigate('/c/ana/e/9?zoom=events', { state }))
    expect(router.state.historyAction).toBe('PUSH')

    act(() => api().setQuery('luna'))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(currentUrl(router)).toBe('/c/ana/e/9?zoom=events&q=luna')
    expect(router.state.location.state).toEqual(state)
  })

  it('applies several updates fired in the same tick', async () => {
    const { router } = setup('/c/ana?zoom=years')
    await screen.findByText(/"q":""/)
    act(() => {
      api().setQuery('sol')
      api().toggleCategory(1)
      api().toggleCategory(3)
      api().setRange('2025-01-01', null)
    })
    expect(currentUrl(router)).toBe('/c/ana?zoom=years&q=sol&cat=1,3&from=2025-01-01')
  })

  it('does not navigate when nothing changes', async () => {
    const { router } = setup('/c/ana?q=sol')
    await screen.findByText(/"q":"sol"/)
    const location = router.state.location
    act(() => {
      api().setQuery(' sol ')
      api().setCategories([])
      api().setRange(null, null)
    })
    expect(router.state.location).toBe(location)
  })

  it('ignores category ids that no longer exist once categories have loaded', async () => {
    const { router } = setup('/c/ana?cat=2,99')
    await screen.findByText(/"categoryIds":\[2\]/)
    expect(api().activeCount).toBe(1)
    act(() => api().toggleCategory(3))
    expect(router.state.location.search).toBe('?cat=2,3')
  })

  it('keeps unknown ids while categories cannot be loaded', async () => {
    const { queryClient } = setup('/c/ana?cat=2,99', { 'GET /api/categories': reply(500, { code: 'internal_error' }) })
    await waitFor(() => expect(queryClient.getQueryState(['categories'])?.status).toBe('error'))
    expect(api().filters.categoryIds).toEqual([2, 99])
    expect(TEST_CATEGORIES.some((category) => category.id === 99)).toBe(false)
  })
})
