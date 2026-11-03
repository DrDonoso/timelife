import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { eventOut } from '../admin/events/testing'
import type { AppearanceOut, EventIn, TimelineEventOut, TimelineOut } from '../api/schema.gen'
import { MODAL_EXIT_DELAY_MS } from '../event-detail/detailUtils'
import { todayISO } from '../utils/dates'
import { ADMIN_SESSION, VIEWER_SESSION, mockSignedIn, preloadLazyRoutes, renderApp, reply, type MockHandler } from '../utils/test-utils'
import { DEMO_CATEGORIES } from './testing/demoData'

beforeAll(preloadLazyRoutes)

function event(id: number, title: string, date: string, categoryIds: number[], withCover = true): TimelineEventOut {
  return {
    id,
    title,
    date,
    day_order: 0,
    category_ids: categoryIds,
    child_ids: [1],
    cover: withCover ? { id: `00000000-0000-4000-a000-00000000000${id}`, thumb_url: `/api/media/${id}/thumb`, dominant_color: '#d9a066' } : null,
    image_count: withCover ? 1 : 0,
    created_at: `${date}T10:00:00Z`,
  }
}

const EVENTS = [
  event(1, 'Primeros pasos', '2026-03-12', [6, 4]),
  event(2, 'Primera palabra', '2026-03-02', [4]),
  event(3, 'Primer diente', '2026-01-20', [3], false),
  event(4, 'Duerme toda la noche', '2025-12-24', [5]),
  event(5, 'Primera sonrisa', '2025-06-10', [9]),
]
const TIMELINE: TimelineOut = { child_id: 1, total: EVENTS.length, events: EVENTS }
const APPEARANCE: AppearanceOut = {
  year_colors: [],
  event_years: [2026, 2025],
  background: null,
  background_opacity: 0.18,
  default_zoom: 'events',
  direction_desktop: 'right_to_left',
  direction_mobile: 'bottom_to_top',
}

function mockTimeline(extra: Record<string, MockHandler> = {}, session = ADMIN_SESSION) {
  return mockSignedIn(session, {
    'GET /api/categories': DEMO_CATEGORIES,
    'GET /api/appearance': APPEARANCE,
    'GET /api/children/1/timeline': TIMELINE,
    ...extra,
  })
}

type Router = ReturnType<typeof renderApp>['router']
const params = (router: Router) => new URLSearchParams(router.state.location.search)
const titles = (links: HTMLElement[]) => links.map((link) => link.getAttribute('aria-label')?.split(' · ')[0])

const originalWidth = window.innerWidth
afterEach(() => {
  window.innerWidth = originalWidth
})

describe('TimelinePage', () => {
  it('renders the milestones newest first inside a labelled timeline', async () => {
    mockTimeline()
    renderApp('/c/ana')
    const list = await screen.findByRole('list', { name: '5 hitos' })
    expect(screen.getByRole('heading', { level: 1, name: 'Ana' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Línea de tiempo de Ana' })).toHaveAttribute('data-orientation', 'horizontal')
    const links = within(list).getAllByRole('link')
    expect(titles(links)).toEqual(['Primeros pasos', 'Primera palabra', 'Primer diente', 'Duerme toda la noche', 'Primera sonrisa'])
    expect(links[0]).toHaveAccessibleName('Primeros pasos · 12 de marzo de 2026 · Motricidad gruesa, Lenguaje y comunicación')
    // Roving tabindex: one tab stop for the whole line.
    expect(links.map((link) => link.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1'])
    expect(screen.getByRole('radio', { name: 'Días' })).toBeChecked()
  })

  it('opens the default level from the appearance settings', async () => {
    mockTimeline({ 'GET /api/appearance': { ...APPEARANCE, default_zoom: 'months' } })
    renderApp('/c/ana')
    const list = await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })
    expect(within(list).getByRole('button', { name: 'marzo de 2026 · 2 hitos' })).toBeInTheDocument()
  })

  it('drills into a hub when it is clicked', async () => {
    mockTimeline()
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?zoom=years&q=')
    const list = await screen.findByRole('list', { name: 'Años con hitos: 2 años' })
    await user.click(within(list).getByRole('button', { name: '2026 · 3 hitos' }))
    const march = await screen.findByRole('button', { name: 'marzo de 2026 · 2 hitos' })
    await waitFor(() => expect(params(router).get('zoom')).toBe('months'))
    expect(params(router).get('focus')).toBe('m2026-03')
    expect(params(router).has('q')).toBe(true)
    await waitFor(() => expect(march).toHaveFocus())
    await user.click(march)
    expect(await screen.findByRole('list', { name: '5 hitos' })).toBeInTheDocument()
    await waitFor(() => expect(params(router).get('zoom')).toBe('events'))
    expect(params(router).get('focus')).toBe('e1')
  })

  it('zooms with Ctrl + wheel and pans with a plain wheel', async () => {
    mockTimeline()
    const { router, container } = renderApp('/c/ana')
    await screen.findByRole('list', { name: '5 hitos' })
    const viewport = container.querySelector('.viewport') as HTMLElement
    fireEvent.wheel(viewport, { deltaY: 100 })
    expect(screen.getByRole('list', { name: '5 hitos' })).toBeInTheDocument()
    fireEvent.wheel(viewport, { deltaY: 120, ctrlKey: true })
    expect(await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })).toBeInTheDocument()
    await waitFor(() => expect(params(router).get('zoom')).toBe('months'))
    expect(await screen.findByText('Vista por meses · 4 elementos')).toBeInTheDocument()
  })

  it('zooms with the + / - keys', async () => {
    mockTimeline()
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?zoom=months')
    await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })
    await user.keyboard('-')
    expect(await screen.findByRole('list', { name: 'Años con hitos: 2 años' })).toBeInTheDocument()
    await waitFor(() => expect(params(router).get('zoom')).toBe('years'))
    await user.keyboard('=')
    expect(await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })).toBeInTheDocument()
    await user.keyboard('+')
    expect(await screen.findByRole('list', { name: '5 hitos' })).toBeInTheDocument()
  })

  it('moves along the line with the arrow keys and opens with Enter', async () => {
    mockTimeline()
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?zoom=events')
    const list = await screen.findByRole('list', { name: '5 hitos' })
    const links = within(list).getAllByRole('link')
    act(() => links[0].focus())
    await user.keyboard('{ArrowRight}')
    expect(links[1]).toHaveFocus()
    expect(links[1]).toHaveAttribute('tabindex', '0')
    expect(links[0]).toHaveAttribute('tabindex', '-1')
    await user.keyboard('{End}')
    expect(links[4]).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(links[3]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(links[0]).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana/e/1'))
  })

  it('opens the event detail keeping the search params and the circle rect', async () => {
    mockTimeline()
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?zoom=events&cat=4')
    const list = await screen.findByRole('list', { name: '5 hitos' })
    await user.click(within(list).getAllByRole('link')[1])
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana/e/2'))
    expect(router.state.location.search).toBe('?zoom=events&cat=4')
    expect(router.state.location.state).toEqual({ originRect: { x: 0, y: 0, width: 0, height: 0 } })
  })

  it('jumps to a searched event: days level, centred and pulsing', async () => {
    mockTimeline()
    const { router } = renderApp('/c/ana?zoom=years&focus=e3')
    const link = await screen.findByRole('link', { name: /^Primer diente/ })
    expect(link).toHaveAttribute('tabindex', '0')
    expect(link).toHaveAttribute('data-pulsing', 'true')
    await waitFor(() => expect(params(router).get('zoom')).toBe('events'))
    expect(params(router).get('focus')).toBe('e3')
  })

  it('follows focus changes made elsewhere (search typeahead) while open', async () => {
    mockTimeline()
    const { router } = renderApp('/c/ana?zoom=months')
    await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })
    await act(() => router.navigate('/c/ana?zoom=events&focus=e4'))
    const link = await screen.findByRole('link', { name: /^Duerme toda la noche/ })
    await waitFor(() => expect(link).toHaveAttribute('data-pulsing', 'true'))
    expect(link).toHaveAttribute('tabindex', '0')
    await act(() => router.navigate('/c/ana?zoom=events&focus=y2025'))
    await waitFor(() => expect(screen.getByRole('link', { name: /^Duerme toda la noche/ })).toHaveAttribute('tabindex', '0'))
  })

  it('centres a focused hub', async () => {
    mockTimeline()
    renderApp('/c/ana?zoom=years&focus=y2025')
    const hub = await screen.findByRole('button', { name: '2025 · 2 hitos' })
    expect(hub).toHaveAttribute('tabindex', '0')
  })

  it('switches levels from the zoom controls', async () => {
    mockTimeline()
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana')
    await screen.findByRole('list', { name: '5 hitos' })
    await user.click(screen.getByRole('radio', { name: 'Años' }))
    expect(await screen.findByRole('list', { name: 'Años con hitos: 2 años' })).toBeInTheDocument()
    await waitFor(() => expect(params(router).get('zoom')).toBe('years'))
    expect(screen.getByRole('button', { name: 'Alejar' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Acercar' }))
    expect(await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })).toBeInTheDocument()
  })

  it('is vertical on mobile', async () => {
    window.innerWidth = 375
    mockTimeline()
    renderApp('/c/ana')
    await screen.findByRole('list', { name: '5 hitos' })
    expect(screen.getByRole('region', { name: 'Línea de tiempo de Ana' })).toHaveAttribute('data-orientation', 'vertical')
  })

  describe('directions', () => {
    /** Physical position of each node along the line (`translate3d` of its slot). */
    function positions(links: HTMLElement[], axis: 'x' | 'y'): number[] {
      return links.map((link) => {
        const transform = (link.closest('[role="listitem"]') as HTMLElement).style.transform
        const [x, y] = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(transform)?.slice(1).map(Number) ?? [Number.NaN, Number.NaN]
        return axis === 'x' ? x : y
      })
    }
    const increasing = (values: number[]) => values.every((value, index) => index === 0 || value > values[index - 1])
    const decreasing = (values: number[]) => values.every((value, index) => index === 0 || value < values[index - 1])

    it('runs left to right on desktop when the appearance says so: the newest at the right end', async () => {
      mockTimeline({ 'GET /api/appearance': { ...APPEARANCE, direction_desktop: 'left_to_right', direction_mobile: 'top_to_bottom' } })
      const user = userEvent.setup()
      renderApp('/c/ana')
      const list = await screen.findByRole('list', { name: '5 hitos' })
      const region = screen.getByRole('region', { name: 'Línea de tiempo de Ana' })
      expect(region).toHaveAttribute('data-orientation', 'horizontal')
      expect(region).toHaveAttribute('data-newest', 'end')
      // Still newest first for assistive tech, but laid out from the oldest (left) to the newest (right).
      const links = within(list).getAllByRole('link')
      expect(titles(links)).toEqual(['Primeros pasos', 'Primera palabra', 'Primer diente', 'Duerme toda la noche', 'Primera sonrisa'])
      expect(decreasing(positions(links, 'x'))).toBe(true)
      expect(links[0]).toHaveAttribute('tabindex', '0')
      // The arrows follow the screen: ← goes to older milestones, → back to newer ones.
      act(() => links[0].focus())
      await user.keyboard('{ArrowLeft}')
      expect(links[1]).toHaveFocus()
      await user.keyboard('{ArrowLeft}{ArrowRight}{ArrowRight}')
      expect(links[0]).toHaveFocus()
    })

    it('keeps today’s layout by default: newest on the left on desktop', async () => {
      mockTimeline()
      renderApp('/c/ana')
      const list = await screen.findByRole('list', { name: '5 hitos' })
      const region = screen.getByRole('region', { name: 'Línea de tiempo de Ana' })
      expect(region).toHaveAttribute('data-newest', 'start')
      expect(increasing(positions(within(list).getAllByRole('link'), 'x'))).toBe(true)
    })

    it('runs top to bottom on phones when the appearance says so: the newest at the bottom', async () => {
      window.innerWidth = 375
      mockTimeline({ 'GET /api/appearance': { ...APPEARANCE, direction_mobile: 'top_to_bottom' } })
      const user = userEvent.setup()
      renderApp('/c/ana')
      const list = await screen.findByRole('list', { name: '5 hitos' })
      const region = screen.getByRole('region', { name: 'Línea de tiempo de Ana' })
      expect(region).toHaveAttribute('data-orientation', 'vertical')
      expect(region).toHaveAttribute('data-newest', 'end')
      const links = within(list).getAllByRole('link')
      expect(decreasing(positions(links, 'y'))).toBe(true)
      act(() => links[0].focus())
      await user.keyboard('{ArrowUp}')
      expect(links[1]).toHaveFocus()
      await user.keyboard('{ArrowDown}')
      expect(links[0]).toHaveFocus()
    })

    it('lets phones use a horizontal line and computers a vertical one', async () => {
      window.innerWidth = 375
      mockTimeline({ 'GET /api/appearance': { ...APPEARANCE, direction_desktop: 'bottom_to_top', direction_mobile: 'right_to_left' } })
      const first = renderApp('/c/ana')
      await screen.findByRole('list', { name: '5 hitos' })
      expect(screen.getByRole('region', { name: 'Línea de tiempo de Ana' })).toHaveAttribute('data-orientation', 'horizontal')
      first.unmount()

      window.innerWidth = 1280
      renderApp('/c/ana')
      const list = await screen.findByRole('list', { name: '5 hitos' })
      const region = screen.getByRole('region', { name: 'Línea de tiempo de Ana' })
      expect(region).toHaveAttribute('data-orientation', 'vertical')
      expect(region).toHaveAttribute('data-newest', 'start')
      expect(increasing(positions(within(list).getAllByRole('link'), 'y'))).toBe(true)
    })
  })

  describe('opening sweep', () => {
    const region = () => screen.getByRole('region', { name: 'Línea de tiempo de Ana' })
    const slotOf = (title: string) => screen.getByRole('link', { name: new RegExp(`^${title} · `) }).closest('[role="listitem"]')

    it('runs from the oldest milestone to the newest once per session, then rests on the newest', async () => {
      sessionStorage.removeItem('timelife.intro')
      mockTimeline()
      const first = renderApp('/c/ana')
      await screen.findByRole('list', { name: '5 hitos' })
      expect(region()).toHaveAttribute('data-sweeping')
      expect(sessionStorage.getItem('timelife.intro')).toBe('1')
      // The oldest circle lights up first, the newest one last.
      await waitFor(() => expect(slotOf('Primera sonrisa')).toHaveAttribute('data-sweep', 'lit'))
      expect(slotOf('Primeros pasos')).toHaveAttribute('data-sweep', 'waiting')
      await waitFor(() => expect(region()).not.toHaveAttribute('data-sweeping'), { timeout: 6000 })
      const newest = screen.getByRole('link', { name: /^Primeros pasos · / })
      expect(newest).toHaveAttribute('tabindex', '0')
      expect(newest).toHaveAttribute('data-pulsing', 'true')
      first.unmount()

      // Not again in this session.
      renderApp('/c/ana')
      await screen.findByRole('list', { name: '5 hitos' })
      expect(region()).not.toHaveAttribute('data-sweeping')
    })

    it('stops at the first interaction and shows every milestone at once', async () => {
      sessionStorage.removeItem('timelife.intro')
      mockTimeline()
      const { container } = renderApp('/c/ana')
      await screen.findByRole('list', { name: '5 hitos' })
      expect(region()).toHaveAttribute('data-sweeping')
      fireEvent.pointerDown(container.querySelector('.viewport') as HTMLElement)
      expect(region()).not.toHaveAttribute('data-sweeping')
      await waitFor(() => expect(slotOf('Primeros pasos')).toHaveAttribute('data-sweep', 'lit'))
    })

    it('is skipped when the address points at a milestone (and not kept for later)', async () => {
      sessionStorage.removeItem('timelife.intro')
      mockTimeline()
      renderApp('/c/ana?focus=e3')
      await screen.findByRole('link', { name: /^Primer diente/ })
      expect(region()).not.toHaveAttribute('data-sweeping')
      expect(sessionStorage.getItem('timelife.intro')).toBe('1')
    })
  })

  it('moves the zoom control out of the way of the desktop filter panel', async () => {
    mockTimeline()
    const user = userEvent.setup()
    renderApp('/c/ana')
    await screen.findByRole('list', { name: '5 hitos' })
    const controls = screen.getByRole('group', { name: 'Zoom de la línea de tiempo' })
    expect(controls.style.getPropertyValue('--controls-inset')).toBe('0px')
    await user.click(screen.getByRole('button', { name: 'Filtros' }))
    await waitFor(() => expect(controls.style.getPropertyValue('--controls-inset')).toBe('384px'))
  })

  it('keeps the router state (detail originRect) when it writes zoom / focus', async () => {
    mockTimeline({
      'GET /api/events/4': {
        ...EVENTS[3],
        notes: '',
        location: null,
        images: [],
        cover_image_id: null,
        version: 1,
        updated_at: EVENTS[3].created_at,
        deleted_at: null,
      },
    })
    const { router } = renderApp('/c/ana?zoom=months')
    await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })
    const state = { originRect: { x: 10, y: 20, width: 104, height: 104 } }
    // A searched event opened from a link that still says zoom=years: the timeline switches to days.
    await act(() => router.navigate('/c/ana/e/4?zoom=years&focus=e4', { state }))
    await waitFor(() => expect(params(router).get('zoom')).toBe('events'))
    expect(router.state.location.pathname).toBe('/c/ana/e/4')
    expect(params(router).get('focus')).toBe('e4')
    expect(router.state.location.state).toEqual(state)
  })

  it('invites admins to add the first milestone (in a modal over the timeline)', async () => {
    mockTimeline({ 'GET /api/children/1/timeline': { child_id: 1, total: 0, events: [] } })
    renderApp('/c/ana')
    expect(await screen.findByRole('heading', { name: 'Todavía no hay hitos de Ana' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Añadir el primer hito' })).toHaveAttribute('href', '/c/ana/new')
    // The empty state already has its own button.
    expect(screen.queryByRole('link', { name: 'Nuevo hito' })).not.toBeInTheDocument()
  })

  it('offers administrators a button that opens the editor over the timeline', async () => {
    mockTimeline()
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?zoom=months')
    await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })
    const create = screen.getByRole('link', { name: 'Nuevo hito' })
    expect(create).toHaveAttribute('href', '/c/ana/new?zoom=months')

    await user.click(create)
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana/new'))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo hito' })
    expect(await within(dialog).findByRole('heading', { name: 'Nuevo evento' })).toBeInTheDocument()
    // The timeline's child is already chosen.
    expect(within(dialog).getByRole('button', { name: 'Ana' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: 'Leo' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana'))
    expect(params(router).get('zoom')).toBe('months')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('creates the milestone and shows it on the timeline', async () => {
    let events = EVENTS
    const posted: EventIn[] = []
    mockTimeline({
      'GET /api/children/1/timeline': () => ({ child_id: 1, total: events.length, events }),
      'POST /api/admin/events': ({ body }: { body: EventIn }) => {
        posted.push(body)
        events = [event(9, body.title, body.date, body.category_ids), ...EVENTS]
        return reply(201, eventOut({ id: 9, title: body.title, date: body.date, child_ids: body.child_ids, category_ids: body.category_ids, images: [], cover_image_id: null }))
      },
    })
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?zoom=years')
    await screen.findByRole('list', { name: 'Años con hitos: 2 años' })
    await user.click(screen.getByRole('link', { name: 'Nuevo hito' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo hito' })
    await user.type(await within(dialog).findByRole('textbox', { name: /Título/ }), 'Primera excursión')
    await user.click(within(dialog).getByRole('button', { name: 'Añadir General' }))
    await user.click(within(dialog).getByRole('button', { name: 'Crear evento' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana'))
    expect(posted).toEqual([expect.objectContaining({ title: 'Primera excursión', child_ids: [1], category_ids: [1], date: todayISO() })])
    // The days level, focused on the new milestone.
    expect(params(router).get('zoom')).toBe('events')
    expect(params(router).get('focus')).toBe('e9')
    const list = await screen.findByRole('list', { name: '6 hitos' })
    expect(within(list).getByRole('link', { name: /^Primera excursión · / })).toBeInTheDocument()
    expect(screen.getByText('«Primera excursión» se ha creado.')).toBeInTheDocument()
  })

  it('closes the editor as soon as the milestone exists and moves to it once the timeline has it', async () => {
    let created = false
    let release = () => {}
    const reloaded = new Promise<void>((resolve) => {
      release = resolve
    })
    const posted: EventIn[] = []
    mockTimeline({
      // After the creation, the timeline answers only when the test lets it.
      'GET /api/children/1/timeline': async () => {
        if (!created) return TIMELINE
        await reloaded
        return { child_id: 1, total: EVENTS.length + 1, events: [event(9, 'Primera excursión', todayISO(), [1]), ...EVENTS] }
      },
      'POST /api/admin/events': ({ body }: { body: EventIn }) => {
        posted.push(body)
        created = true
        return reply(201, eventOut({ id: 9, title: body.title, date: body.date, child_ids: body.child_ids, category_ids: body.category_ids, images: [], cover_image_id: null }))
      },
    })
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?zoom=months')
    await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })
    await user.click(screen.getByRole('link', { name: 'Nuevo hito' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo hito' })
    await user.type(await within(dialog).findByRole('textbox', { name: /Título/ }), 'Primera excursión')
    await user.click(within(dialog).getByRole('button', { name: 'Añadir General' }))
    await user.click(within(dialog).getByRole('button', { name: 'Crear evento' }))

    // Nothing left to press twice while the timeline reloads…
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuevo hito' })).not.toBeInTheDocument())
    await act(() => new Promise((resolve) => setTimeout(resolve, MODAL_EXIT_DELAY_MS + 50)))
    expect(router.state.location.pathname).toBe('/c/ana/new')
    expect(posted).toHaveLength(1)

    // …then the days level, on the new milestone.
    release()
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana'))
    expect(params(router).get('zoom')).toBe('events')
    expect(params(router).get('focus')).toBe('e9')
    expect(await screen.findByRole('link', { name: /^Primera excursión · / })).toBeInTheDocument()
  })

  it('keeps viewers out of the new milestone editor', async () => {
    mockTimeline({}, VIEWER_SESSION)
    const { router } = renderApp('/c/ana/new?zoom=months')
    await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana'))
    expect(params(router).get('zoom')).toBe('months')
    expect(screen.queryByRole('link', { name: 'Nuevo hito' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('tells viewers that milestones will appear', async () => {
    mockTimeline({ 'GET /api/children/1/timeline': { child_id: 1, total: 0, events: [] } }, VIEWER_SESSION)
    renderApp('/c/ana')
    expect(await screen.findByText('Cuando se añadan hitos, aparecerán aquí.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Añadir el primer hito' })).not.toBeInTheDocument()
  })

  it('offers to clear the filters when nothing matches', async () => {
    mockTimeline({
      'GET /api/children/1/timeline': ({ url }: { url: URL }) =>
        url.searchParams.get('q') ? { child_id: 1, total: EVENTS.length, events: [] } : TIMELINE,
    })
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?q=zzz&zoom=months')
    expect(await screen.findByRole('heading', { name: 'Ningún hito coincide con la búsqueda' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    await waitFor(() => expect(params(router).has('q')).toBe(false))
    expect(params(router).get('zoom')).toBe('months')
    expect(await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })).toBeInTheDocument()
  })

  it('shows an error with a retry button', async () => {
    let fail = true
    mockTimeline({
      'GET /api/children/1/timeline': () => (fail ? reply(500, { code: 'internal_error' }) : TIMELINE),
    })
    const user = userEvent.setup()
    renderApp('/c/ana')
    expect(await screen.findByRole('heading', { name: 'No se ha podido cargar la línea de tiempo' })).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('list', { name: '5 hitos' })).toBeInTheDocument()
  })
})

describe('TimelinePage: all together', () => {
  // Ana (1) and Leo (2): a milestone of both, one of Leo's and Ana's own ones.
  const FAMILY_EVENTS = [
    { ...event(7, 'Juegan juntos', '2026-03-20', [6]), child_ids: [1, 2] },
    { ...event(6, 'Leo gatea', '2026-03-15', [6]), child_ids: [2] },
    ...EVENTS,
  ]
  const FAMILY: TimelineOut = { child_id: null, total: FAMILY_EVENTS.length, events: FAMILY_EVENTS }
  const region = () => screen.getByRole('region', { name: 'Línea de tiempo de todos juntos' })

  function mockFamily(extra: Record<string, MockHandler> = {}, session = ADMIN_SESSION) {
    return mockTimeline({ 'GET /api/timeline': FAMILY, ...extra }, session)
  }

  /** `[x, y]` of the node's slot. */
  function slotPosition(link: HTMLElement): [number, number] {
    const transform = (link.closest('[role="listitem"]') as HTMLElement).style.transform
    const [x, y] = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(transform)?.slice(1).map(Number) ?? [Number.NaN, Number.NaN]
    return [x, y]
  }

  it('draws every child on their own line, merging at the milestones they share', async () => {
    mockFamily()
    const { container } = renderApp('/all')
    const list = await screen.findByRole('list', { name: '7 hitos' })
    expect(screen.getByRole('heading', { level: 1, name: 'Todos juntos' })).toBeInTheDocument()
    expect(document.title).toContain('Todos juntos')
    expect(region()).toHaveAttribute('data-orientation', 'horizontal')
    const links = within(list).getAllByRole('link')
    expect(titles(links.slice(0, 4))).toEqual(['Juegan juntos', 'Leo gatea', 'Primeros pasos', 'Primera palabra'])
    // Whose milestone each one is, for assistive tech.
    expect(links[0]).toHaveAccessibleName(/^Juegan juntos · .* · Ana y Leo$/)
    expect(links[1]).toHaveAccessibleName(/^Leo gatea · .* · Leo$/)
    expect(links[2]).toHaveAccessibleName(/^Primeros pasos · .* · Ana$/)
    // Ana's lane above the axis, Leo's below, shared milestones on it.
    const [shared, leo, ana] = links.slice(0, 3).map((link) => slotPosition(link)[1])
    expect(shared).toBe(0)
    expect(ana).toBeLessThan(0)
    expect(leo).toBe(-ana)
    const lines = container.querySelectorAll('path[data-lane]')
    expect([...lines].map((line) => line.getAttribute('data-lane'))).toEqual(['1', '2'])
    expect(container.querySelector('[data-lanes]')).toHaveTextContent('AL')
  })

  it('keeps a single line with everyone’s hubs at the months and years levels', async () => {
    mockFamily()
    const user = userEvent.setup()
    const { container } = renderApp('/all?zoom=months')
    const list = await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })
    expect(within(list).getByRole('button', { name: 'marzo de 2026 · 4 hitos' })).toBeInTheDocument()
    expect(container.querySelector('path[data-lane]')).toBeNull()
    await user.click(within(list).getByRole('button', { name: 'marzo de 2026 · 4 hitos' }))
    await screen.findByRole('list', { name: '7 hitos' })
    await waitFor(() => expect(container.querySelectorAll('path[data-lane]')).toHaveLength(2))
  })

  it('puts the lanes side by side on phones', async () => {
    window.innerWidth = 375
    mockFamily()
    renderApp('/all')
    const list = await screen.findByRole('list', { name: '7 hitos' })
    expect(region()).toHaveAttribute('data-orientation', 'vertical')
    const [shared, leo, ana] = within(list).getAllByRole('link').slice(0, 3).map((link) => slotPosition(link)[0])
    expect(shared).toBe(0)
    expect(ana).toBeLessThan(0)
    expect(leo).toBe(-ana)
  })

  it('opens a milestone over the family timeline, says whose it is and goes back there', async () => {
    mockFamily({ 'GET /api/events/6': eventOut({ id: 6, title: 'Leo gatea', date: '2026-03-15', child_ids: [2], images: [], cover_image_id: null }) })
    const user = userEvent.setup()
    const { router } = renderApp('/all?zoom=events')
    await user.click(await screen.findByRole('link', { name: /^Leo gatea · / }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/all/e/6'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('heading', { name: 'Leo gatea' })).toBeInTheDocument()
    const children = within(dialog).getByRole('list', { name: 'Niños de este hito' })
    expect(within(children).getByRole('img', { name: 'Leo' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/all'))
    expect(params(router).get('zoom')).toBe('events')
  })

  it('creates milestones from the family timeline without choosing a child for them', async () => {
    let events = FAMILY_EVENTS
    mockFamily({
      'GET /api/timeline': () => ({ child_id: null, total: events.length, events }),
      'POST /api/admin/events': ({ body }: { body: EventIn }) => {
        events = [{ ...event(9, body.title, body.date, body.category_ids), child_ids: body.child_ids }, ...FAMILY_EVENTS]
        return reply(201, eventOut({ id: 9, title: body.title, date: body.date, child_ids: body.child_ids, category_ids: body.category_ids, images: [], cover_image_id: null }))
      },
    })
    const user = userEvent.setup()
    const { router } = renderApp('/all?zoom=months')
    await screen.findByRole('list', { name: 'Meses con hitos: 4 meses' })
    const create = screen.getByRole('link', { name: 'Nuevo hito' })
    expect(create).toHaveAttribute('href', '/all/new?zoom=months')
    await user.click(create)
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo hito' })
    await user.type(await within(dialog).findByRole('textbox', { name: /Título/ }), 'Primera excursión')
    expect(within(dialog).getByRole('button', { name: 'Ana' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(dialog).getByRole('button', { name: 'Leo' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(dialog).getByRole('button', { name: 'Leo' }))
    await user.click(within(dialog).getByRole('button', { name: 'Añadir General' }))
    await user.click(within(dialog).getByRole('button', { name: 'Crear evento' }))

    // Back on the family timeline, on the new milestone.
    await waitFor(() => expect(router.state.location.pathname).toBe('/all'))
    expect(params(router).get('zoom')).toBe('events')
    expect(params(router).get('focus')).toBe('e9')
    expect(await screen.findByRole('link', { name: /^Primera excursión · .* · Leo$/ })).toBeInTheDocument()
  })

  it('invites admins to add the first milestone when nobody has any yet', async () => {
    mockFamily({ 'GET /api/timeline': { child_id: null, total: 0, events: [] } })
    renderApp('/all')
    expect(await screen.findByRole('heading', { name: 'Todavía no hay hitos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Añadir el primer hito' })).toHaveAttribute('href', '/all/new')
  })

  it('sweeps along every lane on the first visit of the session', async () => {
    sessionStorage.removeItem('timelife.intro')
    mockFamily()
    const { container } = renderApp('/all')
    await screen.findByRole('list', { name: '7 hitos' })
    expect(region()).toHaveAttribute('data-sweeping')
    expect(container.querySelectorAll('[data-front][data-lane]')).toHaveLength(2)
    fireEvent.pointerDown(container.querySelector('.viewport') as HTMLElement)
    expect(region()).not.toHaveAttribute('data-sweeping')
    expect(container.querySelector('[data-front]')).toBeNull()
  })
})
