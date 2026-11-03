import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildOut } from '../../api/schema.gen'
import { es } from '../../i18n/locales/es'
import { ADMIN_SESSION, TEST_CHILDREN, mockSignedIn, renderWithProviders, reply, type MockHandler } from '../../utils/test-utils'
import { FakeXhr, imageOut, sentBodies } from '../categories/testing'
import { ChildrenPage } from './ChildrenPage'

const ANA_PHOTO = imageOut('11111111-1111-4111-8111-111111111111', 'ana')
const CHILDREN: ChildOut[] = [{ ...TEST_CHILDREN[0], avatar: ANA_PHOTO }, TEST_CHILDREN[1]]

function setup(handlers: Record<string, MockHandler> = {}, initial: ChildOut[] = CHILDREN, applyAccept = true) {
  let children = initial.map((child) => ({ ...child }))
  const fetchMock = mockSignedIn(ADMIN_SESSION, {
    'GET /api/children': () => children,
    ...handlers,
  })
  const user = userEvent.setup({ applyAccept })
  const view = renderWithProviders(<ChildrenPage />, { route: '/admin/children' })
  return {
    ...view,
    fetchMock,
    user,
    setChildren(next: ChildOut[]) {
      children = next
    },
  }
}

function cardNames() {
  return within(screen.getByRole('grid', { name: 'Niños (arrastra para ordenar)' }))
    .getAllByRole('row')
    .map((row) => row.getAttribute('aria-label'))
}

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Añadir niño' }))
  return screen.findByRole('dialog', { name: 'Añadir niño' })
}

function fileInput(dialog: HTMLElement): HTMLInputElement {
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('file input not found')
  return input
}

beforeEach(() => {
  FakeXhr.instances = []
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ChildrenPage', () => {
  it('shows a card per child with photo, name and birth date, without their address', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 20, 12))
    setup()
    const ana = await screen.findByRole('row', { name: 'Ana' })
    expect(within(ana).getByRole('heading', { name: 'Ana' })).toBeInTheDocument()
    expect(within(ana).getByText(/Nació el 2 may 2024/)).toHaveTextContent('Nació el 2 may 2024 · 2 años')
    expect(ana.querySelector('img')).toHaveAttribute('src', ANA_PHOTO.thumb_url)
    expect(within(ana).queryByRole('link')).not.toBeInTheDocument()
    expect(within(ana).queryByText(/\/c\//)).not.toBeInTheDocument()
    const leo = screen.getByRole('row', { name: 'Leo' })
    expect(within(leo).getByText(/Nació el 15 ene 2026/)).toHaveTextContent('Nació el 15 ene 2026 · 9 meses')
    expect(screen.getByRole('heading', { name: '2 niños' })).toBeInTheDocument()
  })

  it('invites admins to add the first child', async () => {
    setup({}, [])
    expect(await screen.findByRole('heading', { name: 'Todavía no hay niños' })).toBeInTheDocument()
  })

  it('creates a child from the name alone (the server makes the address)', async () => {
    const { user, fetchMock, setChildren } = setup({
      'POST /api/admin/children': ({ body }: { body: { name: string } }) => {
        const created: ChildOut = { id: 3, name: body.name, slug: 'lucia-perez', birth_date: null, avatar: null, color: null, sort_order: 2 }
        setChildren([...CHILDREN, created])
        return reply(201, created)
      },
    })
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByRole('button', { name: 'Añadir niño' }))
    expect(within(dialog).getByText('Escribe el nombre.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('textbox', { name: 'Nombre' }))
    await user.paste('Lucía Pérez')
    // The name is the only text field: the address is neither asked for nor previewed.
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1)
    expect(within(dialog).queryByText(/\/c\//)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Añadir niño' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sentBodies(fetchMock, 'POST', '/api/admin/children')).toEqual([
      { name: 'Lucía Pérez', birth_date: null, avatar_image_id: null },
    ])
    expect(await screen.findByText('Lucía Pérez se ha añadido.')).toBeInTheDocument()
    expect(await screen.findByRole('row', { name: 'Lucía Pérez' })).toBeInTheDocument()
  })

  it('adds a child with the same name as another one and a birth date', async () => {
    const { user, fetchMock } = setup({
      'POST /api/admin/children': () =>
        reply(201, { id: 3, name: 'Ana', slug: 'ana-2', birth_date: '2026-02-01', avatar: null, color: null, sort_order: 2 }),
    })
    const dialog = await openCreate(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Ana')
    await user.click(within(dialog).getByRole('button', { name: /Abrir calendario/ }))
    await user.click(await screen.findByRole('button', { name: 'Hoy' }))
    await user.click(within(dialog).getByRole('button', { name: 'Añadir niño' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sentBodies(fetchMock, 'POST', '/api/admin/children')).toEqual([
      { name: 'Ana', birth_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), avatar_image_id: null },
    ])
  })

  it('shows a slug_taken conflict (two children added at once) above the form', async () => {
    const { user } = setup({ 'POST /api/admin/children': reply(409, { code: 'slug_taken' }) })
    const dialog = await openCreate(user)
    const name = within(dialog).getByRole('textbox', { name: 'Nombre' })
    await user.type(name, 'Teo')
    await user.click(within(dialog).getByRole('button', { name: 'Añadir niño' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors.slug_taken)
    expect(name).toHaveValue('Teo')
    expect(name).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('keeps the address, photo and birth date when only the name changes', async () => {
    const { user, fetchMock } = setup({
      'PUT /api/admin/children/1': ({ body }: { body: { name: string } }) => ({ ...CHILDREN[0], name: body.name }),
    })
    await user.click(await screen.findByRole('button', { name: 'Editar a Ana' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar a Ana' })
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1)
    expect(within(dialog).queryByText(/\/c\//)).not.toBeInTheDocument()
    const name = within(dialog).getByRole('textbox', { name: 'Nombre' })
    await user.clear(name)
    await user.type(name, 'Ana María')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/children/1')).toEqual([
      { name: 'Ana María', birth_date: '2024-05-02', avatar_image_id: ANA_PHOTO.id },
    ])
    expect(await screen.findByText('Cambios de Ana María guardados.')).toBeInTheDocument()
  })

  it('removes the photo (and can bring it back before saving)', async () => {
    const { user, fetchMock } = setup({
      'PUT /api/admin/children/1': () => ({ ...CHILDREN[0], avatar: null }),
    })
    await user.click(await screen.findByRole('button', { name: 'Editar a Ana' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar a Ana' })
    await user.click(within(dialog).getByRole('button', { name: 'Quitar foto' }))
    expect(within(dialog).getByText('La foto se eliminará al guardar.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Recuperar la foto' }))
    expect(within(dialog).getByRole('button', { name: 'Quitar foto' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Quitar foto' }))
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(sentBodies(fetchMock, 'PUT', '/api/admin/children/1')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/children/1')).toEqual([
      { name: 'Ana', birth_date: '2024-05-02', avatar_image_id: null },
    ])
  })

  it('uploads a photo with progress before saving', async () => {
    const uploaded = imageOut('22222222-2222-4222-8222-222222222222', 'teo')
    const { user, fetchMock } = setup({
      'POST /api/admin/children': ({ body }: { body: Record<string, unknown> }) =>
        reply(201, { id: 3, name: 'Teo', slug: 'teo', birth_date: null, avatar: uploaded, sort_order: 2, ...body }),
    })
    const dialog = await openCreate(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Teo')
    await user.upload(fileInput(dialog), new File(['png'], 'teo.png', { type: 'image/png' }))

    const xhr = FakeXhr.last
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/admin/uploads?purpose=avatar')
    expect(xhr.requestHeaders['X-Timelife-Request']).toBe('1')
    const progress = within(dialog).getByRole('progressbar', { name: 'Subiendo teo.png…' })
    act(() => xhr.progress(40, 100))
    expect(progress).toHaveAttribute('aria-valuenow', '40')
    // Saving waits for the upload.
    expect(within(dialog).getByRole('button', { name: 'Añadir niño' })).toBeDisabled()
    expect(within(dialog).getByText('Espera a que termine de subirse la foto.')).toBeInTheDocument()

    act(() => xhr.respond(201, uploaded))
    await waitFor(() => expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument())
    expect(dialog.querySelector(`img[src="${uploaded.thumb_url}"]`)).not.toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Cambiar foto' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Añadir niño' }))
    await waitFor(() => expect(sentBodies(fetchMock, 'POST', '/api/admin/children')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'POST', '/api/admin/children')).toEqual([
      { name: 'Teo', birth_date: null, avatar_image_id: uploaded.id },
    ])
  })

  it('explains upload errors and retries', async () => {
    const { user } = setup()
    const dialog = await openCreate(user)
    await user.upload(fileInput(dialog), new File(['gif'], 'raro.png', { type: 'image/png' }))
    act(() => FakeXhr.last.respond(422, { code: 'unsupported_image' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('No se ha podido subir la imagen. Formato de imagen no admitido. Usa JPEG, PNG, WebP o HEIC.')

    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(FakeXhr.instances).toHaveLength(2)
    act(() => FakeXhr.last.respond(413, undefined))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('El archivo es demasiado grande.')
    await user.click(within(dialog).getByRole('button', { name: 'Descartar' }))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('rejects files that are not images without uploading them', async () => {
    const { user } = setup({}, CHILDREN, false)
    const dialog = await openCreate(user)
    await user.upload(fileInput(dialog), new File(['hello'], 'notas.txt', { type: 'text/plain' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Formato de imagen no admitido')
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('cancels an upload in progress', async () => {
    const { user } = setup()
    const dialog = await openCreate(user)
    await user.upload(fileInput(dialog), new File(['png'], 'teo.png', { type: 'image/png' }))
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar subida' }))
    await waitFor(() => expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument())
    expect(within(dialog).getByRole('button', { name: 'Subir foto' })).toBeEnabled()
    // The dialog itself stays open.
    expect(within(dialog).getByRole('textbox', { name: 'Nombre' })).toBeInTheDocument()
  })

  it('asks before discarding unsaved changes with Escape', async () => {
    const { user, fetchMock } = setup()
    const dialog = await openCreate(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Teo')

    await user.keyboard('{Escape}')
    const confirm = await screen.findByRole('alertdialog', { name: '¿Descartar los cambios?' })
    expect(confirm).toHaveTextContent('Tienes cambios sin guardar.')
    await user.click(within(confirm).getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(within(dialog).getByRole('textbox', { name: 'Nombre' })).toHaveValue('Teo')

    await user.keyboard('{Escape}')
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar cambios' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sentBodies(fetchMock, 'POST', '/api/admin/children')).toHaveLength(0)
  })

  it('closes with Escape right away when nothing has changed', async () => {
    const { user } = setup()
    await openCreate(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Editar a Ana' }))
    await screen.findByRole('dialog', { name: 'Editar a Ana' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('explains that a child with milestones cannot be deleted', async () => {
    const { user } = setup({
      'DELETE /api/admin/children/2': reply(409, { code: 'child_in_use', detail: { events: 1 } }),
    })
    await user.click(await screen.findByRole('button', { name: 'Eliminar a Leo' }))
    const dialog = await screen.findByRole('alertdialog', { name: '¿Eliminar a Leo?' })
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No se puede eliminar porque tiene 1 hito asociado (la papelera también cuenta).',
    )
  })

  it('deletes a child without milestones', async () => {
    const { user, setChildren, queryClient } = setup({
      'DELETE /api/admin/children/2': () => {
        setChildren([CHILDREN[0]])
        return reply(204)
      },
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await user.click(await screen.findByRole('button', { name: 'Eliminar a Leo' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(screen.queryByRole('row', { name: 'Leo' })).not.toBeInTheDocument())
    expect(screen.getByText('Leo se ha eliminado.')).toBeInTheDocument()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['children'] })
  })

  it('reorders the cards with the keyboard', async () => {
    const { user, fetchMock, setChildren } = setup({
      'PUT /api/admin/children/order': ({ body }: { body: { ids: number[] } }) => {
        const next = body.ids.map((id, index) => ({ ...CHILDREN.find((child) => child.id === id)!, sort_order: index }))
        setChildren(next)
        return next
      },
    })
    const later = await screen.findByRole('button', { name: 'Mover a Ana después' })
    act(() => later.focus())
    await user.keyboard('{Enter}')
    expect(cardNames()).toEqual(['Leo', 'Ana'])
    expect(screen.getByRole('button', { name: 'Mover a Ana antes' })).toHaveFocus()
    await waitFor(() => expect(sentBodies(fetchMock, 'PUT', '/api/admin/children/order')).toEqual([{ ids: [2, 1] }]))
  })
})
