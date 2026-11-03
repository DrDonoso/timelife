import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError, api, type UploadOptions } from '../../api/client'
import type { EventIn, ImageOut } from '../../api/schema.gen'
import { ADMIN_SESSION, mockSignedIn, preloadLazyRoutes, renderApp, reply } from '../../utils/test-utils'
import { deferred, eventOut, eventPage, imageOut, videoOut } from './testing'

beforeAll(preloadLazyRoutes)

interface UploadCall {
  file: File
  options: UploadOptions | undefined
  resolve: (image: ImageOut) => void
  reject: (error: unknown) => void
}

/** Replaces the XHR upload with controllable promises. */
function mockUploads() {
  const calls: UploadCall[] = []
  const spy = vi.spyOn(api, 'upload').mockImplementation(((_path: string, file: Blob, options?: UploadOptions) => {
    const pending = deferred<ImageOut>()
    calls.push({ file: file as File, options, resolve: pending.resolve, reject: pending.reject })
    return pending.promise
  }) as typeof api.upload)
  return { calls, spy }
}

const photo = (name: string, type = 'image/jpeg') => new File(['pixels'], name, { type })

async function chooseFiles(user: ReturnType<typeof userEvent.setup>, files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('file input not found')
  await user.upload(input, files)
}

function grid() {
  return screen.getByRole('grid', { name: 'Fotos y vídeos del evento' })
}

function cardOrder() {
  return within(grid())
    .getAllByRole('row')
    .map((row) => row.getAttribute('aria-label'))
}

function card(name: string) {
  const row = within(grid())
    .getAllByRole('row')
    .find((element) => element.getAttribute('aria-label') === name)
  if (!row) throw new Error(`card ${name} not found`)
  return within(row)
}

/** Label of the drop position focused during a keyboard drag, or null when none is focused. */
function focusedDropPosition() {
  const active = document.activeElement
  return active?.closest('.dropIndicator') ? active.getAttribute('aria-label') : null
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>, title = 'Fotos') {
  await user.type(await screen.findByRole('textbox', { name: /Título/ }), title)
  await user.click(screen.getByRole('button', { name: 'Añadir Sueño' }))
}

function setup(extra: Record<string, unknown> = {}) {
  const posted: EventIn[] = []
  const fetchMock = mockSignedIn(ADMIN_SESSION, {
    'GET /api/admin/events': eventPage([]),
    'POST /api/admin/events': ({ body }: { body: EventIn }) => {
      posted.push(body)
      return reply(201, eventOut({ id: 99, title: body.title }))
    },
    ...extra,
  })
  return { posted, fetchMock }
}

describe('image uploader', () => {
  it('uploads immediately, at most 3 at a time, with per-file progress', async () => {
    setup()
    const uploads = mockUploads()
    const user = userEvent.setup()
    renderApp('/admin/events/new')
    await screen.findByRole('heading', { name: 'Fotos y vídeos' })

    await chooseFiles(user, ['a.jpg', 'b.png', 'c.webp', 'd.heic', 'e.gif'].map((name) => photo(name)))
    expect(uploads.calls.map((call) => call.file.name)).toEqual(['a.jpg', 'b.png', 'c.webp'])
    expect(uploads.calls[0].options?.params).toEqual({ purpose: 'event' })
    expect(cardOrder()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(card('d').getByText('En espera')).toBeInTheDocument()
    expect(card('e').getByText('En espera')).toBeInTheDocument()
    expect(screen.getByText('5 de 50')).toBeInTheDocument()

    act(() => uploads.calls[0].options?.onProgress?.(0.5, { loaded: 5, total: 10 }))
    expect(card('a').getByRole('progressbar', { name: 'Subiendo «a»' })).toHaveAttribute('aria-valuenow', '50')
    expect(card('a').getByText('50 %')).toBeInTheDocument()

    await act(async () => uploads.calls[0].resolve(imageOut('img-a', 'a')))
    await waitFor(() => expect(uploads.calls).toHaveLength(4))
    expect(card('a').queryByRole('progressbar')).not.toBeInTheDocument()
    expect(grid().querySelector('img[src="/api/media/img-a/thumb"]')).not.toBeNull()

    await act(async () => {
      uploads.calls[1].resolve(imageOut('img-b', 'b'))
      uploads.calls[2].resolve(imageOut('img-c', 'c'))
    })
    await waitFor(() => expect(uploads.calls).toHaveLength(5))
    expect(screen.getByText('Subiendo 2 archivos…')).toBeInTheDocument()
  })

  it('retries uploads answered with 503 request_busy', async () => {
    setup()
    const uploads = mockUploads()
    const user = userEvent.setup()
    renderApp('/admin/events/new')
    await screen.findByRole('heading', { name: 'Fotos y vídeos' })
    await chooseFiles(user, [photo('busy.jpg')])

    await act(async () => uploads.calls[0].reject(new ApiError({ status: 503, code: 'request_busy', retryAfter: 0 })))
    expect(await card('busy').findByText('Servidor ocupado, reintentando…')).toBeInTheDocument()
    await waitFor(() => expect(uploads.calls).toHaveLength(2), { timeout: 2000 })
    await act(async () => uploads.calls[1].resolve(imageOut('img-busy', 'busy')))
    await waitFor(() => expect(card('busy').queryByRole('progressbar')).not.toBeInTheDocument())
  })

  it('shows per-file errors with retry (transient) or remove', async () => {
    const { posted } = setup()
    const uploads = mockUploads()
    // The picker may still hand over other files ("All files", drag and drop).
    const user = userEvent.setup({ applyAccept: false })
    renderApp('/admin/events/new')
    await fillRequired(user)
    await chooseFiles(user, [photo('informe.pdf', 'application/pdf'), photo('enorme.jpg'), photo('red.jpg')])

    // Unsupported files never reach the server.
    expect(uploads.calls.map((call) => call.file.name)).toEqual(['enorme.jpg', 'red.jpg'])
    expect(card('informe').getByText('Este archivo no es una foto ni un vídeo compatible. Usa JPEG, PNG, WebP, HEIC, MP4, MOV o WebM.')).toBeInTheDocument()
    expect(card('informe').queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()

    await act(async () => {
      uploads.calls[0].reject(new ApiError({ status: 413, code: 'upload_too_large' }))
      uploads.calls[1].reject(new ApiError({ status: 0, code: 'network' }))
    })
    expect(await card('enorme').findByText('El archivo es demasiado grande.')).toBeInTheDocument()
    expect(card('enorme').queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
    expect(card('red').getByText(/No hay conexión con el servidor/)).toBeInTheDocument()

    // Saving is blocked while there are failed images.
    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    expect(await screen.findByText('Algunas fotos o vídeos no se han podido subir o procesar: reinténtalo o quítalos.')).toBeInTheDocument()
    expect(posted).toHaveLength(0)

    await user.click(card('red').getByRole('button', { name: 'Reintentar la subida de «red»' }))
    expect(uploads.calls).toHaveLength(3)
    await act(async () => uploads.calls[2].resolve(imageOut('img-red', 'red')))
    await waitFor(() => expect(card('red').queryByText(/No hay conexión/)).not.toBeInTheDocument())

    await user.click(card('informe').getByRole('button', { name: 'Quitar «informe»' }))
    await user.click(card('enorme').getByRole('button', { name: 'Quitar «enorme»' }))
    expect(cardOrder()).toEqual(['red'])

    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].images).toEqual([{ id: 'img-red', name: 'red' }])
    expect(posted[0].cover_image_id).toBe('img-red')
  })

  it('cancels the upload of a removed image', async () => {
    setup()
    const uploads = mockUploads()
    const user = userEvent.setup()
    renderApp('/admin/events/new')
    await screen.findByRole('heading', { name: 'Fotos y vídeos' })
    await chooseFiles(user, [photo('a.jpg'), photo('b.jpg'), photo('c.jpg'), photo('d.jpg')])
    expect(uploads.calls).toHaveLength(3)
    await user.click(card('a').getByRole('button', { name: 'Quitar «a»' }))
    expect(uploads.calls[0].options?.signal?.aborted).toBe(true)
    // Its slot goes to the next file at once.
    expect(uploads.calls.map((call) => call.file.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])
    expect(cardOrder()).toEqual(['b', 'c', 'd'])
  })

  it('applies the cover rules: first by default, chosen star, first again when the cover is removed', async () => {
    const { posted } = setup()
    const uploads = mockUploads()
    const user = userEvent.setup()
    renderApp('/admin/events/new')
    await fillRequired(user)

    await chooseFiles(user, [photo('uno.jpg')])
    await act(async () => uploads.calls[0].resolve(imageOut('id-1', 'uno')))
    // A single image is the cover automatically.
    const only = card('uno').getByRole('button', { name: '«uno» es la portada' })
    expect(only).toHaveAttribute('aria-pressed', 'true')
    expect(only).toBeDisabled()
    expect(card('uno').getByText('Portada')).toBeInTheDocument()

    await chooseFiles(user, [photo('dos.jpg'), photo('tres.jpg')])
    await act(async () => {
      uploads.calls[1].resolve(imageOut('id-2', 'dos'))
      uploads.calls[2].resolve(imageOut('id-3', 'tres'))
    })
    await waitFor(() => expect(card('tres').queryByRole('progressbar')).not.toBeInTheDocument())
    expect(card('uno').getByRole('button', { name: '«uno» es la portada' })).toBeInTheDocument()

    await user.click(card('tres').getByRole('button', { name: 'Usar «tres» como portada' }))
    expect(card('tres').getByRole('button', { name: '«tres» es la portada' })).toHaveAttribute('aria-pressed', 'true')
    expect(card('uno').getByRole('button', { name: 'Usar «uno» como portada' })).toHaveAttribute('aria-pressed', 'false')
    // The preview uses the cover.
    expect(screen.getByTestId('event-preview').querySelector('img')).toHaveAttribute('src', '/api/media/id-3/thumb')

    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].cover_image_id).toBe('id-3')
  })

  it('makes the first image the cover when the chosen cover is removed', async () => {
    const { posted } = setup()
    const uploads = mockUploads()
    const user = userEvent.setup()
    renderApp('/admin/events/new')
    await fillRequired(user)
    await chooseFiles(user, [photo('uno.jpg'), photo('dos.jpg'), photo('tres.jpg')])
    await act(async () => uploads.calls.forEach((call, index) => call.resolve(imageOut(`id-${index + 1}`, call.file.name.replace('.jpg', '')))))
    await waitFor(() => expect(grid().querySelectorAll('[role="progressbar"]')).toHaveLength(0))

    await user.click(card('dos').getByRole('button', { name: 'Usar «dos» como portada' }))
    await user.click(card('dos').getByRole('button', { name: 'Quitar «dos»' }))
    expect(cardOrder()).toEqual(['uno', 'tres'])
    expect(card('uno').getByRole('button', { name: '«uno» es la portada' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].images?.map((image) => image.id)).toEqual(['id-1', 'id-3'])
    expect(posted[0].cover_image_id).toBe('id-1')
  })

  it('renames images from the name popover', async () => {
    const event = eventOut()
    let saved: EventIn | null = null
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events/7': event,
      'GET /api/admin/events': eventPage([]),
      'PUT /api/admin/events/7': ({ body }: { body: EventIn }) => {
        saved = body
        return { ...event, version: 4 }
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/events/7')
    await screen.findByRole('grid', { name: 'Fotos y vídeos del evento' })

    await user.click(card('Salón').getByRole('button', { name: 'Cambiar el nombre de «Salón»' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nombre de la imagen' })
    const field = within(dialog).getByRole('textbox', { name: 'Nombre de la imagen' })
    expect(field).toHaveValue('Salón')
    await user.clear(field)
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(within(dialog).getByText('Escribe un nombre.')).toBeInTheDocument()
    await user.type(field, 'Comedor de casa{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nombre de la imagen' })).not.toBeInTheDocument())
    expect(cardOrder()).toEqual(['Comedor de casa', 'Sofá'])

    // The rename form never submits the event form.
    expect(saved).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved).toMatchObject({
      images: [
        { id: event.images[0].id, name: 'Comedor de casa' },
        { id: event.images[1].id, name: 'Sofá' },
      ],
      cover_image_id: event.images[1].id,
    })
  })

  it('reorders images with the keyboard (drag handle)', async () => {
    const event = eventOut({
      images: [imageOut('i-1', 'Uno'), imageOut('i-2', 'Dos'), imageOut('i-3', 'Tres')],
      cover_image_id: 'i-1',
    })
    let saved: EventIn | null = null
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/events/7': event,
      'GET /api/admin/events': eventPage([]),
      'PUT /api/admin/events/7': ({ body }: { body: EventIn }) => {
        saved = body
        return { ...event, version: 4 }
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/events/7')
    await screen.findByRole('grid', { name: 'Fotos y vídeos del evento' })
    expect(cardOrder()).toEqual(['Uno', 'Dos', 'Tres'])

    const handle = card('Uno').getByRole('button', { name: 'Arrastrar Uno' })
    act(() => handle.focus())
    // Enter starts a keyboard drag; each arrow moves the drop position one slot; Enter drops.
    // React Aria installs its drag key handlers and focuses the first drop position on the next
    // animation frame, so each key waits for the drop position it expects to be focused.
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedDropPosition()).toBe('Insertar entre Uno y Dos'))
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(focusedDropPosition()).toBe('Insertar entre Dos y Tres'))
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(focusedDropPosition()).toBe('Insertar después de Tres'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(cardOrder()).toEqual(['Dos', 'Tres', 'Uno']))
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved).toMatchObject({ images: [{ id: 'i-2' }, { id: 'i-3' }, { id: 'i-1' }], cover_image_id: 'i-1' })
  })
})

describe('videos and Live Photos', () => {
  it('uploads videos and Live Photos (paired by name), follows the conversion and saves the Live choice', async () => {
    let polls = 0
    const { posted } = setup({
      'GET /api/admin/uploads/vid-1': () => {
        polls += 1
        return { ...videoOut('vid-1', 'paseo'), progress: null }
      },
      'GET /api/admin/uploads/live-1': { ...videoOut('live-1', 'IMG_0001', { kind: 'image', duration: 2.5, live: true }), progress: null },
    })
    const uploads = mockUploads()
    const user = userEvent.setup()
    renderApp('/admin/events/new')
    await fillRequired(user)
    await chooseFiles(user, [photo('paseo.mp4', 'video/mp4'), photo('IMG_0001.HEIC', ''), photo('IMG_0001.MOV', 'video/quicktime')])

    // The photo and the clip of the Live Photo travel together; nothing else is paired.
    expect(uploads.calls.map((call) => [call.file.name, (call.options?.extraFiles?.motion as File | undefined)?.name ?? null])).toEqual([
      ['paseo.mp4', null],
      ['IMG_0001.HEIC', 'IMG_0001.MOV'],
    ])
    expect(cardOrder()).toEqual(['paseo', 'IMG_0001'])
    const live = card('IMG_0001').getByRole('button', { name: 'Foto Live «IMG_0001»: mostrar con movimiento' })
    expect(live).toHaveAttribute('aria-pressed', 'true')

    // Uploaded: the server converts the videos afterwards (saving is allowed meanwhile).
    await act(async () => {
      uploads.calls[0].resolve({ ...videoOut('vid-1', 'paseo', { video_status: 'processing', video_url: null }), progress: 0.25 } as ImageOut)
      uploads.calls[1].resolve({ ...videoOut('live-1', 'IMG_0001', { kind: 'image', video_status: 'processing', video_url: null, duration: 2.5, live: true }), progress: 0 } as ImageOut)
    })
    expect(await card('paseo').findByRole('progressbar', { name: 'Procesando el vídeo de «paseo»' })).toHaveAttribute('aria-valuenow', '25')
    expect(card('paseo').getByText('Procesando…')).toBeInTheDocument()

    await user.click(live)
    expect(card('IMG_0001').getByRole('button', { name: 'Foto Live «IMG_0001»: mostrar con movimiento' })).toHaveAttribute('aria-pressed', 'false')

    // Polled until ready: the video shows its length.
    await waitFor(() => expect(card('paseo').queryByRole('progressbar')).not.toBeInTheDocument(), { timeout: 5000 })
    expect(polls).toBeGreaterThan(0)
    expect(card('paseo').getByText('0:42')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Crear evento' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].images).toEqual([
      { id: 'vid-1', name: 'paseo' },
      { id: 'live-1', name: 'IMG_0001', live: false },
    ])
  })

  it('shows videos that could not be converted as failed, without retry', async () => {
    setup()
    const uploads = mockUploads()
    const user = userEvent.setup()
    renderApp('/admin/events/new')
    await screen.findByRole('heading', { name: 'Fotos y vídeos' })
    await chooseFiles(user, [photo('roto.mov', 'video/quicktime')])
    await act(async () => uploads.calls[0].resolve({ ...videoOut('vid-2', 'roto', { video_status: 'failed', video_url: null }), progress: null } as ImageOut))
    expect(await card('roto').findByText('No se ha podido procesar el vídeo. Quítalo y prueba con otro archivo.')).toBeInTheDocument()
    expect(card('roto').queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
  })
})
