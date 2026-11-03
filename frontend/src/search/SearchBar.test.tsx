import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_CHILDREN, mockSignedIn } from '../utils/test-utils'
import { SEARCH_DEBOUNCE_MS } from './SearchBar'
import { currentUrl, renderSearch, timelineHandler } from './testing'

const TIMELINE = 'GET /api/children/1/timeline'

/** Renders the search at `route` once the current child is known (as in the app, after loading). */
async function setup(route = '/c/ana') {
  const fetchMock = mockSignedIn(undefined, { [TIMELINE]: timelineHandler() })
  const view = renderSearch(route)
  await screen.findByRole('heading', { level: 1, name: 'Ana' })
  return { ...view, fetchMock }
}

const searchInput = () => screen.getByRole('combobox', { name: 'Buscar hitos' })

/** `q` values sent to the timeline endpoint, in order. */
function requestedQueries(fetchMock: Awaited<ReturnType<typeof setup>>['fetchMock']) {
  return fetchMock.mock.calls
    .map(([url]) => new URL(String(url), 'http://localhost'))
    .filter((url) => url.pathname === '/api/children/1/timeline')
    .map((url) => url.searchParams.get('q'))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SearchBar', () => {
  it('debounces the URL update (≈250 ms) and keeps the other params', async () => {
    const { router, fetchMock } = await setup('/c/ana?zoom=months&focus=m2026-03')
    // fireEvent (sync) instead of user-event: Testing Library's async wrapper waits on a real
    // setTimeout(0) that Vitest fake timers would never fire.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    for (const value of ['p', 'pa', 'pas']) {
      fireEvent.change(searchInput(), { target: { value } })
      act(() => vi.advanceTimersByTime(100))
    }
    expect(searchInput()).toHaveValue('pas')
    expect(currentUrl(router)).toBe('/c/ana?zoom=months&focus=m2026-03')

    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 101))
    expect(router.state.location.search).not.toContain('q=')
    act(() => vi.advanceTimersByTime(1))
    expect(currentUrl(router)).toBe('/c/ana?zoom=months&focus=m2026-03&q=pas')

    vi.useRealTimers()
    await waitFor(() => expect(requestedQueries(fetchMock)).toContain('pas'))
    // One request per pause in typing, not per keystroke.
    expect(requestedQueries(fetchMock)).not.toContain('p')
    expect(requestedQueries(fetchMock)).not.toContain('pa')
  })

  it('keeps what is typed while its own debounced query reaches the URL', async () => {
    const { router } = await setup()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.change(searchInput(), { target: { value: 'p' } })
    // A keystroke lands while the router renders the debounced `q=p` (a transition).
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
      fireEvent.change(searchInput(), { target: { value: 'pa' } })
    })
    expect(currentUrl(router)).toBe('/c/ana?q=p')
    expect(searchInput()).toHaveValue('pa')

    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS))
    expect(currentUrl(router)).toBe('/c/ana?q=pa')
    expect(searchInput()).toHaveValue('pa')
  })

  it('suggests up to 8 matching events with highlighted titles, dates and category rings', async () => {
    const user = userEvent.setup()
    await setup()
    await user.type(searchInput(), 'pa')
    const listbox = await screen.findByRole('listbox', { name: 'Hitos encontrados' })
    const options = await within(listbox).findAllByRole('option')
    expect(options).toHaveLength(8)
    // Word-start matches first ("Repaso…" only matches mid-word and is the 9th).
    expect(options.map((option) => option.querySelector('.optionTitle')?.textContent)).toEqual([
      'Pasos sin ayuda',
      'Primeros pasos',
      'Papilla de calabaza',
      'Dice «papá»',
      'Paseo por el parque',
      'Pasea en triciclo',
      'Pasta con tomate',
      'Paseo por la playa',
    ])
    expect(screen.getByText(/Mostrando 8 de 9/)).toBeInTheDocument()

    const first = options[0]
    expect(first).toHaveAccessibleName('Pasos sin ayuda')
    expect(first).toHaveAccessibleDescription('14 jun 2026')
    expect(within(first).getByText('Pa', { selector: 'mark' })).toBeInTheDocument()
    expect(first.querySelector('img')).toHaveAttribute('src', '/api/media/11/thumb')
    const ring = first.querySelector<HTMLElement>('[data-thumb]')
    expect(ring?.style.getPropertyValue('--ring')).toMatch(/^conic-gradient/)
    // Without a cover the thumb shows the category gradient + icon.
    expect(options[2].querySelector('img')).toBeNull()
    expect(within(options[3]).getByText('papá', { selector: 'mark' })).toBeInTheDocument()
  })

  it('highlights accent-insensitively', async () => {
    const user = userEvent.setup()
    await setup()
    await user.type(searchInput(), 'JARDIN')
    const option = await screen.findByRole('option', { name: 'Primer día en el jardín de infancia' })
    expect(within(option).getByText('jardín', { selector: 'mark' })).toBeInTheDocument()
  })

  it('opens the suggestions for text typed before the children have loaded', async () => {
    let loadChildren = () => {}
    const childrenLoaded = new Promise<void>((resolve) => {
      loadChildren = resolve
    })
    mockSignedIn(undefined, {
      'GET /api/children': async () => {
        await childrenLoaded
        return TEST_CHILDREN
      },
      [TIMELINE]: timelineHandler(),
    })
    const user = userEvent.setup()
    renderSearch('/c/ana')
    await user.type(searchInput(), 'pasos')
    const listbox = await screen.findByRole('listbox', { name: 'Hitos encontrados' })
    expect(within(listbox).getByText('Buscando…')).toBeInTheDocument()

    loadChildren()
    expect(await within(listbox).findByRole('option', { name: 'Primeros pasos' })).toBeInTheDocument()
  })

  it('opens a suggestion with the keyboard: event detail + zoom=events + focus, keeping filters', async () => {
    const user = userEvent.setup()
    const { router } = await setup('/c/ana?cat=1&zoom=years&focus=y2025')
    await user.type(searchInput(), 'pasos')
    await screen.findByRole('option', { name: 'Primeros pasos' })
    expect(screen.getAllByRole('option')).toHaveLength(2)

    await user.keyboard('{ArrowDown}')
    const first = screen.getByRole('option', { name: 'Pasos sin ayuda' })
    expect(searchInput()).toHaveAttribute('aria-activedescendant', first.id)
    await user.keyboard('{ArrowDown}')
    const second = screen.getByRole('option', { name: 'Primeros pasos' })
    expect(searchInput()).toHaveAttribute('aria-activedescendant', second.id)
    await user.keyboard('{ArrowDown}')
    expect(searchInput()).toHaveAttribute('aria-activedescendant', first.id)
    await user.keyboard('{ArrowUp}{Enter}')

    await waitFor(() => expect(currentUrl(router)).toBe('/c/ana/e/9?cat=1&zoom=events&focus=e9&q=pasos'))
    expect(router.state.historyAction).toBe('PUSH')
    expect(searchInput()).toHaveValue('pasos')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens a suggestion with the mouse, applying a pending query', async () => {
    const user = userEvent.setup()
    const { router } = await setup('/c/ana')
    await user.type(searchInput(), 'duerme')
    await user.click(await screen.findByRole('option', { name: 'Duerme toda la noche' }))
    expect(currentUrl(router)).toBe('/c/ana/e/10?q=duerme&zoom=events&focus=e10')
  })

  it('explains when nothing matches (also mentioning other active filters)', async () => {
    const user = userEvent.setup()
    const { router } = await setup('/c/ana?from=2026-01-01')
    await user.type(searchInput(), 'zzz')
    // The empty state waits for the debounced `q` and the server's answer to it.
    await waitFor(() => expect(currentUrl(router)).toBe('/c/ana?from=2026-01-01&q=zzz'))
    expect(await screen.findByText('Ningún hito coincide con «zzz».')).toBeInTheDocument()
    expect(screen.getByText('Los filtros de fechas o categorías también se aplican.')).toBeInTheDocument()
    // Only the empty state (react-aria wraps it in an option role); no event suggestions.
    expect(document.querySelectorAll('[role="option"][data-key]')).toHaveLength(0)
  })

  it('applies the search right away with Enter', async () => {
    const user = userEvent.setup()
    const { router } = await setup('/c/ana')
    await user.type(searchInput(), 'luna{Enter}')
    expect(currentUrl(router)).toBe('/c/ana?q=luna')
  })

  it('focuses the search with "/" unless the user is typing elsewhere', async () => {
    const user = userEvent.setup()
    await setup()
    await screen.findByRole('combobox', { name: 'Buscar hitos' })

    await user.keyboard('/')
    expect(searchInput()).toHaveFocus()
    expect(searchInput()).toHaveValue('')
    expect(searchInput()).toHaveAttribute('aria-keyshortcuts', '/')

    const notes = screen.getByRole('textbox', { name: 'Notas' })
    await user.click(notes)
    await user.keyboard('/')
    expect(notes).toHaveFocus()
    expect(notes).toHaveValue('/')

    await user.click(screen.getByRole('button', { name: 'Hito del timeline' }))
    await user.keyboard('/')
    expect(searchInput()).toHaveFocus()
  })

  it('clears with the clear button and with Escape (after closing the suggestions)', async () => {
    const user = userEvent.setup()
    const { router } = await setup('/c/ana?q=pasos&zoom=events')
    expect(searchInput()).toHaveValue('pasos')

    await user.click(screen.getByRole('button', { name: 'Borrar la búsqueda' }))
    expect(searchInput()).toHaveValue('')
    expect(searchInput()).toHaveFocus()
    expect(currentUrl(router)).toBe('/c/ana?zoom=events')

    await user.type(searchInput(), 'luna')
    await waitFor(() => expect(currentUrl(router)).toBe('/c/ana?zoom=events&q=luna'))
    expect(await screen.findByText('Ningún hito coincide con «luna».')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(searchInput()).toHaveValue('luna')
    await user.keyboard('{Escape}')
    expect(searchInput()).toHaveValue('')
    expect(currentUrl(router)).toBe('/c/ana?zoom=events')
  })

  it('follows q changes made elsewhere (clear filters, back/forward)', async () => {
    const { router } = await setup('/c/ana?q=pasos')
    expect(searchInput()).toHaveValue('pasos')
    await act(() => router.navigate('/c/ana?q=luna'))
    expect(searchInput()).toHaveValue('luna')
    await act(() => router.navigate('/c/ana'))
    expect(searchInput()).toHaveValue('')
  })
})
