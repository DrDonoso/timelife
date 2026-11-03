import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { api, type UploadOptions } from '../../api/client'
import type { EventIn, EventUpdateIn } from '../../api/schema.gen'
import { todayISO } from '../../utils/dates'
import { ADMIN_SESSION, mockSignedIn, preloadLazyRoutes, renderApp, renderWithProviders, reply } from '../../utils/test-utils'
import { EventEditor } from './EventEditor'
import { eventOut, eventPage, imageOut } from './testing'

beforeAll(preloadLazyRoutes)

function selectedCategories() {
  const list = screen.getByRole('list', { name: 'Seleccionados' })
  return within(list)
    .queryAllByRole('listitem')
    .map((item) => item.textContent?.replace(/^\d+/, '').replace('Principal', '').trim())
}

function titleField() {
  return screen.getByRole('textbox', { name: /Título/ })
}

describe('EventEditor (create)', () => {
  it('creates an event with the exact EventIn payload and returns to the list', async () => {
    const posted: EventIn[] = []
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': eventPage([]),
      'POST /api/admin/events': ({ body }: { body: EventIn }) => {
        posted.push(body)
        return reply(201, eventOut({ id: 42, title: body.title, child_ids: body.child_ids }))
      },
    })
    let uploaded = 0
    vi.spyOn(api, 'upload').mockImplementation((async (_path: string, file: Blob, options?: UploadOptions) => {
      uploaded += 1
      options?.onProgress?.(1, { loaded: 1, total: 1 })
      return imageOut(`img-${uploaded}`, (file as File).name.replace(/\.\w+$/, ''))
    }) as typeof api.upload)
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events/new?child=2')

    expect(await screen.findByRole('heading', { level: 1, name: 'Nuevo evento' })).toBeInTheDocument()
    expect(document.title).toBe('Nuevo evento · Administración · Timelife')
    // Defaults: today and the child from ?child=.
    expect(await screen.findByRole('button', { name: 'Leo' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Ana' })).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(titleField()).toHaveFocus())

    await user.type(titleField(), '  Primer cumpleaños ')
    await user.type(screen.getByRole('combobox', { name: 'Ubicación' }), 'Parque del Retiro')
    await user.keyboard('{Escape}')
    await user.type(screen.getByRole('textbox', { name: 'Notas' }), 'Con tarta de fresa.')
    // Ordered categories: the order of selection is the ring order.
    await user.click(screen.getByRole('button', { name: 'Añadir Alimentación' }))
    await user.click(screen.getByRole('button', { name: 'Añadir Sueño' }))
    expect(selectedCategories()).toEqual(['Alimentación', 'Sueño'])
    await user.click(screen.getByRole('button', { name: 'Mover Sueño antes' }))
    expect(selectedCategories()).toEqual(['Sueño', 'Alimentación'])

    const input = document.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement
    await user.upload(input, [new File(['a'], 'tarta.jpg', { type: 'image/jpeg' }), new File(['b'], 'velas.png', { type: 'image/png' })])
    await user.click(await screen.findByRole('button', { name: 'Usar «velas» como portada' }))

    // Live preview of the timeline node (once the uploads have finished).
    const preview = screen.getByTestId('event-preview')
    expect(preview).toHaveTextContent('Primer cumpleaños')
    await waitFor(() => expect(preview.querySelector('img')).toHaveAttribute('src', '/api/media/img-2/thumb'))

    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      title: 'Primer cumpleaños',
      date: todayISO(),
      notes: 'Con tarta de fresa.',
      location: 'Parque del Retiro',
      child_ids: [2],
      category_ids: [2, 3],
      images: [
        { id: 'img-1', name: 'tarta' },
        { id: 'img-2', name: 'velas' },
      ],
      cover_image_id: 'img-2',
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/events'))
    expect(await screen.findByText('«Primer cumpleaños» se ha creado.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver en la línea de tiempo' })).toHaveAttribute('href', '/c/leo/e/42')
  })

  it('validates required fields on the client and focuses the first invalid one', async () => {
    const fetchMock = mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/events': eventPage([]) })
    const user = userEvent.setup()
    renderApp('/admin/events/new')
    await screen.findByRole('heading', { level: 1, name: 'Nuevo evento' })
    // Remembered/first child preselected.
    expect(await screen.findByRole('button', { name: 'Ana' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Ana' }))

    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    expect(await screen.findByText('Escribe un título.')).toBeInTheDocument()
    expect(screen.getByText('Elige al menos un niño.')).toBeInTheDocument()
    expect(screen.getByText('Elige al menos una categoría.')).toBeInTheDocument()
    expect(screen.getByText('Revisa los campos marcados antes de guardar.')).toBeInTheDocument()
    expect(titleField()).toHaveFocus()
    expect(titleField()).toHaveAttribute('aria-invalid', 'true')

    // Errors update as the admin fixes the form.
    await user.type(titleField(), 'Gatear')
    expect(screen.queryByText('Escribe un título.')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('shows server validation errors next to their fields', async () => {
    let attempt = 0
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': eventPage([]),
      'POST /api/admin/events': () => {
        attempt += 1
        return attempt === 1
          ? reply(422, { code: 'invalid_request', fields: { title: 'string_too_long' } })
          : reply(422, { code: 'invalid_category' })
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/events/new')
    await user.type(await screen.findByRole('textbox', { name: /Título/ }), 'Andar')
    await user.click(screen.getByRole('button', { name: 'Añadir Sueño' }))

    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    expect(await screen.findByText('Es demasiado largo.')).toBeInTheDocument()
    expect(screen.getByText('Revisa los campos marcados antes de guardar.')).toBeInTheDocument()
    // Editing the field clears its server error.
    await user.type(titleField(), '!')
    expect(screen.queryByText('Es demasiado largo.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    expect(await screen.findByText('Alguna de las categorías seleccionadas ya no existe.')).toBeInTheDocument()
  })

  it('asks before leaving with unsaved changes', async () => {
    mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/events': eventPage([]) })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events/new')
    await screen.findByRole('heading', { level: 1, name: 'Nuevo evento' })

    // Nothing to lose yet: leaves directly.
    await user.click(screen.getByRole('link', { name: 'Volver a eventos' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/events'))
    await router.navigate('/admin/events/new')

    await user.type(await screen.findByRole('textbox', { name: /Título/ }), 'Borrador')
    await user.click(screen.getByRole('link', { name: 'Volver a eventos' }))
    const dialog = await screen.findByRole('alertdialog', { name: '¿Descartar los cambios?' })
    await user.click(within(dialog).getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/admin/events/new')
    expect(titleField()).toHaveValue('Borrador')

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar cambios' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/events'))
  })

  it('explains how to add children or categories when there are none', async () => {
    mockSignedIn(ADMIN_SESSION, { 'GET /api/children': [], 'GET /api/categories': [] })
    renderApp('/admin/events/new')
    expect(await screen.findByText('Todavía no hay niños.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Añadir niños' })).toHaveAttribute('href', '/admin/children')
    expect(screen.getByRole('link', { name: 'Crear categorías' })).toHaveAttribute('href', '/admin/categories')
  })

  it('suggests the places other milestones use, the most used first, accents and case ignored', async () => {
    const posted: EventIn[] = []
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': eventPage([]),
      'GET /api/admin/locations': [
        { name: 'Casa de los abuelos', count: 7 },
        { name: 'Esplugues', count: 4 },
        { name: 'Parque de Esplugues', count: 2 },
        { name: 'Málaga', count: 1 },
      ],
      'POST /api/admin/events': ({ body }: { body: EventIn }) => {
        posted.push(body)
        return reply(201, eventOut({ id: 43, title: body.title }))
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/events/new')
    await user.type(await screen.findByRole('textbox', { name: /Título/ }), 'Primer baño en el mar')
    await user.click(screen.getByRole('button', { name: 'Añadir Sueño' }))

    const field = screen.getByRole('combobox', { name: 'Ubicación' })
    await user.type(field, 'espl')
    const list = await screen.findByRole('listbox', { name: /^Lugares de otros hitos/ })
    const options = within(list).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Esplugues4 hitos', 'Parque de Esplugues2 hitos'])
    await user.clear(field)
    await user.type(field, 'MALA')
    await user.click(await screen.findByRole('option', { name: /^Málaga/ }))
    expect(field).toHaveValue('Málaga')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())

    // Any other text is still a valid location.
    await user.clear(field)
    await user.type(field, 'Playa de la Malagueta')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].location).toBe('Playa de la Malagueta')
  })
})

describe('EventEditor (edit)', () => {
  it('loads the event and saves an EventUpdateIn with its version', async () => {
    const event = eventOut()
    const put: EventUpdateIn[] = []
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events/7': event,
      'GET /api/admin/events': eventPage([]),
      'PUT /api/admin/events/7': ({ body }: { body: EventUpdateIn }) => {
        put.push(body)
        return { ...event, ...body, images: event.images, version: 4 }
      },
    })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events/7')

    expect(await screen.findByRole('heading', { level: 1, name: 'Editar evento' })).toBeInTheDocument()
    expect(await screen.findByRole('textbox', { name: /Título/ })).toHaveValue('Primeros pasos')
    await waitFor(() => expect(document.title).toBe('Primeros pasos · Administración · Timelife'))
    expect(screen.getByRole('combobox', { name: 'Ubicación' })).toHaveValue('Casa')
    expect(selectedCategories()).toEqual(['Sueño', 'Lenguaje y comunicación'])
    expect(screen.getByRole('button', { name: '«Sofá» es la portada' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Sin cambios pendientes')).toBeInTheDocument()

    await user.clear(titleField())
    await user.type(titleField(), 'Primeros pasos solo')
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Quitar Lenguaje y comunicación' }))
    await user.click(screen.getByRole('button', { name: 'Añadir Alimentación' }))
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(put).toHaveLength(1))
    expect(put[0]).toEqual({
      title: 'Primeros pasos solo',
      date: '2026-03-12',
      notes: 'Tres pasos seguidos hasta el sofá.',
      location: 'Casa',
      child_ids: [1],
      category_ids: [2, 3],
      images: [
        { id: event.images[0].id, name: 'Salón' },
        { id: event.images[1].id, name: 'Sofá' },
      ],
      cover_image_id: event.images[1].id,
      version: 3,
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/events'))
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()
  })

  it('frames the cover in a dialog (zoom and move) and saves the framing', async () => {
    const event = eventOut()
    const [salon, sofa] = event.images
    const put: EventUpdateIn[] = []
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events/7': event,
      'GET /api/admin/events': eventPage([]),
      'PUT /api/admin/events/7': ({ body }: { body: EventUpdateIn }) => {
        put.push(body)
        return { ...event, version: 4 }
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/events/7')
    await screen.findByRole('textbox', { name: /Título/ })
    const preview = screen.getByTestId('event-preview')
    expect(preview.querySelector('img')).toHaveAttribute('src', sofa.thumb_url)

    await user.click(screen.getByRole('button', { name: 'Ajustar encuadre' }))
    const dialog = await screen.findByRole('dialog', { name: 'Encuadre de la portada' })
    const stage = within(dialog).getByRole('img', { name: 'Encuadre de «Sofá»' })
    expect(stage.querySelector('img')).toHaveAttribute('src', sofa.display_url)
    expect(within(dialog).getByRole('button', { name: 'Centrar' })).toBeDisabled()

    // 1600 × 1200 at zoom 1: one step moves the photo 5 % of the 1200 px square (x + 60 / 1600).
    await user.click(within(dialog).getByRole('button', { name: 'Mover a la izquierda' }))
    within(dialog).getByRole('slider', { name: 'Zoom' }).focus()
    await user.keyboard('{End}')
    expect(within(dialog).getByRole('slider', { name: 'Zoom' })).toHaveValue('4')
    expect(within(dialog).getByRole('button', { name: 'Centrar' })).toBeEnabled()
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Encuadre de la portada' })).not.toBeInTheDocument())

    // The preview shows the unsaved framing (the whole picture, positioned).
    expect(preview.querySelector('img')).toHaveAttribute('src', sofa.display_url)
    expect(preview.querySelector('img')?.style.width).toBe('533.3333333333333%')
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(put).toHaveLength(1))
    expect(put[0].images).toEqual([
      { id: salon.id, name: 'Salón' },
      { id: sofa.id, name: 'Sofá', crop: { x: 0.5375, y: 0.5, zoom: 4 } },
    ])
  })

  it('cancels a framing and centres a framed cover again', async () => {
    const framed = { ...imageOut('33333333-3333-4333-8333-333333333333', 'Jardín'), crop: { x: 0.4, y: 0.5, zoom: 2 } }
    framed.thumb_url = `/api/media/${framed.id}/thumb?v=0123456789ab`
    const event = eventOut({ images: [framed], cover_image_id: framed.id })
    const put: EventUpdateIn[] = []
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events/7': event,
      'GET /api/admin/events': eventPage([]),
      'PUT /api/admin/events/7': ({ body }: { body: EventUpdateIn }) => {
        put.push(body)
        return { ...event, version: 4 }
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/events/7')
    await screen.findByRole('textbox', { name: /Título/ })
    const preview = screen.getByTestId('event-preview')
    expect(preview.querySelector('img')).toHaveAttribute('src', framed.thumb_url)

    await user.click(screen.getByRole('button', { name: 'Ajustar encuadre' }))
    let dialog = await screen.findByRole('dialog', { name: 'Encuadre de la portada' })
    await user.click(within(dialog).getByRole('button', { name: 'Centrar' }))
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Encuadre de la portada' })).not.toBeInTheDocument())
    expect(preview.querySelector('img')).toHaveAttribute('src', framed.thumb_url)
    expect(screen.getByText('Sin cambios pendientes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ajustar encuadre' }))
    dialog = await screen.findByRole('dialog', { name: 'Encuadre de la portada' })
    expect(within(dialog).getByRole('slider', { name: 'Zoom' })).toHaveValue('2')
    await user.click(within(dialog).getByRole('button', { name: 'Centrar' }))
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar' }))
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(put).toHaveLength(1))
    expect(put[0].images).toEqual([{ id: framed.id, name: 'Jardín' }])
  })

  it('returns to the filtered list it came from', async () => {
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': eventPage([]),
      'GET /api/admin/events/7': eventOut(),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events/7')
    await screen.findByRole('textbox', { name: /Título/ })
    await router.navigate('/admin/events?q=pasos')
    await router.navigate('/admin/events/7', { state: { from: '/admin/events?q=pasos' } })
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/admin/events?q=pasos'))
  })

  it('handles 409 event_stale with a reload that brings the latest version', async () => {
    let version = 3
    const put: EventUpdateIn[] = []
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events': eventPage([]),
      'GET /api/admin/events/7': () => eventOut({ version, title: version === 3 ? 'Primeros pasos' : 'Primeros pasos (editado)' }),
      'PUT /api/admin/events/7': ({ body }: { body: EventUpdateIn }) => {
        put.push(body)
        if (body.version !== version) return reply(409, { code: 'event_stale' })
        return eventOut({ ...body, images: eventOut().images, version: version + 1 })
      },
    })
    const user = userEvent.setup()
    const { router } = renderApp('/admin/events/7')
    await user.type(await screen.findByRole('textbox', { name: /Título/ }), ' 2')
    version = 4 // someone else saved meanwhile

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    const banner = (await screen.findByText('Alguien ha cambiado este evento')).closest<HTMLElement>('[role="alert"]') as HTMLElement
    expect(banner).toHaveTextContent('Se ha modificado mientras lo editabas.')
    expect(router.state.location.pathname).toBe('/admin/events/7')

    await user.click(within(banner).getByRole('button', { name: 'Recargar evento' }))
    await waitFor(() => expect(titleField()).toHaveValue('Primeros pasos (editado)'))
    expect(screen.queryByText('Alguien ha cambiado este evento')).not.toBeInTheDocument()

    await user.type(titleField(), '!')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/events'))
    expect(put.map((body) => body.version)).toEqual([3, 4])
  })

  it('shows a friendly message for missing, trashed or invalid events', async () => {
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events/404': reply(404, { code: 'event_not_found' }),
      'GET /api/admin/events/9': eventOut({ id: 9, deleted_at: '2026-04-01T10:00:00Z' }),
    })
    const { router } = renderApp('/admin/events/404')
    expect(await screen.findByRole('heading', { name: 'Este evento no existe' })).toBeInTheDocument()

    await router.navigate('/admin/events/9')
    expect(await screen.findByRole('heading', { name: 'Este evento está en la papelera' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a la papelera' })).toHaveAttribute('href', '/admin/trash')

    await router.navigate('/admin/events/abc')
    expect(await screen.findByRole('heading', { name: 'Este evento no existe' })).toBeInTheDocument()
  })
})

describe('EventEditor (modal variant)', () => {
  it('fits in the detail modal: own heading, confirm on cancel, onSaved with the event', async () => {
    const event = eventOut()
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events/7': event,
      'PUT /api/admin/events/7': ({ body }: { body: EventUpdateIn }) => ({ ...event, title: body.title, version: 4 }),
    })
    const onSaved = vi.fn()
    const onCancel = vi.fn()
    const onDirtyChange = vi.fn()
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(
      <EventEditor eventId={7} variant="modal" onSaved={onSaved} onCancel={onCancel} onDirtyChange={onDirtyChange} />,
    )
    queryClient.setQueryData(['event', 7], event)
    queryClient.setQueryData(['timeline', 1, {}], { child_id: 1, total: 1, events: [] })

    expect(await screen.findByRole('heading', { level: 2, name: 'Editar evento' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Volver a eventos' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Fotos y vídeos' })).toBeInTheDocument()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    // No changes: cancel right away.
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    await user.type(titleField(), '!')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    const dialog = await screen.findByRole('alertdialog', { name: '¿Descartar los cambios?' })
    await user.click(within(dialog).getByRole('button', { name: 'Seguir editando' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 7, title: 'Primeros pasos!', version: 4 })))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ver en la línea de tiempo' })).not.toBeInTheDocument()
    // Detail, timeline, admin lists and appearance are refreshed.
    expect(queryClient.getQueryState(['event', 7])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['timeline', 1, {}])?.isInvalidated).toBe(true)
  })

  it('creates the event only once, even if submitted again before the modal closes', async () => {
    const posted: EventIn[] = []
    mockSignedIn(ADMIN_SESSION, {
      'POST /api/admin/events': ({ body }: { body: EventIn }) => {
        posted.push(body)
        return reply(201, eventOut({ id: 42, title: body.title, child_ids: body.child_ids }))
      },
    })
    const onSaved = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<EventEditor variant="modal" defaultChildIds={[1]} onSaved={onSaved} onCancel={vi.fn()} />)

    await user.type(await screen.findByRole('textbox', { name: /Título/ }), 'Primera excursión')
    await user.click(screen.getByRole('button', { name: 'Añadir Sueño' }))
    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    // The parent is still closing it: pressing again (or Enter in a field) does nothing.
    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    await user.type(titleField(), '{Enter}')
    expect(posted).toHaveLength(1)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })
})
