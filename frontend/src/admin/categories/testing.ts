// Test-only helpers shared by the admin settings page tests (imported from *.test.tsx files only).
import type { Mock } from 'vitest'
import type { ImageOut } from '../../api/schema.gen'

type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>

/** JSON bodies sent to `METHOD /api/path` (query string ignored), in call order. */
export function sentBodies(fetchMock: FetchMock, method: string, path: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      return (init?.method ?? 'GET').toUpperCase() === method && url.pathname === path
    })
    .map(([, init]) => (typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body))
}

/**
 * Minimal XMLHttpRequest for `api.upload`: tests drive progress and the answer by hand.
 * Install with `vi.stubGlobal('XMLHttpRequest', FakeXhr)` and reset `FakeXhr.instances`.
 */
export class FakeXhr {
  static instances: FakeXhr[] = []

  method = ''
  url = ''
  status = 0
  responseText = ''
  body: unknown = null
  requestHeaders: Record<string, string> = {}
  responseHeaders: Record<string, string> = {}
  readonly upload = new EventTarget()
  private readonly events = new EventTarget()

  constructor() {
    FakeXhr.instances.push(this)
  }

  static get last(): FakeXhr {
    const xhr = FakeXhr.instances.at(-1)
    if (!xhr) throw new Error('No upload was started')
    return xhr
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.events.addEventListener(type, listener)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.events.removeEventListener(type, listener)
  }

  send(body: unknown) {
    this.body = body
  }

  abort() {
    this.events.dispatchEvent(new Event('abort'))
  }

  /** Reports `loaded` of `total` bytes sent. */
  progress(loaded: number, total: number) {
    this.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded, total }))
  }

  respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
    this.status = status
    this.responseText = body === undefined ? '' : JSON.stringify(body)
    this.responseHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
    this.events.dispatchEvent(new Event('load'))
  }

  fail() {
    this.events.dispatchEvent(new Event('error'))
  }
}

/** An `ImageOut` as the upload endpoint returns it. */
export function imageOut(id: string, name = 'foto'): ImageOut {
  return {
    id,
    name,
    kind: 'image',
    width: 800,
    height: 600,
    dominant_color: '#c08070',
    crop: null,
    thumb_url: `/api/media/${id}/thumb`,
    display_url: `/api/media/${id}/display`,
    video_status: null,
    video_url: null,
    duration: null,
    live: false,
  }
}
