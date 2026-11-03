/**
 * HTTP client for the Timelife API (same origin; the session cookie travels automatically).
 *
 * - Paths follow spec 20-api (`/api/children`); the `/api` prefix is optional (`/children` works).
 * - Mutations send the CSRF header `X-Timelife-Request: 1` (the backend also checks `Origin`).
 * - Non-2xx responses throw {@link ApiError} with the backend `code` (`{"code", "fields"?, "detail"?}`);
 *   network failures throw code `network`. Aborts reject with the native `AbortError`.
 * - A 401 from any non-auth endpoint notifies the listeners registered with {@link onUnauthorized}
 *   (the app invalidates the session query and shows the login page).
 */

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Readonly<Record<string, QueryValue | readonly QueryValue[]>>

export interface RequestOptions {
  /** Query string; arrays repeat the key (`category_id=1&category_id=2`); null/undefined/'' are skipped. */
  params?: QueryParams
  signal?: AbortSignal
}

export interface UploadOptions extends RequestOptions {
  /** Called with the sent fraction (0..1) and raw byte counts while the file uploads. */
  onProgress?: (fraction: number, progress: { loaded: number; total: number }) => void
  /** Multipart field name (default `file`). */
  fieldName?: string
  /** More multipart files, by field name, sent after the file (e.g. a Live Photo's `motion`). */
  extraFiles?: Readonly<Record<string, Blob>>
}

export interface BinaryOptions extends RequestOptions {
  /** Called with the bytes of the body sent so far. */
  onProgress?: (loaded: number, total: number) => void
}

export interface ApiErrorInit {
  status: number
  code: string
  fields?: Record<string, string>
  detail?: Record<string, unknown>
  /** Seconds from the `Retry-After` header of a 429/503 response. */
  retryAfter?: number
}

export class ApiError extends Error {
  /** HTTP status (0 for network failures). */
  readonly status: number
  /** Backend error code (spec 20-api), `network` or `unknown`. Translate with `errors.<code>`. */
  readonly code: string
  /** `invalid_request` details: field name → pydantic error type. */
  readonly fields?: Record<string, string>
  readonly detail?: Record<string, unknown>
  /** Seconds to wait before retrying (`Retry-After` of 429/503 responses, e.g. `request_busy`). */
  readonly retryAfter?: number

  constructor({ status, code, fields, detail, retryAfter }: ApiErrorInit) {
    super(`${code} (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    if (fields) this.fields = fields
    if (detail) this.detail = detail
    if (retryAfter !== undefined) this.retryAfter = retryAfter
  }
}

/** `Retry-After` value (delta-seconds or HTTP-date) → whole seconds; undefined when absent/invalid. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000))
}

function retryAfterOf(status: number, header: () => string | null): number | undefined {
  return status === 429 || status === 503 ? parseRetryAfter(header()) : undefined
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export const CSRF_HEADER = 'X-Timelife-Request'

type UnauthorizedListener = () => void
const unauthorizedListeners = new Set<UnauthorizedListener>()

/** Registers a callback for 401 responses outside `/api/auth/*`; returns the unsubscribe function. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

export function apiPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized === '/api' || normalized.startsWith('/api/') ? normalized : `/api${normalized}`
}

export function buildUrl(path: string, params?: QueryParams): string {
  const url = apiPath(path)
  if (!params) return url
  const search = new URLSearchParams()
  for (const [key, raw] of Object.entries(params)) {
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values as readonly QueryValue[]) {
      if (value === null || value === undefined || value === '') continue
      search.append(key, String(value))
    }
  }
  const query = search.toString()
  if (!query) return url
  return `${url}${url.includes('?') ? '&' : '?'}${query}`
}

function handleUnauthorized(status: number, url: string) {
  if (status !== 401 || url.startsWith('/api/auth/')) return
  for (const listener of unauthorizedListeners) listener()
}

function fallbackCode(status: number, upload: boolean): string {
  if (status === 413) return upload ? 'upload_too_large' : 'request_too_large'
  if (status === 404) return 'not_found'
  if (status === 429) return 'request_throttled'
  if (status === 408 || status === 504) return 'request_timeout'
  if (status === 502 || status === 503) return 'request_busy'
  return 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Builds the ApiError for a non-2xx response from its (possibly non-JSON) body. */
export function toApiError(status: number, payload: unknown, upload = false, retryAfter?: number): ApiError {
  const body = isRecord(payload) ? payload : {}
  const code = typeof body.code === 'string' && body.code ? body.code : fallbackCode(status, upload)
  const fields = isRecord(body.fields)
    ? Object.fromEntries(
        Object.entries(body.fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : undefined
  const detail = isRecord(body.detail) ? body.detail : undefined
  return new ApiError({ status, code, fields, detail, retryAfter })
}

function parseJson(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

async function request<T>(method: string, path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, options.params)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET' && method !== 'HEAD') headers[CSRF_HEADER] = '1'
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: payload,
      credentials: 'same-origin',
      signal: options.signal,
    })
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) throw error
    throw new ApiError({ status: 0, code: 'network' })
  }

  const text = response.status === 204 ? '' : await response.text().catch(() => '')
  if (!response.ok) {
    handleUnauthorized(response.status, url)
    const retryAfter = retryAfterOf(response.status, () => response.headers.get('Retry-After'))
    throw toApiError(response.status, parseJson(text), false, retryAfter)
  }
  return parseJson(text) as T
}

interface XhrOptions extends RequestOptions {
  onProgress?: (loaded: number, total: number) => void
  contentType?: string
}

/** Sends `body` with XHR (fetch cannot report upload progress); `size` is its byte length. */
function sendXhr<T>(method: string, path: string, body: XMLHttpRequestBodyInit, size: number, options: XhrOptions): Promise<T> {
  const url = buildUrl(path, options.params)
  return new Promise<T>((resolve, reject) => {
    const { signal } = options
    if (signal?.aborted) {
      reject(new DOMException('The upload was aborted.', 'AbortError'))
      return
    }
    const xhr = new XMLHttpRequest()
    const onAbort = () => xhr.abort()
    const cleanup = () => signal?.removeEventListener('abort', onAbort)

    xhr.open(method, url)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.setRequestHeader(CSRF_HEADER, '1')
    if (options.contentType) xhr.setRequestHeader('Content-Type', options.contentType)
    xhr.upload.addEventListener('progress', (event) => {
      if (!options.onProgress) return
      options.onProgress(event.loaded, event.lengthComputable ? event.total : size)
    })
    xhr.addEventListener('load', () => {
      cleanup()
      const payload = parseJson(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(size, size)
        resolve(payload as T)
        return
      }
      handleUnauthorized(xhr.status, url)
      reject(toApiError(xhr.status, payload, true, retryAfterOf(xhr.status, () => xhr.getResponseHeader('Retry-After'))))
    })
    xhr.addEventListener('error', () => {
      cleanup()
      reject(new ApiError({ status: 0, code: 'network' }))
    })
    xhr.addEventListener('timeout', () => {
      cleanup()
      reject(new ApiError({ status: 0, code: 'request_timeout' }))
    })
    xhr.addEventListener('abort', () => {
      cleanup()
      reject(new DOMException('The upload was aborted.', 'AbortError'))
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.send(body)
  })
}

function upload<T>(path: string, file: Blob, options: UploadOptions = {}): Promise<T> {
  const extras = Object.entries(options.extraFiles ?? {})
  const size = extras.reduce((sum, [, blob]) => sum + blob.size, file.size)
  const form = new FormData()
  const name = file instanceof File ? file.name : 'upload'
  form.append(options.fieldName ?? 'file', file, name)
  for (const [field, blob] of extras) form.append(field, blob, blob instanceof File ? blob.name : field)
  const { onProgress } = options
  return sendXhr<T>('POST', path, form, size, {
    params: options.params,
    signal: options.signal,
    onProgress: onProgress
      ? (loaded, total) => onProgress(total > 0 ? Math.min(1, loaded / total) : 0, { loaded, total })
      : undefined,
  })
}

/** `PUT` of raw bytes (`application/octet-stream`), e.g. a piece of a file. */
function putBinary<T>(path: string, body: Blob, options: BinaryOptions = {}): Promise<T> {
  return sendXhr<T>('PUT', path, body, body.size, { ...options, contentType: 'application/octet-stream' })
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T = void>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  put: <T = void>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, body, options),
  patch: <T = void>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  del: <T = void>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
  /** Multipart upload through XHR (fetch cannot report upload progress). */
  upload,
  /** Raw bytes through XHR, with upload progress. */
  putBinary,
}
