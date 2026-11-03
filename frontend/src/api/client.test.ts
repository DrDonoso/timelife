import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, buildUrl, isApiError, onUnauthorized, parseRetryAfter, toApiError } from './client'

function jsonResponse(status: number, body?: unknown, contentType = 'application/json') {
  return new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  })
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function stubFetch(response: Response | (() => Promise<Response>)) {
  const fetchMock = vi.fn<FetchFn>(typeof response === 'function' ? response : async () => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function headersOf(fetchMock: ReturnType<typeof stubFetch>, call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>
}

describe('URLs', () => {
  it('accepts paths with or without the /api prefix', () => {
    expect(buildUrl('/api/children')).toBe('/api/children')
    expect(buildUrl('/children')).toBe('/api/children')
    expect(buildUrl('children')).toBe('/api/children')
  })

  it('encodes params, repeating arrays and skipping empty values', () => {
    expect(
      buildUrl('/api/children/1/timeline', { q: 'primeros pasos', date_from: null, date_to: undefined, category_id: [1, 2], page: '' }),
    ).toBe('/api/children/1/timeline?q=primeros+pasos&category_id=1&category_id=2')
    expect(buildUrl('/api/x', { a: false, b: 0 })).toBe('/api/x?a=false&b=0')
  })
})

describe('requests', () => {
  it('GET sends JSON accept, same-origin credentials and no CSRF header', async () => {
    const fetchMock = stubFetch(jsonResponse(200, [{ id: 1 }]))
    await expect(api.get('/api/children', { params: { q: 'a' } })).resolves.toEqual([{ id: 1 }])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/children?q=a')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
    expect(headersOf(fetchMock)).toEqual({ Accept: 'application/json' })
  })

  it('mutations send the CSRF header and a JSON body', async () => {
    const fetchMock = stubFetch(jsonResponse(201, { id: 7 }))
    await expect(api.post('/api/admin/children', { name: 'Ana' })).resolves.toEqual({ id: 7 })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"name":"Ana"}')
    expect(headersOf(fetchMock)).toMatchObject({ 'X-Timelife-Request': '1', 'Content-Type': 'application/json' })
  })

  it.each([
    ['put', 'PUT'],
    ['patch', 'PATCH'],
  ] as const)('%s uses %s with CSRF', async (method, verb) => {
    const fetchMock = stubFetch(jsonResponse(200, { ok: true }))
    await api[method]('/api/admin/users/1', { role: 'viewer' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe(verb)
    expect(headersOf(fetchMock)['X-Timelife-Request']).toBe('1')
  })

  it('DELETE without body resolves undefined on 204', async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }))
    await expect(api.del('/api/admin/events/3')).resolves.toBeUndefined()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
    expect(headersOf(fetchMock)['X-Timelife-Request']).toBe('1')
    expect(headersOf(fetchMock)['Content-Type']).toBeUndefined()
  })
})

describe('errors', () => {
  it('maps the backend error payload to ApiError', async () => {
    stubFetch(jsonResponse(422, { code: 'invalid_request', fields: { title: 'string_too_long', bad: 3 }, detail: { events: 2 } }))
    const error = await api.post('/api/admin/events', {}).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'invalid_request', fields: { title: 'string_too_long' }, detail: { events: 2 } })
    expect(isApiError(error, 'invalid_request')).toBe(true)
    expect(isApiError(error, 'other')).toBe(false)
  })

  it('falls back to status-based codes for non-JSON errors', () => {
    expect(toApiError(500, undefined).code).toBe('unknown')
    expect(toApiError(413, undefined).code).toBe('request_too_large')
    expect(toApiError(413, undefined, true).code).toBe('upload_too_large')
    expect(toApiError(404, '<html>').code).toBe('not_found')
    expect(toApiError(502, undefined).code).toBe('request_busy')
    expect(toApiError(504, undefined).code).toBe('request_timeout')
  })

  it('handles HTML error pages from proxies', async () => {
    stubFetch(jsonResponse(502, '<html>Bad gateway</html>', 'text/html'))
    await expect(api.get('/api/children')).rejects.toMatchObject({ status: 502, code: 'request_busy' })
  })

  it('reports network failures with code "network"', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(api.get('/api/children')).rejects.toMatchObject({ status: 0, code: 'network' })
  })

  it('propagates aborts untouched', async () => {
    const controller = new AbortController()
    stubFetch(() => {
      controller.abort()
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    })
    const error = await api.get('/api/children', { signal: controller.signal }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
  })
})

describe('401 handling', () => {
  const listener = vi.fn()
  let unsubscribe: () => void = () => {}

  afterEach(() => unsubscribe())

  it('notifies listeners on 401 outside /api/auth', async () => {
    unsubscribe = onUnauthorized(listener)
    stubFetch(jsonResponse(401, { code: 'authentication_required' }))
    await expect(api.get('/api/children')).rejects.toMatchObject({ code: 'authentication_required' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores 401 from auth endpoints (e.g. wrong dev-login password)', async () => {
    unsubscribe = onUnauthorized(listener)
    stubFetch(jsonResponse(401, { code: 'invalid_credentials' }))
    await expect(api.post('/api/auth/dev-login', {})).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', async () => {
    onUnauthorized(listener)()
    stubFetch(jsonResponse(401, { code: 'authentication_required' }))
    await api.get('/api/children').catch(() => undefined)
    expect(listener).not.toHaveBeenCalled()
  })
})

class FakeXhr {
  static last: FakeXhr | null = null
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: FormData | Blob | null = null
  status = 0
  responseText = ''
  private listeners: Record<string, Array<(event?: unknown) => void>> = {}
  upload = {
    listeners: [] as Array<(event: { loaded: number; total: number; lengthComputable: boolean }) => void>,
    addEventListener: (_type: string, listener: (event: { loaded: number; total: number; lengthComputable: boolean }) => void) => {
      this.upload.listeners.push(listener)
    },
  }

  constructor() {
    FakeXhr.last = this
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  addEventListener(type: string, listener: (event?: unknown) => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }

  send(body: FormData | Blob) {
    this.body = body
  }

  abort() {
    this.emit('abort')
  }

  progress(loaded: number, total: number) {
    for (const listener of this.upload.listeners) listener({ loaded, total, lengthComputable: true })
  }

  respond(status: number, body: string) {
    this.status = status
    this.responseText = body
    this.emit('load')
  }

  emit(type: string) {
    for (const listener of this.listeners[type] ?? []) listener()
  }
}

describe('upload', () => {
  it('posts multipart through XHR with progress and the CSRF header', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const onProgress = vi.fn()
    const file = new File(['hello'], 'foto.jpg', { type: 'image/jpeg' })
    const promise = api.upload<{ id: string }>('/api/admin/uploads', file, { params: { purpose: 'event' }, onProgress })
    const xhr = FakeXhr.last as FakeXhr
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/admin/uploads?purpose=event')
    expect(xhr.headers['X-Timelife-Request']).toBe('1')
    expect(((xhr.body as FormData).get('file') as File).name).toBe('foto.jpg')
    xhr.progress(2, 4)
    expect(onProgress).toHaveBeenLastCalledWith(0.5, { loaded: 2, total: 4 })
    xhr.respond(201, '{"id":"abc"}')
    await expect(promise).resolves.toEqual({ id: 'abc' })
    expect(onProgress).toHaveBeenLastCalledWith(1, expect.anything())
  })

  it('sends extra files (a Live Photo’s clip) in the same body, counted in the progress', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const onProgress = vi.fn()
    const still = new File(['photo'], 'IMG_1.HEIC')
    const motion = new File(['the clip'], 'IMG_1.MOV', { type: 'video/quicktime' })
    const promise = api.upload('/api/admin/uploads', still, { extraFiles: { motion }, onProgress })
    const xhr = FakeXhr.last as FakeXhr
    const body = xhr.body as FormData
    expect([(body.get('file') as File).name, (body.get('motion') as File).name]).toEqual(['IMG_1.HEIC', 'IMG_1.MOV'])
    xhr.respond(201, '{}')
    await promise
    expect(onProgress).toHaveBeenLastCalledWith(1, { loaded: 13, total: 13 })
  })

  it('rejects with ApiError on error statuses (non-JSON 413 → upload_too_large)', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const promise = api.upload('/api/admin/uploads', new Blob(['x']))
    ;(FakeXhr.last as FakeXhr).respond(413, '<html>Too large</html>')
    await expect(promise).rejects.toMatchObject({ status: 413, code: 'upload_too_large' })
  })

  it('aborts with the signal and reports network errors', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const controller = new AbortController()
    const aborted = api.upload('/api/admin/uploads', new Blob(['x']), { signal: controller.signal })
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })

    const failing = api.upload('/api/admin/uploads', new Blob(['x']))
    ;(FakeXhr.last as FakeXhr).emit('error')
    await expect(failing).rejects.toMatchObject({ status: 0, code: 'network' })
  })
})

describe('putBinary', () => {
  it('puts raw bytes through XHR with progress and the CSRF header', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const onProgress = vi.fn()
    const piece = new Blob(['0123456789']).slice(2, 6)
    const promise = api.putBinary<{ received: number }>('/api/admin/backup/imports/abc/content', piece, {
      params: { offset: 2 },
      onProgress,
    })
    const xhr = FakeXhr.last as FakeXhr
    expect(xhr.method).toBe('PUT')
    expect(xhr.url).toBe('/api/admin/backup/imports/abc/content?offset=2')
    expect(xhr.headers).toMatchObject({ 'X-Timelife-Request': '1', 'Content-Type': 'application/octet-stream' })
    expect(xhr.body).toBe(piece)
    xhr.progress(3, 4)
    expect(onProgress).toHaveBeenLastCalledWith(3, 4)
    xhr.respond(200, '{"received":6}')
    await expect(promise).resolves.toEqual({ received: 6 })
    expect(onProgress).toHaveBeenLastCalledWith(4, 4)
  })

  it('rejects with the API error and its detail', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const promise = api.putBinary('/api/admin/backup/imports/abc/content', new Blob(['x']), { params: { offset: 9 } })
    ;(FakeXhr.last as FakeXhr).respond(409, '{"code":"import_offset_mismatch","detail":{"received":4}}')
    await expect(promise).rejects.toMatchObject({ status: 409, code: 'import_offset_mismatch', detail: { received: 4 } })
  })
})

describe('Retry-After', () => {
  it('parses delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3)
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('Wed, 21 Oct 2026 07:27:58 GMT'))).toBe(2)
    expect(parseRetryAfter('soon')).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
  })

  it('exposes the Retry-After of busy (503) responses on the ApiError', async () => {
    stubFetch(new Response(JSON.stringify({ code: 'request_busy' }), { status: 503, headers: { 'Retry-After': '2' } }))
    await expect(api.post('/api/admin/events', {})).rejects.toMatchObject({ code: 'request_busy', retryAfter: 2 })
    stubFetch(jsonResponse(500, { code: 'internal_error' }))
    const error = await api.get('/api/children').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).retryAfter).toBeUndefined()
  })

  it('reads Retry-After from busy uploads', async () => {
    class BusyXhr extends FakeXhr {
      getResponseHeader(name: string) {
        return name.toLowerCase() === 'retry-after' ? '1' : null
      }
    }
    vi.stubGlobal('XMLHttpRequest', BusyXhr)
    const promise = api.upload('/api/admin/uploads', new Blob(['x']), { params: { purpose: 'event' } })
    ;(FakeXhr.last as FakeXhr).respond(503, '{"code":"request_busy"}')
    await expect(promise).rejects.toMatchObject({ status: 503, code: 'request_busy', retryAfter: 1 })
  })
})