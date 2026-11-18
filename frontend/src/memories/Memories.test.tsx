import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoriesOut, MemoriesSeenIn, TimelineEventOut, TimelineOut } from '../api/schema.gen'
import { takeLaunchIntent } from '../push/launch'
import { VIEWER_SESSION, mockSignedIn, renderApp, type MockRequest } from '../utils/test-utils'
import { NOTES } from '../whatsNew/notes'
import { ANNOUNCE_DELAY_MS } from './MemoriesAnnouncer'

// Today is 17 November 2026. Ana is child 1 and Leo child 2 (TEST_CHILDREN).
function event(id: number, title: string, date: string, childIds: number[] = [1]): TimelineEventOut {
  return { id, title, date, day_order: 0, category_ids: [1], child_ids: childIds, cover: null, image_count: 0, created_at: `${date}T20:00:00Z` }
}

const FIRST_WORDS = event(1, 'Primeras palabras', '2026-10-17')
const FIRST_STEPS = event(2, 'Primeros pasos', '2025-11-17', [1, 2])
const BEACH = event(3, 'Día de playa', '2026-08-20')
const NAP = event(4, 'Primera siesta', '2026-11-03', [2])

const NOTHING: MemoriesOut = { announced_on: null, opened_on: null }

/** Signed in as a viewer with the family's milestones and the memories' days so far; returns what gets saved. */
function signedIn(events: TimelineEventOut[], state: MemoriesOut = NOTHING, whatsNewSeen: string[] = NOTES.map((note) => note.id)) {
  const saved: MemoriesSeenIn[] = []
  const empty = (childId: number): TimelineOut => ({ child_id: childId, total: 0, events: [] })
  mockSignedIn(VIEWER_SESSION, {
    'GET /api/whats-new': { seen: whatsNewSeen },
    'POST /api/whats-new/seen': ({ body }: MockRequest) => body,
    'GET /api/memories': state,
    'POST /api/memories/seen': ({ body }: MockRequest) => {
      saved.push(body as MemoriesSeenIn)
      return { ...state, ...(body as MemoriesSeenIn) }
    },
    'GET /api/timeline': { child_id: null, total: events.length, events } satisfies TimelineOut,
    'GET /api/children/1/timeline': empty(1),
    'GET /api/children/2/timeline': empty(2),
  })
  return saved
}

const findNotice = (text: string) => screen.findByText(text, {}, { timeout: 5000 })
const noNotice = () => expect(screen.queryByText(/^Tal día como hoy/)).not.toBeInTheDocument()
/** Longer than the notice waits before it shows. */
const afterTheDelay = () => new Promise((resolve) => setTimeout(resolve, ANNOUNCE_DELAY_MS + 400))

beforeEach(() => {
  // Only the date: timers stay real for react-aria and user-event.
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 10, 17, 10, 0))
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'setAppBadge')
  Reflect.deleteProperty(navigator, 'clearAppBadge')
})

describe('memories', () => {
  it('tells about today’s memories once, and the panel lists them by age and opens them', async () => {
    const saved = signedIn([NAP, FIRST_WORDS, BEACH, FIRST_STEPS])
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana')

    expect(await findNotice('Tal día como hoy, hace 1 mes: «Primeras palabras» y 1 recuerdo más.')).toBeInTheDocument()
    expect(saved).toEqual([{ announced_on: '2026-11-17' }])
    const button = screen.getByRole('button', { name: 'Recuerdos (2 nuevos hoy)' })

    // With several, «Ver» opens the panel of the header button.
    await user.click(screen.getByRole('button', { name: 'Ver' }))
    const panel = await screen.findByRole('dialog', { name: 'Recuerdos de hoy' })
    expect(within(panel).getByText('17 de noviembre de 2026')).toBeInTheDocument()
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Hace 1 mes', 'Hace 1 año'])
    const links = within(panel).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/c/ana/e/1?zoom=events&focus=e1', '/c/ana/e/2?zoom=events&focus=e2'])
    // Whose each one is.
    expect(within(links[1]).getByRole('img', { name: 'Ana, Leo' })).toBeInTheDocument()
    // Looking at them counts them as seen.
    expect(saved).toEqual([{ announced_on: '2026-11-17' }, { opened_on: '2026-11-17' }])
    expect(button).toHaveAccessibleName('Recuerdos')
    noNotice()

    await user.click(links[1])
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana/e/2'))
    expect(router.state.location.search).toBe('?zoom=events&focus=e2')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Recuerdos de hoy' })).not.toBeInTheDocument())
  })

  it('opens a single memory from the notice, over the timeline of its child', async () => {
    const saved = signedIn([NAP, FIRST_WORDS, BEACH])
    const user = userEvent.setup()
    const { router } = renderApp('/c/leo')

    expect(await findNotice('Tal día como hoy, hace 1 mes: «Primeras palabras».')).toBeInTheDocument()
    const view = screen.getByRole('link', { name: 'Ver' })
    expect(view).toHaveAttribute('href', '/c/ana/e/1?zoom=events&focus=e1')
    await user.click(view)
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana/e/1'))
    expect(saved).toEqual([{ announced_on: '2026-11-17' }, { opened_on: '2026-11-17' }])
    // Behind the milestone's card now.
    expect(screen.getByRole('button', { name: 'Recuerdos', hidden: true })).toBeInTheDocument()
  })

  it('waits until what’s new has been read', async () => {
    signedIn([FIRST_WORDS], NOTHING, [])
    const user = userEvent.setup()
    renderApp('/c/ana')

    const news = await screen.findByRole('dialog', { name: 'Novedades' })
    await afterTheDelay()
    noNotice()
    await user.click(within(news).getByRole('button', { name: '¡Entendido!' }))
    expect(await findNotice('Tal día como hoy, hace 1 mes: «Primeras palabras».')).toBeInTheDocument()
  })

  it('only counts them once told today, and not at all once looked at', async () => {
    const saved = signedIn([FIRST_WORDS, FIRST_STEPS], { announced_on: '2026-11-17', opened_on: '2026-11-16' })
    renderApp('/c/ana')
    expect(await screen.findByRole('button', { name: 'Recuerdos (2 nuevos hoy)' })).toBeInTheDocument()
    await afterTheDelay()
    noNotice()
    expect(saved).toEqual([])
  })

  it('tells when the next memories come on a day without any', async () => {
    const saved = signedIn([NAP, BEACH])
    const user = userEvent.setup()
    renderApp('/c/ana')

    const button = await screen.findByRole('button', { name: 'Recuerdos' })
    await afterTheDelay()
    noNotice()
    await user.click(button)
    const panel = await screen.findByRole('dialog', { name: 'Recuerdos de hoy' })
    expect(await within(panel).findByText('Hoy no hay recuerdos.')).toBeInTheDocument()
    expect(within(panel).getByText('El próximo, el 20 de noviembre de 2026:')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /^Día de playa/ })).toHaveAttribute('href', '/c/ana/e/3?zoom=events&focus=e3')
    expect(saved).toEqual([{ opened_on: '2026-11-17' }])
  })
})

describe('memories opened from their notification', () => {
  const opening = (path: string) => takeLaunchIntent({ href: `http://localhost${path}` } as Location)

  it('open the list of today’s memories', async () => {
    const saved = signedIn([FIRST_WORDS, FIRST_STEPS], { announced_on: '2026-11-17', opened_on: null })
    opening('/?memories=open')
    renderApp('/')

    const panel = await screen.findByRole('dialog', { name: 'Recuerdos de hoy' })
    expect(await within(panel).findAllByRole('link')).toHaveLength(2)
    expect(saved).toEqual([{ opened_on: '2026-11-17' }])
  })

  it('count as seen when it opened one of them', async () => {
    const saved = signedIn([FIRST_WORDS])
    opening('/c/ana?zoom=events&focus=e1&memories=seen')
    renderApp('/c/ana?zoom=events&focus=e1')

    await waitFor(() => expect(saved).toEqual([{ opened_on: '2026-11-17' }]))
    expect(await screen.findByRole('button', { name: 'Recuerdos' })).toBeInTheDocument()
    await afterTheDelay()
    noNotice()
    expect(screen.queryByRole('dialog', { name: 'Recuerdos de hoy' })).not.toBeInTheDocument()
  })

  it('leave on the app’s badge how many are still to see', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    const setAppBadge = vi.fn(() => Promise.resolve())
    const clearAppBadge = vi.fn(() => Promise.resolve())
    Object.defineProperties(navigator, {
      setAppBadge: { configurable: true, value: setAppBadge },
      clearAppBadge: { configurable: true, value: clearAppBadge },
    })
    signedIn([FIRST_WORDS, FIRST_STEPS], { announced_on: '2026-11-17', opened_on: null })
    const user = userEvent.setup()
    renderApp('/c/ana')

    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(2))
    expect(clearAppBadge).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Recuerdos (2 nuevos hoy)' }))
    await waitFor(() => expect(clearAppBadge).toHaveBeenCalled())
  })
})
