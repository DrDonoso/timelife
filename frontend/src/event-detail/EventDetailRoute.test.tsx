import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Outlet, RouterProvider, createMemoryRouter, type RouteObject } from 'react-router'
import { AppProviders } from '../App'
import type { EventOut, ImageOut } from '../api/schema.gen'
import type { EventEditorProps } from '../admin/events/EventEditor'
import { RootLayout } from '../shell/RootLayout'
import {
  ADMIN_SESSION,
  VIEWER_SESSION,
  createTestQueryClient,
  fireTouch,
  mockSignedIn,
  reply,
  type MockHandler,
} from '../utils/test-utils'
import { EventDetailRoute } from './EventDetailRoute'

// Shared with the hoisted editor mock: what the "server" returns after the mock editor saves.
const server = vi.hoisted(() => ({ saved: null as EventOut | null }))

vi.mock('../admin/events/EventEditor', () => ({
  EventEditor: ({ eventId, variant, onSaved, onCancel, onDirtyChange }: EventEditorProps) => (
    <div>
      <p>
        Editor de {eventId} ({variant})
      </p>
      <button type="button" onClick={() => onDirtyChange?.(true)}>
        Cambiar el título (mock)
      </button>
      <button type="button" onClick={() => server.saved && onSaved(server.saved)}>
        Guardar (mock)
      </button>
      <button type="button" onClick={onCancel}>
        Cancelar (mock)
      </button>
    </div>
  ),
}))

function image(id: string, name: string, width = 1600, height = 1000): ImageOut {
  return {
    id,
    name,
    kind: 'image',
    width,
    height,
    dominant_color: '#7c6a5a',
    crop: null,
    thumb_url: `/api/media/${id}/thumb`,
    display_url: `/api/media/${id}/display`,
    video_status: null,
    video_url: null,
    duration: null,
    live: false,
  }
}

const EVENT: EventOut = {
  id: 5,
  title: 'Primeros pasos',
  date: '2026-03-12',
  notes: 'Se soltó del sofá\ny cruzó el salón riéndose.',
  location: 'Casa de los abuelos',
  child_ids: [1],
  category_ids: [3, 1],
  images: [image('i1', 'Columpio'), image('i2', 'Primer paso', 1000, 1500), image('i3', 'Merienda', 1200, 1200)],
  cover_image_id: 'i2',
  version: 1,
  created_at: '2026-03-12T10:00:00Z',
  updated_at: '2026-03-12T10:00:00Z',
  deleted_at: null,
}

type Entry = string | { pathname: string; search?: string; state?: unknown }

function TimelineStub() {
  return (
    <>
      <h1>Línea de tiempo</h1>
      <Outlet />
    </>
  )
}

function renderDetail(entries: Entry[], { initialIndex }: { initialIndex?: number } = {}) {
  const queryClient = createTestQueryClient()
  const routes: RouteObject[] = [
    {
      element: <RootLayout />,
      children: [
        {
          path: 'c/:childSlug',
          element: <TimelineStub />,
          children: [{ path: 'e/:eventId', element: <EventDetailRoute /> }],
        },
      ],
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: entries, initialIndex })
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...view, router, queryClient }
}

function signIn(session = VIEWER_SESSION, event: MockHandler = EVENT, extra: Record<string, MockHandler> = {}) {
  return mockSignedIn(session, { 'GET /api/events/5': event, ...extra })
}

const where = (router: ReturnType<typeof renderDetail>['router']) =>
  `${router.state.location.pathname}${router.state.location.search}`

const eventCalls = (fetchMock: ReturnType<typeof mockSignedIn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/events/')).length

/** A finger pulling `target` 340 px down and letting go. */
function pullDown(target: Element) {
  fireTouch(target, 'touchstart', [[180, 300]])
  fireTouch(target, 'touchmove', [[180, 340]])
  fireTouch(target, 'touchmove', [[180, 640]])
  fireTouch(target, 'touchend', [], { changed: [[180, 640]] })
}

afterEach(() => {
  server.saved = null
  window.innerWidth = 1024
})

describe('EventDetailRoute: card', () => {
  it('opens a dialog named after the event with its date, place, title and notes', async () => {
    signIn()
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Primeros pasos' })).toBeInTheDocument()
    const time = within(dialog).getByText('12 de marzo de 2026')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', '2026-03-12')
    expect(within(dialog).getByText('Casa de los abuelos')).toBeInTheDocument()
    const notes = within(dialog).getByText(/Se soltó del sofá/)
    expect(notes.textContent).toBe('Se soltó del sofá\ny cruzó el salón riéndose.')
    expect(notes).toHaveClass('notes')
    await waitFor(() => expect(document.title).toBe('Primeros pasos · Ana · Timelife'))
  })

  it('shows the cover first, then the other photos in their saved order, named by alt only', async () => {
    signIn()
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    const strip = within(dialog).getByRole('region', { name: 'Fotos de «Primeros pasos»' })
    const images = Array.from(strip.querySelectorAll('img'))
    expect(images.map((img) => img.alt)).toEqual(['Primer paso', 'Columpio', 'Merienda'])
    for (const img of dialog.querySelectorAll('img')) {
      expect(img.getAttribute('alt')).toBeTruthy()
      expect(img).not.toHaveAttribute('title')
    }
    expect(dialog.querySelector('.counter')).toHaveTextContent('1 / 3')
    // The card has no outline (the shadow lifts it).
    expect(dialog.closest('.modal')).toHaveClass('borderless')
  })

  it('moves between photos with ←/→ while the dialog has focus', async () => {
    signIn()
    const user = userEvent.setup()
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await waitFor(() => expect(dialog).toHaveFocus())
    await user.keyboard('{ArrowRight}')
    expect(dialog.querySelector('.counter')).toHaveTextContent('2 / 3')
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(dialog.querySelector('.counter')).toHaveTextContent('3 / 3')
    await user.keyboard('{ArrowLeft}')
    expect(dialog.querySelector('.counter')).toHaveTextContent('2 / 3')
    expect(within(dialog).getByRole('button', { name: 'Ver la foto 2 de 3' })).toHaveAttribute('aria-current', 'true')
  })

  it('shows one category pill per category, in the event order, expanding on hover and focus', async () => {
    signIn()
    const user = userEvent.setup()
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    const list = await within(dialog).findByRole('list', { name: 'Categorías' })
    const pills = within(list).getAllByRole('button')
    expect(pills.map((pill) => pill.getAttribute('aria-label'))).toEqual(['Alimentación', 'Lenguaje y comunicación'])
    const state = (pill: HTMLElement) => pill.querySelector('[data-expanded]')?.getAttribute('data-expanded')
    expect(state(pills[0])).toBe('false')
    await user.hover(pills[0])
    expect(state(pills[0])).toBe('true')
    await user.unhover(pills[0])
    expect(state(pills[0])).toBe('false')
    act(() => pills[1].focus())
    await user.keyboard('{Shift>}{Tab}{/Shift}{Tab}')
    expect(pills[1]).toHaveFocus()
    expect(state(pills[1])).toBe('true')
  })

  it('shows a colour header with the primary category icon when there are no photos', async () => {
    signIn(VIEWER_SESSION, { ...EVENT, images: [], cover_image_id: null })
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    const header = dialog.querySelector<HTMLElement>('.fallback')
    expect(header).not.toBeNull()
    expect(header).toHaveAttribute('aria-hidden', 'true')
    expect(header?.querySelector('svg')).not.toBeNull()
    // Primary category = Alimentación (#22c55e), deepened until a white icon reaches 3:1.
    await waitFor(() => expect(header?.style.getPropertyValue('--fallback-base')).not.toBe('#94877c'))
    expect(dialog.querySelector('img')).toBeNull()
    expect(within(dialog).queryByRole('region', { name: /Fotos/ })).not.toBeInTheDocument()
  })

  it('omits notes and location when empty', async () => {
    signIn(VIEWER_SESSION, { ...EVENT, notes: '  \n ', location: null })
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    expect(dialog.querySelector('.notes')).toBeNull()
    expect(dialog.querySelector('.location')).toBeNull()
  })

  it('shows the avatars of the children only when the event is shared', async () => {
    signIn(VIEWER_SESSION, { ...EVENT, child_ids: [1, 2] })
    const user = userEvent.setup()
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    const list = await within(dialog).findByRole('list', { name: 'Niños de este hito' })
    const avatars = within(list).getAllByRole('img')
    expect(avatars.map((avatar) => avatar.getAttribute('aria-label'))).toEqual(['Ana', 'Leo'])
    // Tooltips are portalled outside the modal (hidden from the a11y tree there; the name is on the avatar).
    const tooltip = () => screen.queryByRole('tooltip', { hidden: true })
    await user.click(dialog) // pointer modality, as after clicking the timeline
    await user.hover(avatars[1])
    await waitFor(() => expect(tooltip()).toHaveTextContent('Leo'))
    await user.unhover(avatars[1])
    await waitFor(() => expect(tooltip()).not.toBeInTheDocument())
    act(() => avatars[0].focus())
    await user.keyboard('{Shift>}{Tab}{/Shift}{Tab}')
    expect(avatars[0]).toHaveFocus()
    await waitFor(() => expect(tooltip()).toHaveTextContent('Ana'))
  })

  it('does not show avatars for an event of a single child', async () => {
    signIn()
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await within(dialog).findByRole('list', { name: 'Categorías' })
    expect(within(dialog).queryByRole('list', { name: 'Niños de este hito' })).not.toBeInTheDocument()
  })

  it('goes full screen on mobile', async () => {
    window.innerWidth = 375
    signIn()
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    expect(dialog.parentElement).toHaveClass('fullScreen')
  })

  it('stays a centred card on desktop', async () => {
    signIn()
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    expect(dialog.parentElement).toHaveClass('xl')
    expect(dialog.parentElement).not.toHaveClass('fullScreen')
  })
})

describe('EventDetailRoute: full-screen photos', () => {
  const VIEWER = 'Fotos de «Primeros pasos» a pantalla completa'
  const counterOf = (element: HTMLElement) => element.querySelector('.counter')?.textContent

  it('opens the tapped photo full screen on phones and swipes through the others', async () => {
    window.innerWidth = 375
    signIn()
    const user = userEvent.setup()
    const { router } = renderDetail(['/c/ana/e/5?zoom=events'])
    const card = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(within(card).getByRole('img', { name: 'Primer paso' }))

    const viewer = await screen.findByRole('dialog', { name: VIEWER })
    expect(counterOf(viewer)).toBe('1 / 3')
    expect(within(viewer).getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual(['Primer paso', 'Columpio', 'Merienda'])
    // Its own history entry (same URL), so the phone's Back button leaves full screen first.
    expect(where(router)).toBe('/c/ana/e/5?zoom=events')
    expect(router.state.location.state).toEqual({ photo: 0 })

    await user.keyboard('{ArrowRight}')
    expect(counterOf(viewer)).toBe('2 / 3')
    await user.click(within(viewer).getByRole('button', { name: 'Salir de la pantalla completa' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: VIEWER })).not.toBeInTheDocument())
    // Back on the card, at the photo seen last.
    const again = screen.getByRole('dialog', { name: 'Primeros pasos' })
    await waitFor(() => expect(counterOf(again)).toBe('2 / 3'))
    expect(router.state.location.state).toBeNull()
  })

  it('leaves full screen (not the card) with the Back button', async () => {
    window.innerWidth = 375
    signIn()
    const user = userEvent.setup()
    const { router } = renderDetail(['/c/ana?zoom=events', '/c/ana/e/5?zoom=events'], { initialIndex: 1 })
    const card = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(within(card).getByRole('button', { name: 'Ver la foto a pantalla completa' }))
    const viewer = await screen.findByRole('dialog', { name: VIEWER })
    await user.click(within(viewer).getByRole('button', { name: 'Ver la foto 3 de 3' }))
    expect(counterOf(viewer)).toBe('3 / 3')

    await act(() => router.navigate(-1))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: VIEWER })).not.toBeInTheDocument())
    expect(where(router)).toBe('/c/ana/e/5?zoom=events')
    const again = screen.getByRole('dialog', { name: 'Primeros pasos' })
    await waitFor(() => expect(counterOf(again)).toBe('3 / 3'))
  })

  it('closes with Escape', async () => {
    window.innerWidth = 375
    signIn()
    const user = userEvent.setup()
    renderDetail(['/c/ana/e/5'])
    const card = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(within(card).getByRole('img', { name: 'Columpio' }))
    await screen.findByRole('dialog', { name: VIEWER })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: VIEWER })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Primeros pasos' })).toBeInTheDocument()
  })

  it('leaves full screen when the photo is swiped down, like ✕, with the card following underneath', async () => {
    window.innerWidth = 375
    signIn()
    const user = userEvent.setup()
    const { router } = renderDetail(['/c/ana/e/5?zoom=events'])
    const card = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(within(card).getByRole('img', { name: 'Primer paso' }))
    const viewer = await screen.findByRole('dialog', { name: VIEWER })
    await user.keyboard('{ArrowRight}')
    expect(counterOf(viewer)).toBe('2 / 3')
    // Already on the card too: it shows through while the photo is swiped down.
    expect(counterOf(card)).toBe('2 / 3')

    const photo = within(viewer).getByRole('img', { name: 'Columpio' })
    pullDown(photo)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: VIEWER })).not.toBeInTheDocument())
    expect(where(router)).toBe('/c/ana/e/5?zoom=events')
    expect(router.state.location.state).toBeNull()
    expect(counterOf(screen.getByRole('dialog', { name: 'Primeros pasos' }))).toBe('2 / 3')
  })

  it('moves a Live Photo once, full screen only, although the card follows underneath', async () => {
    window.innerWidth = 375
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    const live: ImageOut = { ...image('i1', 'Columpio'), video_status: 'ready', video_url: '/api/media/i1/video', duration: 2, live: true }
    signIn(VIEWER_SESSION, { ...EVENT, images: [live, ...EVENT.images.slice(1)] })
    const user = userEvent.setup()
    renderDetail(['/c/ana/e/5'])
    const card = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(within(card).getByRole('img', { name: 'Primer paso' }))
    const viewer = await screen.findByRole('dialog', { name: VIEWER })
    await user.keyboard('{ArrowRight}')
    expect(counterOf(card)).toBe('2 / 3')
    expect(play).toHaveBeenCalledTimes(1)
    expect(viewer.contains(play.mock.contexts[0] as Node)).toBe(true)

    // Nor again on the card once back: it was just seen full screen.
    await user.click(within(viewer).getByRole('button', { name: 'Salir de la pantalla completa' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: VIEWER })).not.toBeInTheDocument())
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('is a phone feature: desktop photos stay in the card', async () => {
    signIn()
    const user = userEvent.setup()
    renderDetail(['/c/ana/e/5'])
    const card = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    expect(within(card).queryByRole('button', { name: 'Ver la foto a pantalla completa' })).not.toBeInTheDocument()
    await user.click(within(card).getByRole('img', { name: 'Primer paso' }))
    expect(screen.queryByRole('dialog', { name: VIEWER })).not.toBeInTheDocument()
  })
})

describe('EventDetailRoute: closing', () => {
  it('returns to the timeline keeping the search params', async () => {
    signIn()
    const user = userEvent.setup()
    const { router } = renderDetail(['/c/ana/e/5?zoom=events&q=pasos&cat=1,3&focus=e5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(where(router)).toBe('/c/ana?zoom=events&q=pasos&cat=1,3&focus=e5'))
    // A deep link is replaced: going back afterwards does not reopen the card.
    expect(router.state.historyAction).toBe('REPLACE')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.title).not.toContain('Primeros pasos')
  })

  it('closes with Escape', async () => {
    signIn()
    const user = userEvent.setup()
    const { router } = renderDetail(['/c/ana/e/5?zoom=months'])
    await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(where(router)).toBe('/c/ana?zoom=months'))
  })

  it('closes with the browser Back button', async () => {
    signIn()
    const { router } = renderDetail(['/c/ana?zoom=events', '/c/ana/e/5?zoom=events'], { initialIndex: 1 })
    await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await act(() => router.navigate(-1))
    expect(where(router)).toBe('/c/ana?zoom=events')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Línea de tiempo' })).toBeInTheDocument()
  })

  it('accepts the origin rect sent by the timeline', async () => {
    signIn()
    const user = userEvent.setup()
    const { router } = renderDetail([
      { pathname: '/c/ana/e/5', search: '?zoom=events', state: { originRect: { x: 40, y: 300, width: 104, height: 104 } } },
    ])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(where(router)).toBe('/c/ana?zoom=events'))
  })

  it('closes on phones when the card is pulled down from its top, like ✕', async () => {
    window.innerWidth = 375
    signIn()
    const { router } = renderDetail(['/c/ana/e/5?zoom=events&q=pasos'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    // On the photo or on the text alike.
    pullDown(within(dialog).getByRole('heading', { name: 'Primeros pasos' }))
    await waitFor(() => expect(where(router)).toBe('/c/ana?zoom=events&q=pasos'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('still follows a pull on the loading card when the milestone arrives meanwhile', async () => {
    window.innerWidth = 375
    let arrive: (event: EventOut) => void = () => {}
    signIn(VIEWER_SESSION, () => new Promise<EventOut>((resolve) => (arrive = resolve)))
    const { router } = renderDetail(['/c/ana/e/5?zoom=events'])
    const loading = await screen.findByRole('dialog', { name: 'Cargando el hito…' })
    const placeholder = loading.querySelector('[aria-busy="true"] > .media') as HTMLElement
    const overlay = loading.closest<HTMLElement>('.overlay') as HTMLElement
    fireTouch(placeholder, 'touchstart', [[180, 300]])
    fireTouch(placeholder, 'touchmove', [[180, 340]])
    expect(overlay).toHaveAttribute('data-swipe', 'drag')

    // The card replaces the placeholder under the finger, whose events keep going to it.
    await act(async () => arrive(EVENT))
    await screen.findByRole('dialog', { name: 'Primeros pasos' })
    expect(placeholder.isConnected).toBe(false)
    fireTouch(placeholder, 'touchmove', [[180, 640]])
    expect(overlay.style.getPropertyValue('--swipe-y')).toBe('300px')
    fireTouch(placeholder, 'touchend', [], { changed: [[180, 640]] })
    await waitFor(() => expect(where(router)).toBe('/c/ana?zoom=events'))
  })
})

describe('EventDetailRoute: loading and errors', () => {
  it('shows a skeleton while the event loads', async () => {
    signIn(VIEWER_SESSION, () => new Promise(() => {}))
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Cargando el hito…' })
    expect(dialog.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()
  })

  it('explains a missing event and goes back to the timeline', async () => {
    signIn(VIEWER_SESSION, reply(404, { code: 'event_not_found' }))
    const user = userEvent.setup()
    const { router } = renderDetail(['/c/ana/e/5?q=pasos'])
    const dialog = await screen.findByRole('dialog', { name: 'Detalle del hito' })
    expect(await within(dialog).findByRole('heading', { name: 'No encontramos este hito' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Volver a la línea de tiempo' }))
    await waitFor(() => expect(where(router)).toBe('/c/ana?q=pasos'))
  })

  it('treats malformed ids as not found without calling the API', async () => {
    const fetchMock = signIn()
    renderDetail(['/c/ana/e/abc'])
    const dialog = await screen.findByRole('dialog', { name: 'Detalle del hito' })
    expect(within(dialog).getByRole('heading', { name: 'No encontramos este hito' })).toBeInTheDocument()
    expect(eventCalls(fetchMock)).toBe(0)
  })

  it('offers a retry after a network error', async () => {
    let online = false
    signIn(VIEWER_SESSION, () => (online ? EVENT : Promise.reject(new TypeError('Failed to fetch'))))
    const user = userEvent.setup()
    renderDetail(['/c/ana/e/5'])
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se ha podido cargar el hito')
    expect(alert).toHaveTextContent('No hay conexión con el servidor')
    online = true
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('dialog', { name: 'Primeros pasos' })).toBeInTheDocument()
  })
})

describe('EventDetailRoute: editing', () => {
  it('only shows the edit button to admins', async () => {
    signIn(VIEWER_SESSION)
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await within(dialog).findByRole('list', { name: 'Categorías' })
    expect(within(dialog).queryByRole('button', { name: 'Editar hito' })).not.toBeInTheDocument()
  })

  it('switches to the editor in place and back to the card on cancel', async () => {
    signIn(ADMIN_SESSION)
    const user = userEvent.setup()
    const { router } = renderDetail(['/c/ana/e/5?zoom=events'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(await within(dialog).findByRole('button', { name: 'Editar hito' }))
    expect(await within(dialog).findByText('Editor de 5 (modal)')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Editando «Primeros pasos»' })).toBe(dialog)
    expect(dialog.parentElement).toHaveClass('editing')
    expect(within(dialog).queryByRole('region', { name: /Fotos/ })).not.toBeInTheDocument()
    // Escape must not throw the edits away.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(where(router)).toBe('/c/ana/e/5?zoom=events')

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar (mock)' }))
    const edit = await within(dialog).findByRole('button', { name: 'Editar hito' })
    expect(within(dialog).getByRole('heading', { name: 'Primeros pasos' })).toBeInTheDocument()
    expect(dialog.parentElement).not.toHaveClass('editing')
    await waitFor(() => expect(edit).toHaveFocus())
  })

  it('cannot be pulled down to close on phones while editing', async () => {
    window.innerWidth = 375
    signIn(ADMIN_SESSION)
    const user = userEvent.setup()
    const { router } = renderDetail(['/c/ana/e/5?zoom=events'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(await within(dialog).findByRole('button', { name: 'Editar hito' }))
    const editor = await within(dialog).findByText('Editor de 5 (modal)')
    pullDown(editor)
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(where(router)).toBe('/c/ana/e/5?zoom=events')
  })

  it('leaves with the browser Back button right away when nothing has changed', async () => {
    signIn(ADMIN_SESSION)
    const user = userEvent.setup()
    const { router } = renderDetail(['/c/ana?zoom=events', '/c/ana/e/5?zoom=events'], { initialIndex: 1 })
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(await within(dialog).findByRole('button', { name: 'Editar hito' }))
    await within(dialog).findByText('Editor de 5 (modal)')

    await act(() => router.navigate(-1))
    expect(where(router)).toBe('/c/ana?zoom=events')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('asks before the browser Back button throws the edits away', async () => {
    signIn(ADMIN_SESSION)
    const user = userEvent.setup()
    const { router } = renderDetail(['/c/ana?zoom=events', '/c/ana/e/5?zoom=events'], { initialIndex: 1 })
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(await within(dialog).findByRole('button', { name: 'Editar hito' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Cambiar el título (mock)' }))

    await act(() => router.navigate(-1))
    const confirm = await screen.findByRole('alertdialog', { name: '¿Salir sin guardar?' })
    await user.click(within(confirm).getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(where(router)).toBe('/c/ana/e/5?zoom=events')
    expect(within(dialog).getByText('Editor de 5 (modal)')).toBeInTheDocument()

    await act(() => router.navigate(-1))
    await user.click(
      within(await screen.findByRole('alertdialog', { name: '¿Salir sin guardar?' })).getByRole('button', {
        name: 'Salir sin guardar',
      }),
    )
    await waitFor(() => expect(where(router)).toBe('/c/ana?zoom=events'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows the refreshed card and a confirmation after saving', async () => {
    const updated: EventOut = { ...EVENT, title: 'Primeros pasos solita', version: 2, images: [EVENT.images[0]], cover_image_id: 'i1' }
    let current = EVENT
    const fetchMock = signIn(ADMIN_SESSION, () => current)
    server.saved = updated
    const user = userEvent.setup()
    renderDetail(['/c/ana/e/5'])
    const dialog = await screen.findByRole('dialog', { name: 'Primeros pasos' })
    await user.click(await within(dialog).findByRole('button', { name: 'Editar hito' }))
    current = updated
    await user.click(await within(dialog).findByRole('button', { name: 'Guardar (mock)' }))

    expect(await within(dialog).findByRole('heading', { name: 'Primeros pasos solita' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Primeros pasos solita' })).toBe(dialog)
    expect(within(dialog).getByRole('img', { name: 'Columpio' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Ver la foto/ })).not.toBeInTheDocument()
    // The editor shows the toast; the dialog announces the save (the toast region is outside the modal).
    expect(within(dialog).getByRole('status')).toHaveTextContent('Cambios guardados')
    // The event (and the timeline) are refetched after the save.
    await waitFor(() => expect(eventCalls(fetchMock)).toBe(2))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Editar hito' })).toHaveFocus())
  })
})
