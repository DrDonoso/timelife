import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { ImportOut } from '../../api/schema.gen'
import { isSameFile, uploadArchive, type PieceSender } from './chunkedUpload'

function session(changes: Partial<ImportOut> = {}): ImportOut {
  return {
    id: 'a'.repeat(32),
    status: 'uploading',
    filename: 'copia.zip',
    size: 10,
    received: 0,
    last_modified: 1700000000000,
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

const FILE = new Blob(['0123456789'])

/** A server that keeps the pieces it receives (and fails the attempts listed in `failures`). */
function server(failures: Record<number, unknown> = {}) {
  const pieces: Array<{ offset: number; text: string }> = []
  let attempt = 0
  let received = 0
  const send = vi.fn<PieceSender>(async (current, offset, piece, onProgress) => {
    attempt += 1
    const failure = failures[attempt]
    if (failure) throw failure
    onProgress(piece.size / 2)
    pieces.push({ offset, text: await piece.text() })
    received = offset + piece.size
    return { ...current, received, status: received === current.size ? 'ready' : 'uploading' }
  })
  const refresh = vi.fn(async () => session({ received }))
  return { pieces, send, refresh }
}

const noWait = (_ms: number, _signal: AbortSignal) => Promise.resolve()

describe('uploadArchive', () => {
  it('sends the file in pieces from what the server already has, reporting progress', async () => {
    const { pieces, send, refresh } = server()
    const onProgress = vi.fn()
    const done = await uploadArchive({
      file: FILE,
      session: session({ received: 2 }),
      onProgress,
      signal: new AbortController().signal,
      send,
      refresh,
      wait: noWait,
    })
    expect(pieces).toEqual([
      { offset: 2, text: '2345' },
      { offset: 6, text: '6789' },
    ])
    expect(done.status).toBe('ready')
    expect(onProgress.mock.calls.map(([sent]) => sent)).toEqual([2, 4, 6, 8, 10])
    expect(refresh).not.toHaveBeenCalled()
  })

  it('goes on from where the server is after a cut or an offset mismatch', async () => {
    const { pieces, send, refresh } = server({
      2: new ApiError({ status: 0, code: 'network' }),
      4: new ApiError({ status: 409, code: 'import_offset_mismatch', detail: { received: 8 } }),
    })
    const wait = vi.fn(noWait)
    const done = await uploadArchive({
      file: FILE,
      session: session(),
      onProgress: vi.fn(),
      signal: new AbortController().signal,
      send,
      refresh,
      wait,
    })
    expect(done.received).toBe(10)
    expect(wait).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(pieces.map((piece) => piece.offset)).toEqual([0, 4, 8])
  })

  it('waits for busy servers but gives up after too many failures in a row', async () => {
    const busy = new ApiError({ status: 503, code: 'request_busy', retryAfter: 2 })
    const { send, refresh } = server({ 1: busy, 2: busy, 3: busy })
    const wait = vi.fn(noWait)
    const upload = uploadArchive({
      file: FILE,
      session: session(),
      onProgress: vi.fn(),
      signal: new AbortController().signal,
      send,
      refresh,
      wait,
      maxRetries: 2,
    })
    await expect(upload).rejects.toBe(busy)
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([2000, 2000])
  })

  it('stops at once on errors that a retry cannot fix', async () => {
    const full = new ApiError({ status: 507, code: 'import_no_space' })
    const { send, refresh } = server({ 1: full })
    const options = { file: FILE, session: session(), onProgress: vi.fn(), signal: new AbortController().signal, refresh, wait: noWait }
    await expect(uploadArchive({ ...options, send })).rejects.toBe(full)
    const proxy = server({ 1: new ApiError({ status: 413, code: 'upload_too_large' }) })
    await expect(uploadArchive({ ...options, send: proxy.send })).rejects.toMatchObject({ code: 'import_chunk_too_large' })
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    const send = vi.fn<PieceSender>(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    const upload = uploadArchive({ file: FILE, session: session(), onProgress: vi.fn(), signal: controller.signal, send, wait: noWait })
    await expect(upload).rejects.toMatchObject({ name: 'AbortError' })
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('isSameFile', () => {
  it('compares name (as the server keeps it), size and date', () => {
    const file = new File(['0123456789'], 'Copia  de año.zip'.normalize('NFD'), { lastModified: 1700000000000 })
    const current = session({ filename: 'Copia de año.zip' })
    expect(isSameFile(current, file)).toBe(true)
    expect(isSameFile({ ...current, size: 11 }, file)).toBe(false)
    expect(isSameFile({ ...current, last_modified: 5 }, file)).toBe(false)
    expect(isSameFile({ ...current, last_modified: null }, file)).toBe(true)
    expect(isSameFile({ ...current, filename: 'otra.zip' }, file)).toBe(false)
  })
})
