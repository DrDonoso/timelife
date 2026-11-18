import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { qk } from '../api/queries'
import type { WhatsNewOut, WhatsNewSeenIn } from '../api/schema.gen'
import {
  ADMIN_SESSION,
  VIEWER_SESSION,
  mockSignedIn,
  renderApp,
  renderWithProviders,
  reply,
  type MockRequest,
} from '../utils/test-utils'
import type { Note } from './notes'
import { NEWS_SHOWN, NewsDialog } from './WhatsNewDialog'

const { FIXTURES, note } = vi.hoisted(() => {
  const note = (id: string, kind: Note['kind'], extra: Partial<Note> = {}): Note => ({
    id,
    date: id.slice(0, 10),
    kind,
    audience: 'everyone',
    es: { title: `Título ${id}`, body: `Texto ${id}` },
    en: { title: `Title ${id}`, body: `Text ${id}` },
    pt: { title: `Título pt ${id}`, body: `Texto pt ${id}` },
    ...extra,
  })
  // Newest first, as the real NOTES.
  const FIXTURES: Note[] = [
    note('2026-12-20-albums', 'new', { link: '/all' }),
    note('2026-12-10-backups', 'new', { audience: 'admins', icon: 'database-export', link: '/admin/backup' }),
    note('2026-12-05-zoom', 'improved'),
    note('2026-11-30-photos', 'fixed'),
    note('2026-11-16-novedades', 'new'),
  ]
  return { FIXTURES, note }
})

vi.mock('./notes', async (importOriginal) => ({ ...(await importOriginal<typeof import('./notes')>()), NOTES: FIXTURES }))

const ALL_IDS = FIXTURES.map((item) => item.id)
const except = (...ids: string[]) => ALL_IDS.filter((id) => !ids.includes(id))

beforeAll(async () => {
  await import('./WhatsNew')
})

/** Signed in with `seen` read so far (or a handler answering it); returns the ids saved by each request. */
function signedIn(
  session = VIEWER_SESSION,
  seen: string[] | null | (() => Promise<WhatsNewOut>) = [],
  save: (ids: string[]) => unknown = (ids) => ({ seen: ids }),
) {
  const saved: string[][] = []
  const fetchMock = mockSignedIn(session, {
    'GET /api/whats-new': typeof seen === 'function' ? seen : ({ seen } satisfies WhatsNewOut),
    'GET /api/children/1/timeline': { child_id: 1, total: 0, events: [] },
    'GET /api/children/2/timeline': { child_id: 2, total: 0, events: [] },
    'POST /api/whats-new/seen': ({ body }: MockRequest) => {
      const { ids } = body as WhatsNewSeenIn
      saved.push(ids)
      return save(ids)
    },
  })
  return { saved, fetchMock }
}

function titles(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole('listitem')
    .map((item) => within(item).getByRole('heading').textContent ?? '')
}

describe("what's new", () => {
  it('starts a new user with nothing to catch up on: every note counts as read, none is shown', async () => {
    const { saved } = signedIn(VIEWER_SESSION, null)
    renderApp('/c/ana')
    await waitFor(() => expect(saved).toEqual([ALL_IDS]))
    expect(await screen.findByRole('heading', { name: 'Ana' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Novedades' })).not.toBeInTheDocument()
  })

  it('tells what is new since the last visit, new things first, and marks it all as read once closed', async () => {
    const { saved } = signedIn(VIEWER_SESSION, ['2026-11-16-novedades'])
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana')
    const dialog = await screen.findByRole('dialog', { name: 'Novedades' })
    expect(within(dialog).getByText('Esto es lo nuevo en Timelife desde la última vez que entraste.')).toBeInTheDocument()
    // A viewer never sees the administrators' note.
    expect(titles(dialog)).toEqual(['Título 2026-12-20-albums', 'Título 2026-12-05-zoom', 'Título 2026-11-30-photos'])
    expect(within(dialog).getAllByRole('listitem').map((item) => within(item).getByText(/^(Nuevo|Mejorado|Arreglado)$/).textContent)).toEqual([
      'Nuevo',
      'Mejorado',
      'Arreglado',
    ])
    expect(within(dialog).getByRole('link', { name: 'Llévame allí' })).toHaveAttribute('href', '/all')
    expect(saved).toEqual([])

    await user.click(within(dialog).getByRole('button', { name: '¡Entendido!' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novedades' })).not.toBeInTheDocument())
    // Every unread note counts as read, the administrators' one too.
    expect(saved).toEqual([except('2026-11-16-novedades')])

    await act(() => router.navigate('/c/leo'))
    expect(await screen.findByRole('heading', { name: 'Leo' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Novedades' })).not.toBeInTheDocument()
  })

  it("shows administrators their own notes, and a note's link takes them there", async () => {
    const { saved } = signedIn(ADMIN_SESSION, except('2026-12-10-backups'))
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana')
    const dialog = await screen.findByRole('dialog', { name: 'Novedades' })
    expect(titles(dialog)).toEqual(['Título 2026-12-10-backups'])
    expect(within(dialog).getByText('Solo administradores')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('link', { name: 'Llévame allí' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/backup'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novedades' })).not.toBeInTheDocument())
    expect(saved).toEqual([['2026-12-10-backups']])
  })

  it('shows nothing to a viewer whose only unread notes are for administrators, and marks them as read', async () => {
    const { saved } = signedIn(VIEWER_SESSION, except('2026-12-10-backups'))
    renderApp('/c/ana')
    await waitFor(() => expect(saved).toEqual([['2026-12-10-backups']]))
    expect(screen.queryByRole('dialog', { name: 'Novedades' })).not.toBeInTheDocument()
  })

  it('waits until the milestone open over the timeline is closed', async () => {
    signedIn(VIEWER_SESSION, except('2026-12-05-zoom'))
    const { router, queryClient } = renderApp('/c/ana/e/7')
    await waitFor(() => expect(queryClient.getQueryData(qk.whatsNew)).toBeDefined())
    await act(async () => {})
    expect(screen.queryByRole('dialog', { name: 'Novedades' })).not.toBeInTheDocument()

    await act(() => router.navigate('/c/ana'))
    const dialog = await screen.findByRole('dialog', { name: 'Novedades' })
    expect(titles(dialog)).toEqual(['Título 2026-12-05-zoom'])
  })

  it('closes quietly when the notes cannot be saved (they show again next time)', async () => {
    const { saved } = signedIn(VIEWER_SESSION, except('2026-12-05-zoom'), () => reply(500, { code: 'internal_error' }))
    const user = userEvent.setup()
    renderApp('/c/ana')
    await user.click(await screen.findByRole('button', { name: '¡Entendido!' }))
    await waitFor(() => expect(saved).toEqual([['2026-12-05-zoom']]))
    expect(screen.queryByRole('dialog', { name: 'Novedades' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lists every note by month from the account menu, administrators included', async () => {
    const { saved } = signedIn(ADMIN_SESSION, ALL_IDS)
    const user = userEvent.setup()
    renderApp('/c/ana')
    await user.click(await screen.findByRole('button', { name: 'Menú de usuario: Ada Admin' }))
    await user.click(await screen.findByRole('button', { name: 'Novedades' }))
    const dialog = await screen.findByRole('dialog', { name: 'Novedades' })
    // Only text, with nothing to focus: the keyboard scrolls it once it takes focus.
    expect(within(dialog).getByRole('region', { name: 'Novedades' })).toHaveAttribute('tabindex', '0')
    expect(within(dialog).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual([
      'Diciembre de 2026',
      'Noviembre de 2026',
    ])
    expect(within(dialog).getAllByRole('heading', { level: 5 }).map((heading) => heading.textContent)).toEqual([
      'Título 2026-12-20-albums',
      'Título 2026-12-10-backups',
      'Título 2026-12-05-zoom',
      'Título 2026-11-16-novedades',
      'Título 2026-11-30-photos',
    ])

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novedades' })).not.toBeInTheDocument())
    expect(saved).toEqual([])
  })

  it('counts unread notes as read once the list of every note was seen, without showing them again', async () => {
    let answer: (value: WhatsNewOut) => void = () => {}
    const { saved } = signedIn(VIEWER_SESSION, () => new Promise<WhatsNewOut>((resolve) => (answer = resolve)))
    const user = userEvent.setup()
    renderApp('/c/ana')
    await user.click(await screen.findByRole('button', { name: 'Menú de usuario: Vera Viewer' }))
    await user.click(await screen.findByRole('button', { name: 'Novedades' }))
    const dialog = await screen.findByRole('dialog', { name: 'Novedades' })
    expect(within(dialog).queryByText('Solo administradores')).not.toBeInTheDocument()
    expect(within(dialog).getAllByRole('heading', { level: 5 })).toHaveLength(4)
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novedades' })).not.toBeInTheDocument())

    // The notes read so far arrive only now: what was unread counts as read, and is not shown.
    await act(async () => answer({ seen: except('2026-12-05-zoom') }))
    await waitFor(() => expect(saved).toEqual([['2026-12-05-zoom']]))
    expect(screen.queryByRole('dialog', { name: 'Novedades' })).not.toBeInTheDocument()
  })

  it('shows the first news and the rest on request, in the chosen language', async () => {
    localStorage.setItem('timelife.lang', 'en')
    mockSignedIn(VIEWER_SESSION)
    const user = userEvent.setup()
    const notes = Array.from({ length: NEWS_SHOWN + 2 }, (_, index) => note(`2026-12-${String(index + 1).padStart(2, '0')}-n`, 'new'))
    const onClose = vi.fn()
    renderWithProviders(<NewsDialog isOpen onClose={onClose} notes={notes} />)
    const dialog = await screen.findByRole('dialog', { name: "What's new" })
    expect(titles(dialog)).toEqual(notes.slice(0, NEWS_SHOWN).map((item) => `Title ${item.id}`))

    await user.click(within(dialog).getByRole('button', { name: 'Show 2 more' }))
    expect(titles(dialog)).toEqual(notes.map((item) => `Title ${item.id}`))
    expect(within(dialog).getByRole('heading', { name: `Title ${notes[NEWS_SHOWN].id}` })).toHaveFocus()
    expect(within(dialog).queryByRole('button', { name: /more/ })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Got it!' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
