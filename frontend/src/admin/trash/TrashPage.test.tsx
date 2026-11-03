import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_SESSION, mockSignedIn, preloadLazyRoutes, renderApp, reply } from '../../utils/test-utils'
import { eventOut, imageOut, trashItem } from '../events/testing'

beforeAll(preloadLazyRoutes)

describe('TrashPage', () => {
  it('lists deleted events with their date and who deleted them', async () => {
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/trash': [
        trashItem(5, { title: 'Primer diente', cover: imageOut('cover-5'), image_count: 2, category_ids: [3, 2] }),
        trashItem(4, { title: 'Sin autor', deleted_by: null, image_count: 3, video_count: 1 }),
      ],
    })
    renderApp('/admin/trash')
    const list = await screen.findByRole('list', { name: 'Eventos en la papelera' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Primer diente')).toBeInTheDocument()
    expect(within(rows[0]).getByText('2 nov 2025')).toBeInTheDocument()
    expect(within(rows[0]).getByText('2 fotos')).toBeInTheDocument()
    expect(within(rows[1]).getByText('2 fotos · 1 vídeo')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/^Eliminado el 1 abr 2026, \d{2}:\d{2} por Ada Admin$/)).toBeInTheDocument()
    expect(rows[0].querySelector('img[src="/api/media/cover-5/thumb"]')).not.toBeNull()
    expect(within(rows[1]).getByText(/^Eliminado el 1 abr 2026, \d{2}:\d{2}$/)).toBeInTheDocument()
    expect(screen.getByText('2 eventos en la papelera')).toBeInTheDocument()
    expect(document.title).toBe('Papelera · Administración · Timelife')
  })

  it('restores an event with a toast linking to its editor', async () => {
    let restored = false
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/trash': () => (restored ? [] : [trashItem(5, { title: 'Primer diente' })]),
      'POST /api/admin/trash/5/restore': () => {
        restored = true
        return eventOut({ id: 5, title: 'Primer diente' })
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/trash')
    await user.click(await screen.findByRole('button', { name: 'Restaurar «Primer diente»' }))
    expect(await screen.findByText('«Primer diente» se ha restaurado.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/admin/events/5')
    expect(await screen.findByRole('heading', { name: 'La papelera está vacía' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/admin/trash/5/restore' && init?.method === 'POST')).toBe(true)
  })

  it('reports restore errors', async () => {
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/trash': [trashItem(5, { title: 'Primer diente' })],
      'POST /api/admin/trash/5/restore': reply(409, { code: 'event_not_deleted' }),
    })
    const user = userEvent.setup()
    renderApp('/admin/trash')
    await user.click(await screen.findByRole('button', { name: 'Restaurar «Primer diente»' }))
    expect(await screen.findByText('Este hito no está en la papelera.')).toBeInTheDocument()
  })

  it('deletes permanently only after a danger confirmation', async () => {
    let purged = false
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/trash': () => (purged ? [] : [trashItem(5, { title: 'Primer diente', image_count: 3 })]),
      'DELETE /api/admin/trash/5': () => {
        purged = true
        return reply(204)
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/trash')

    await user.click(await screen.findByRole('button', { name: 'Eliminar definitivamente «Primer diente»' }))
    let dialog = await screen.findByRole('alertdialog', { name: '¿Eliminar para siempre?' })
    expect(dialog).toHaveTextContent('«Primer diente» y sus 3 fotos se borrarán definitivamente. Esta acción no se puede deshacer.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(purged).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Eliminar definitivamente «Primer diente»' }))
    dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar para siempre' }))
    expect(await screen.findByText('«Primer diente» se ha eliminado definitivamente.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'La papelera está vacía' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/admin/trash/5' && init?.method === 'DELETE')).toBe(true)
  })

  it('shows the empty state', async () => {
    mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/trash': [] })
    renderApp('/admin/trash')
    expect(await screen.findByRole('heading', { name: 'La papelera está vacía' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a eventos' })).toHaveAttribute('href', '/admin/events')
  })

  it('shows load errors with retry', async () => {
    mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/trash': reply(500, { code: 'internal_error' }) })
    renderApp('/admin/trash')
    expect(await screen.findByRole('heading', { name: 'No se ha podido cargar la papelera.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
