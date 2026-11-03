import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_SESSION, mockSignedIn, preloadLazyRoutes, renderApp, reply } from '../../utils/test-utils'
import { eventPage, imageOut, summary } from './testing'

beforeAll(preloadLazyRoutes)

type FetchMock = ReturnType<typeof mockSignedIn>

function eventRequests(fetchMock: FetchMock, method = 'GET'): URL[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input).startsWith('/api/admin/events') && (init?.method ?? 'GET') === method)
    .map(([input]) => new URL(String(input), 'http://localhost'))
}

const lastListRequest = (fetchMock: FetchMock) => eventRequests(fetchMock).filter((url) => url.pathname === '/api/admin/events').at(-1)

describe('EventsPage', () => {
  it('lists events newest first with ring thumbnail, date, categories and children', async () => {
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': eventPage([
        summary(2, {
          title: 'Primer diente',
          date: '2026-04-02',
          category_ids: [3, 1],
          child_ids: [1, 2],
          image_count: 3,
          location: 'Casa de los abuelos',
          cover: imageOut('c1'),
        }),
        summary(1, { title: 'Primeras palabras', date: '2026-01-20' }),
      ]),
    })
    renderApp('/admin/events')

    const list = await screen.findByRole('list', { name: 'Eventos' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    const first = within(rows[0])
    expect(first.getByRole('link', { name: 'Primer diente' })).toHaveAttribute('href', '/admin/events/2')
    expect(first.getByText('2 abr 2026')).toBeInTheDocument()
    expect(first.getByText('Casa de los abuelos')).toBeInTheDocument()
    expect(first.getByText('3 fotos')).toBeInTheDocument()
    expect(first.getByRole('img', { name: 'Alimentación, Lenguaje y comunicación' })).toBeInTheDocument()
    expect(first.getByRole('img', { name: 'Ana, Leo' })).toBeInTheDocument()
    expect(rows[0].querySelector('img[src="/api/media/c1/thumb"]')).not.toBeNull()
    expect(first.getByRole('link', { name: 'Editar «Primer diente»' })).toHaveAttribute('href', '/admin/events/2')
    expect(within(rows[1]).getByText('Sin fotos')).toBeInTheDocument()
    expect(screen.getByText('2 eventos')).toBeInTheDocument()

    const request = lastListRequest(fetchMock)
    expect(request?.searchParams.get('page')).toBe('1')
    expect(request?.searchParams.get('page_size')).toBe('20')
    expect(screen.getByRole('link', { name: 'Nuevo evento' })).toHaveAttribute('href', '/admin/events/new')
  })

  it('searches after a short pause and keeps the query in the URL', async () => {
    const fetchMock = mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/events': eventPage([summary(1)]) })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events')
    const search = await screen.findByRole('searchbox', { name: 'Buscar eventos' })
    await user.type(search, 'pasos')

    await waitFor(() => expect(lastListRequest(fetchMock)?.searchParams.get('q')).toBe('pasos'))
    expect(router.state.location.search).toBe('?q=pasos')
    // Debounced: no request for the partial words.
    const queries = eventRequests(fetchMock).map((url) => url.searchParams.get('q'))
    expect(queries.filter((value) => value !== null)).toEqual(['pasos'])

    await user.click(screen.getByRole('button', { name: 'Borrar búsqueda' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(search).toHaveValue('')
  })

  it('filters by child and category (and resets the page)', async () => {
    const fetchMock = mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/events': eventPage([summary(1)], { total: 60 }) })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events?page=2')
    await screen.findByRole('list', { name: 'Eventos' })

    await user.click(screen.getByRole('button', { name: /Filtrar por niño/ }))
    await user.click(await screen.findByRole('option', { name: 'Leo' }))
    await waitFor(() => expect(lastListRequest(fetchMock)?.searchParams.get('child_id')).toBe('2'))
    expect(router.state.location.search).toBe('?child=2')
    expect(screen.getByRole('link', { name: 'Nuevo evento' })).toHaveAttribute('href', '/admin/events/new?child=2')

    await user.click(screen.getByRole('button', { name: /Filtrar por categoría/ }))
    await user.click(await screen.findByRole('option', { name: 'Sueño' }))
    await waitFor(() => expect(lastListRequest(fetchMock)?.searchParams.get('category_id')).toBe('2'))
    expect(lastListRequest(fetchMock)?.searchParams.get('child_id')).toBe('2')
    expect(router.state.location.search).toBe('?child=2&cat=2')
  })

  it('filters by a date range from the toolbar (and resets the page)', async () => {
    const fetchMock = mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/events': eventPage([summary(1)], { total: 60 }) })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events?page=2')
    await screen.findByRole('list', { name: 'Eventos' })

    await user.click(screen.getByRole('button', { name: 'Filtrar por fecha: Todas las fechas' }))
    const dialog = await screen.findByRole('dialog', { name: 'Filtrar por fecha' })
    expect(within(dialog).getByRole('button', { name: 'Quitar fechas' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Este año' }))

    const year = new Date().getFullYear()
    await waitFor(() => expect(lastListRequest(fetchMock)?.searchParams.get('date_from')).toBe(`${year}-01-01`))
    expect(lastListRequest(fetchMock)?.searchParams.get('date_to')).toBe(`${year}-12-31`)
    expect(lastListRequest(fetchMock)?.searchParams.get('page')).toBe('1')
    expect(router.state.location.search).toBe(`?from=${year}-01-01&to=${year}-12-31`)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filtrar por fecha' })).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Filtrar por fecha: Este año' }))

    await user.click(within(await screen.findByRole('dialog', { name: 'Filtrar por fecha' })).getByRole('button', { name: 'Quitar fechas' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(lastListRequest(fetchMock)?.searchParams.get('date_from')).toBeNull()
    // Clearing closes the popover and focus returns to the filter.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filtrar por fecha' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Filtrar por fecha: Todas las fechas' })).toHaveFocus())
  })

  it('reads the date range from the URL and clears it with the other filters', async () => {
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': ({ url }: { url: URL }) => eventPage(url.searchParams.get('date_from') ? [] : [summary(1)]),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events?to=2025-03-31&from=2025-01-01')
    expect(await screen.findByRole('heading', { name: 'Ningún evento coincide' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filtrar por fecha: 1 ene 2025 – 31 mar 2025' })).toBeInTheDocument()
    const request = lastListRequest(fetchMock)
    expect([request?.searchParams.get('date_from'), request?.searchParams.get('date_to')]).toEqual(['2025-01-01', '2025-03-31'])

    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(await screen.findByRole('link', { name: 'Evento 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filtrar por fecha: Todas las fechas' })).toBeInTheDocument()
  })

  it('orders reversed bounds from the URL', async () => {
    const fetchMock = mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/events': eventPage([summary(1)]) })
    renderApp('/admin/events?from=2025-04-01&to=2025-02-01')
    await screen.findByRole('list', { name: 'Eventos' })
    expect(screen.getByRole('button', { name: 'Filtrar por fecha: 1 feb 2025 – 1 abr 2025' })).toBeInTheDocument()
    expect(lastListRequest(fetchMock)?.searchParams.get('date_from')).toBe('2025-02-01')
    expect(lastListRequest(fetchMock)?.searchParams.get('date_to')).toBe('2025-04-01')
  })

  it('ignores invalid dates in the URL', async () => {
    const fetchMock = mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/events': eventPage([summary(1)]) })
    renderApp('/admin/events?from=2025-13-01&to=nope')
    await screen.findByRole('list', { name: 'Eventos' })
    expect(screen.getByRole('button', { name: 'Filtrar por fecha: Todas las fechas' })).toBeInTheDocument()
    expect(lastListRequest(fetchMock)?.searchParams.has('date_from')).toBe(false)
    expect(lastListRequest(fetchMock)?.searchParams.has('date_to')).toBe(false)
  })

  it('groups the events of a day so the administrator chooses which one comes first', async () => {
    let order = [3, 2]
    const sent: unknown[] = []
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': () =>
        eventPage([
          summary(1, { title: 'Primer diente', date: '2026-04-02' }),
          ...order.map((id) => summary(id, { title: id === 2 ? 'Primeros pasos' : 'Primera palabra', date: '2026-03-12' })),
          summary(4, { title: 'Primera sonrisa', date: '2026-01-20' }),
        ]),
      'PUT /api/admin/events/day-order': ({ body }: { body: { date: string; ids: number[] } }) => {
        sent.push(body)
        order = body.ids
        return order.map((id) => summary(id))
      },
    })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events?q=primer')

    const day = await screen.findByRole('grid', { name: 'Eventos del 12 mar 2026 (arrastra para ordenar)' })
    expect(screen.getByText('Mismo día · 12 mar 2026')).toBeInTheDocument()
    const titles = () => within(day).getAllByRole('row').map((row) => within(row).getByTitle(/^Primer/).textContent)
    expect(titles()).toEqual(['Primera palabra', 'Primeros pasos'])
    expect(within(day).getByRole('button', { name: 'Arrastrar «Primera palabra» para cambiar el orden' })).toBeInTheDocument()
    expect(within(day).getByRole('button', { name: 'Subir «Primera palabra» (sale antes)' })).toBeDisabled()
    // Events alone on their day keep a plain row with links.
    const rows = within(screen.getByRole('list', { name: 'Eventos' })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByRole('link', { name: 'Primer diente' })).toHaveAttribute('href', '/admin/events/1')

    await user.click(within(day).getByRole('button', { name: 'Subir «Primeros pasos» (sale antes)' }))
    expect(titles()).toEqual(['Primeros pasos', 'Primera palabra'])
    await waitFor(() => expect(sent).toEqual([{ date: '2026-03-12', ids: [2, 3] }]))
    expect(await screen.findByText('Orden guardado')).toBeInTheDocument()
    expect(eventRequests(fetchMock, 'PUT').map((url) => url.pathname)).toEqual(['/api/admin/events/day-order'])
    expect(await screen.findByText('«Primeros pasos»: posición 1 de 2 del día.')).toBeInTheDocument()

    // The row itself opens the editor and remembers the filtered list.
    await user.click(within(day).getByRole('button', { name: 'Editar «Primera palabra»' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/events/3'))
    expect(router.state.location.state).toEqual({ from: '/admin/events?q=primer' })
  })

  it('reports an order that could not be saved and shows the saved one again', async () => {
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': eventPage([summary(2, { title: 'Primeros pasos' }), summary(3, { title: 'Primera palabra' })]),
      'PUT /api/admin/events/day-order': reply(422, { code: 'invalid_order' }),
    })
    const user = userEvent.setup()
    renderApp('/admin/events')
    const day = await screen.findByRole('grid', { name: /^Eventos del 12 mar 2026/ })
    await user.click(within(day).getByRole('button', { name: 'Bajar «Primeros pasos» (sale después)' }))
    expect(await screen.findByText('El orden ha cambiado mientras editabas. Actualiza la lista e inténtalo de nuevo.')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(day).getAllByRole('row').map((row) => row.getAttribute('data-key'))).toEqual(['2', '3']),
    )
  })

  it('paginates', async () => {
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': ({ url }: { url: URL }) => {
        const page = Number(url.searchParams.get('page'))
        return eventPage([summary(page * 100, { title: `Página ${page}` })], { total: 45, page })
      },
    })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events')
    const pagination = await screen.findByRole('navigation', { name: 'Paginación de eventos' })
    expect(within(pagination).getByText('Página 1 de 3')).toBeInTheDocument()
    expect(within(pagination).getByRole('button', { name: 'Anterior' })).toBeDisabled()

    await user.click(within(pagination).getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByRole('link', { name: 'Página 2' })).toBeInTheDocument()
    expect(within(pagination).getByText('Página 2 de 3')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?page=2')
    expect(lastListRequest(fetchMock)?.searchParams.get('page')).toBe('2')
    expect(screen.getByText(/21–21 de 45/)).toBeInTheDocument()
  })

  it('moves an event to the trash after confirming, with a toast linking to the trash', async () => {
    let deleted = false
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': () => eventPage(deleted ? [summary(2)] : [summary(1, { title: 'Primer diente' }), summary(2)]),
      'DELETE /api/admin/events/1': () => {
        deleted = true
        return reply(204)
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/events')

    await user.click(await screen.findByRole('button', { name: 'Eliminar «Primer diente»' }))
    const dialog = await screen.findByRole('alertdialog', { name: '¿Mover a la papelera?' })
    expect(within(dialog).getByText(/«Primer diente» dejará de verse en la línea de tiempo/)).toBeInTheDocument()

    // Cancelling keeps the event.
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(eventRequests(fetchMock, 'DELETE')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Eliminar «Primer diente»' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Mover a la papelera' }))

    expect(await screen.findByText('«Primer diente» se ha movido a la papelera.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver papelera' })).toHaveAttribute('href', '/admin/trash')
    expect(eventRequests(fetchMock, 'DELETE').map((url) => url.pathname)).toEqual(['/api/admin/events/1'])
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Primer diente' })).not.toBeInTheDocument())
  })

  it('shows the delete error inside the dialog', async () => {
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': eventPage([summary(1, { title: 'Primer diente' })]),
      'DELETE /api/admin/events/1': reply(404, { code: 'event_not_found' }),
    })
    const user = userEvent.setup()
    renderApp('/admin/events')
    await user.click(await screen.findByRole('button', { name: 'Eliminar «Primer diente»' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Mover a la papelera' }))
    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent('Este hito no existe o se ha eliminado.')
  })

  it('invites to create the first event when there are none', async () => {
    mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/events': eventPage([]) })
    renderApp('/admin/events')
    expect(await screen.findByRole('heading', { name: 'Todavía no hay eventos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Crear el primer evento' })).toHaveAttribute('href', '/admin/events/new')
  })

  it('explains when filters match nothing and clears them', async () => {
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': ({ url }: { url: URL }) => eventPage(url.searchParams.get('q') ? [] : [summary(1)]),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events?q=zzz&cat=1')
    expect(await screen.findByRole('heading', { name: 'Ningún evento coincide' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Buscar eventos' })).toHaveValue('zzz')
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(await screen.findByRole('link', { name: 'Evento 1' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Buscar eventos' })).toHaveValue('')
    expect(lastListRequest(fetchMock)?.searchParams.get('q')).toBeNull()
  })

  it('shows load errors with a retry button', async () => {
    let fail = true
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': () => (fail ? reply(500, { code: 'internal_error' }) : eventPage([summary(1)])),
    })
    const user = userEvent.setup()
    renderApp('/admin/events')
    expect(await screen.findByRole('heading', { name: 'No se han podido cargar los eventos.' })).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('link', { name: 'Evento 1' })).toBeInTheDocument()
  })
})
