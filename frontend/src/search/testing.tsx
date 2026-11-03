// Test helpers for the search feature (import from *.test.tsx files only).
import type { TimelineEventOut, TimelineOut } from '../api/schema.gen'
import { useCurrentChild } from '../contexts/CurrentChildContext'
import { TEST_CHILDREN, renderWithProviders, type MockRequest } from '../utils/test-utils'
import { FilterPanel } from './FilterPanel'
import { FilterPanelProvider } from './FilterPanelContext'
import { FilterToggleButton } from './FilterToggleButton'
import { SearchBar } from './SearchBar'
import { foldText, searchTokens } from './searchText'

function event(id: number, title: string, date: string, categoryIds: number[], cover = false): TimelineEventOut {
  return {
    id,
    title,
    date,
    day_order: 0,
    category_ids: categoryIds,
    child_ids: [1],
    cover: cover ? { id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, thumb_url: `/api/media/${id}/thumb`, dominant_color: '#c8a27a' } : null,
    image_count: cover ? 1 : 0,
    created_at: `${date}T10:00:00Z`,
  }
}

/** Ana's events, newest first (categories: 1 language, 2 sleep, 3 feeding). */
export const TIMELINE_EVENTS: TimelineEventOut[] = [
  event(12, 'Primer día en el jardín de infancia', '2026-09-08', [1], true),
  event(11, 'Pasos sin ayuda', '2026-06-14', [1, 2], true),
  event(10, 'Duerme toda la noche', '2026-03-02', [2]),
  event(9, 'Primeros pasos', '2026-01-20', [1, 3], true),
  event(8, 'Papilla de calabaza', '2025-11-11', [3]),
  event(7, 'Dice «papá»', '2025-10-01', [1]),
  event(6, 'Paseo por el parque', '2025-07-19', [2]),
  event(5, 'Repaso de canciones', '2025-05-05', [1]),
  event(4, 'Pasea en triciclo', '2025-03-03', [2]),
  event(3, 'Pasta con tomate', '2025-01-30', [3]),
  event(2, 'Paseo por la playa', '2024-08-15', [2]),
  event(1, 'Nace Ana', '2024-05-02', [1]),
]

/** `GET /api/children/1/timeline` filtering like the backend (q tokens, inclusive dates, any category). */
export function timelineHandler(events: readonly TimelineEventOut[] = TIMELINE_EVENTS) {
  return ({ url }: MockRequest): TimelineOut => {
    const tokens = searchTokens(url.searchParams.get('q') ?? '')
    const from = url.searchParams.get('date_from')
    const to = url.searchParams.get('date_to')
    const categoryIds = url.searchParams.getAll('category_id').map(Number)
    const matching = events.filter(
      (item) =>
        tokens.every((token) => foldText(item.title).includes(token)) &&
        (!from || item.date >= from) &&
        (!to || item.date <= to) &&
        (categoryIds.length === 0 || item.category_ids.some((id) => categoryIds.includes(id))),
    )
    return { child_id: TEST_CHILDREN[0].id, total: events.length, events: matching }
  }
}

/** The current child's name once the children have loaded (like the timeline page heading). */
function ChildHeading() {
  const { child } = useCurrentChild()
  return child ? <h1>{child.name}</h1> : null
}

/** Header-like search + filter button, a focusable "timeline" control and the panel. */
export function SearchHarness() {
  return (
    <FilterPanelProvider>
      <header>
        <SearchBar />
        <FilterToggleButton />
      </header>
      <main>
        <ChildHeading />
        <button type="button">Hito del timeline</button>
        <label>
          Notas
          <input />
        </label>
        <FilterPanel />
      </main>
    </FilterPanelProvider>
  )
}

/** Renders {@link SearchHarness} (or `ui`) at `/c/:childSlug/*`. */
export function renderSearch(route = '/c/ana', ui = <SearchHarness />) {
  return renderWithProviders(ui, { route, path: '/c/:childSlug/*' })
}

export function currentUrl(router: ReturnType<typeof renderSearch>['router']): string {
  const { pathname, search } = router.state.location
  return `${pathname}${decodeURIComponent(search).replace(/\+/g, ' ')}`
}
