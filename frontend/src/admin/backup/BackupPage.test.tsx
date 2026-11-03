import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupSummaryOut, ImportOut, ImportReportOut } from '../../api/schema.gen'
import { ADMIN_SESSION, mockSignedIn, preloadLazyRoutes, renderApp, reply } from '../../utils/test-utils'
import { FakeXhr, sentBodies } from '../categories/testing'

beforeAll(preloadLazyRoutes)

beforeEach(() => {
  FakeXhr.instances = []
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

const ID = 'f'.repeat(32)
const IMPORTS = '/api/admin/backup/imports'
const LAST_MODIFIED = 1700000000000

function summary(changes: Partial<BackupSummaryOut> = {}): BackupSummaryOut {
  return {
    events: 120,
    trashed_events: 3,
    photos: 850,
    live_photos: 20,
    videos: 40,
    children: 2,
    categories: 12,
    users: 6,
    admins: 2,
    year_colors: 1,
    background: true,
    media_bytes: 6.2 * 1024 ** 3,
    ...changes,
  }
}

function session(changes: Partial<ImportOut> = {}): ImportOut {
  return {
    id: ID,
    status: 'uploading',
    filename: 'copia.zip',
    size: 10,
    received: 0,
    last_modified: LAST_MODIFIED,
    chunk_size: 4,
    archive: null,
    mode: null,
    progress: null,
    report: null,
    error: null,
    created_at: '2026-10-23T08:00:00Z',
    updated_at: '2026-10-23T08:00:00Z',
    ...changes,
  }
}

function ready(changes: Partial<ImportOut> = {}): ImportOut {
  return session({
    status: 'ready',
    received: 10,
    archive: {
      exported_at: '2026-10-20T10:00:00Z',
      app_version: '20261020',
      missing_files: 0,
      summary: summary({ events: 7, trashed_events: 0, photos: 9, live_photos: 0, videos: 1, background: false }),
    },
    ...changes,
  })
}

function report(changes: Partial<ImportReportOut> = {}): ImportReportOut {
  const counts = (created: number, skipped: number, failed = 0) => ({ created, skipped, failed })
  return {
    mode: 'merge',
    users: counts(1, 5),
    categories: counts(0, 12),
    children: counts(0, 2),
    events: counts(2, 118, 1),
    media: counts(4, 900, 1),
    year_colors: counts(0, 1),
    issues: [
      { kind: 'media', name: 'Primeros pasos · Andando', code: 'import_file_missing' },
      { kind: 'event', name: 'Primer diente', code: 'invalid_child' },
    ],
    more_issues: 3,
    finished_at: '2026-10-23T09:00:00Z',
    ...changes,
  }
}

function zip(name = 'copia.zip', lastModified = LAST_MODIFIED) {
  return new File(['0123456789'], name, { type: 'application/zip', lastModified })
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('No file input')
  return input
}

async function nextPiece(count: number): Promise<FakeXhr> {
  await waitFor(() => expect(FakeXhr.instances).toHaveLength(count))
  return FakeXhr.last
}

describe('BackupPage', () => {
  it('shows what an export holds and links to the download', async () => {
    mockSignedIn(ADMIN_SESSION, { 'GET /api/admin/backup/summary': summary(), [`GET ${IMPORTS}`]: [] })
    renderApp('/admin/backup')
    const contents = await screen.findByRole('list', { name: 'Contenido de la copia' })
    expect(within(contents).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '120 hitos',
      '3 en la papelera',
      '850 fotos (20 Live)',
      '40 vídeos',
      '2 niños',
      '12 categorías',
      '6 usuarios (2 administradores)',
      '1 color de año',
      'Imagen de fondo',
      '≈ 6,2 GB',
    ])
    const download = screen.getByRole('link', { name: 'Descargar copia' })
    expect(download).toHaveAttribute('href', '/api/admin/backup/export')
    expect(download).toHaveAttribute('download')
    expect(screen.getByRole('link', { name: 'Importar y exportar' })).toHaveAttribute('aria-current', 'page')
    expect(document.title).toBe('Importar y exportar · Administración · Timelife')
  })

  it('uploads a backup in pieces, then merges it and shows the report', async () => {
    let current: ImportOut[] = []
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/backup/summary': summary(),
      [`GET ${IMPORTS}`]: () => current,
      [`POST ${IMPORTS}`]: () => {
        current = [session()]
        return reply(201, current[0])
      },
      [`POST ${IMPORTS}/${ID}/start`]: () => {
        current = [session({ ...ready(), status: 'running', mode: 'merge', progress: { phase: 'media', done: 3, total: 10 } })]
        return current[0]
      },
      [`DELETE ${IMPORTS}/${ID}`]: () => {
        current = []
        return reply(204)
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/backup')
    await screen.findByRole('button', { name: 'Elegir archivo ZIP' })
    await user.upload(fileInput(), zip())
    expect(sentBodies(fetchMock, 'POST', IMPORTS)).toEqual([{ filename: 'copia.zip', size: 10, last_modified: LAST_MODIFIED }])

    let xhr = await nextPiece(1)
    expect([xhr.method, xhr.url]).toEqual(['PUT', `${IMPORTS}/${ID}/content?offset=0`])
    expect(xhr.requestHeaders['Content-Type']).toBe('application/octet-stream')
    expect(await (xhr.body as Blob).text()).toBe('0123')
    act(() => xhr.progress(2, 4))
    expect(screen.getByRole('progressbar', { name: 'Subiendo «copia.zip»' })).toHaveAttribute('aria-valuetext', '2 B de 10 B')
    act(() => xhr.respond(200, session({ received: 4 })))
    xhr = await nextPiece(2)
    expect(xhr.url).toBe(`${IMPORTS}/${ID}/content?offset=4`)
    act(() => xhr.respond(200, session({ received: 8 })))
    xhr = await nextPiece(3)
    expect(await (xhr.body as Blob).text()).toBe('89')
    act(() => xhr.respond(200, ready()))

    expect(await screen.findByText('Copia del 20 de octubre de 2026')).toBeInTheDocument()
    expect(screen.getByText(/Hecha con Timelife 20261020/)).toBeInTheDocument()
    const contents = screen.getByRole('list', { name: 'Contenido del archivo' })
    expect(within(contents).getByText('7 hitos')).toBeInTheDocument()
    const modes = screen.getByRole('radiogroup', { name: '¿Cómo quieres importarla?' })
    expect(within(modes).getByRole('radio', { name: /Fusionar/ })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Importar' }))
    expect(sentBodies(fetchMock, 'POST', `${IMPORTS}/${ID}/start`)).toEqual([{ mode: 'merge' }])
    expect(await screen.findByRole('progressbar', { name: 'Procesando fotos y vídeos…' })).toHaveAttribute(
      'aria-valuetext',
      '3 de 10',
    )
    expect(screen.getByText('Puedes salir de esta página: la importación sigue en el servidor.')).toBeInTheDocument()

    current = [session({ ...ready(), status: 'finished', mode: 'merge', report: report() })]
    expect(await screen.findByText('Importación terminada', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText('Se ha fusionado la copia con lo que ya había.')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Resultado de la importación' })
    const events = within(table).getByRole('row', { name: /Hitos/ })
    expect(within(events).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '118', '1'])
    expect(screen.getByText('Foto o vídeo «Primeros pasos · Andando»: Falta su archivo en la copia.')).toBeInTheDocument()
    expect(screen.getByText('Hito «Primer diente»: Alguno de los niños seleccionados ya no existe.')).toBeInTheDocument()
    expect(screen.getByText('Y 3 más.')).toBeInTheDocument()
    // The whole app refreshes once the run is over.
    await waitFor(() => expect(sentBodies(fetchMock, 'GET', '/api/admin/backup/summary').length).toBeGreaterThan(1))

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(await screen.findByRole('button', { name: 'Elegir archivo ZIP' })).toBeInTheDocument()
  })

  it('replaces everything only after a confirmation', async () => {
    let current: ImportOut[] = [ready({ error: 'import_interrupted' })]
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/backup/summary': summary(),
      [`GET ${IMPORTS}`]: () => current,
      [`POST ${IMPORTS}/${ID}/start`]: () => {
        current = [session({ ...ready(), status: 'running', mode: 'replace', progress: { phase: 'saving', done: 0, total: 0 } })]
        return current[0]
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/backup')
    expect(
      await screen.findByText(
        'La última importación no terminó: El servidor se reinició mientras importaba. No se ha cambiado nada; puedes volver a intentarlo.',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Reemplazar todo/ }))
    await user.click(screen.getByRole('button', { name: 'Importar' }))
    const dialog = await screen.findByRole('alertdialog', { name: '¿Reemplazar todo?' })
    expect(dialog).toHaveTextContent('se sustituirá por la copia del 20 de octubre de 2026')
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(sentBodies(fetchMock, 'POST', `${IMPORTS}/${ID}/start`)).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Importar' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reemplazar todo' }))
    expect(sentBodies(fetchMock, 'POST', `${IMPORTS}/${ID}/start`)).toEqual([{ mode: 'replace' }])
    expect(await screen.findByRole('progressbar', { name: 'Guardando los cambios…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar importación' })).toBeDisabled()
  })

  it('goes on with an upload left half-way, only with the same file', async () => {
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/backup/summary': summary(),
      [`GET ${IMPORTS}`]: [session({ received: 4 })],
    })
    const user = userEvent.setup()
    renderApp('/admin/backup')
    expect(await screen.findByText('Subida a medias')).toBeInTheDocument()
    expect(screen.getByText('«copia.zip» se quedó a medias (4 B de 10 B). Elige el mismo archivo para seguir donde se quedó.')).toBeInTheDocument()
    await user.upload(fileInput(), zip('otra.zip'))
    expect(await screen.findByText('Ese no es el archivo que se estaba subiendo. Elige «copia.zip» o descarta la subida.')).toBeInTheDocument()
    expect(FakeXhr.instances).toHaveLength(0)
    await user.upload(fileInput(), zip())
    const xhr = await nextPiece(1)
    expect(xhr.url).toBe(`${IMPORTS}/${ID}/content?offset=4`)
  })

  it('explains why a file cannot be imported and discards it', async () => {
    let current: ImportOut[] = [session({ status: 'invalid', received: 10, error: 'import_version_unsupported' })]
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/backup/summary': summary(),
      [`GET ${IMPORTS}`]: () => current,
      [`DELETE ${IMPORTS}/${ID}`]: () => {
        current = []
        return reply(204)
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/backup')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se puede importar «copia.zip»')
    expect(alert).toHaveTextContent('La copia se hizo con una versión más nueva de Timelife.')
    await user.click(within(alert).getByRole('button', { name: 'Descartar' }))
    expect(await screen.findByRole('button', { name: 'Elegir archivo ZIP' })).toBeInTheDocument()
  })

  it('cancelling an upload discards what was sent', async () => {
    let current: ImportOut[] = []
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/backup/summary': summary(),
      [`GET ${IMPORTS}`]: () => current,
      [`POST ${IMPORTS}`]: () => {
        current = [session()]
        return reply(201, current[0])
      },
      [`DELETE ${IMPORTS}/${ID}`]: () => {
        current = []
        return reply(204)
      },
    })
    const user = userEvent.setup()
    renderApp('/admin/backup')
    await screen.findByRole('button', { name: 'Elegir archivo ZIP' })
    await user.upload(fileInput(), zip())
    await nextPiece(1)
    await user.click(screen.getByRole('button', { name: 'Cancelar subida' }))
    expect(await screen.findByRole('button', { name: 'Elegir archivo ZIP' })).toBeInTheDocument()
    const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports why an import could not start', async () => {
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/admin/backup/summary': summary(),
      [`GET ${IMPORTS}`]: [],
      [`POST ${IMPORTS}`]: reply(507, { code: 'import_no_space', detail: { required: 1, available: 0 } }),
    })
    const user = userEvent.setup()
    renderApp('/admin/backup')
    await screen.findByRole('button', { name: 'Elegir archivo ZIP' })
    await user.upload(fileInput(), zip())
    expect(await screen.findByText('No hay espacio libre suficiente en el servidor para esta copia.')).toBeInTheDocument()
    expect(FakeXhr.instances).toHaveLength(0)
  })
})
