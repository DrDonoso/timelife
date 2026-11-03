import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { UploadOut } from '../../api/schema.gen'
import { MAX_CONCURRENT_UPLOADS, UploadQueue, busyRetryDelay, type UploadRequest } from './uploadQueue'

function image(id: string): UploadOut {
  return {
    id,
    name: id,
    kind: 'image',
    width: 10,
    height: 10,
    dominant_color: '#000000',
    crop: null,
    thumb_url: `/t/${id}`,
    display_url: `/d/${id}`,
    video_status: null,
    video_url: null,
    duration: null,
    live: false,
    progress: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface Call {
  file: File
  request: UploadRequest
  resolve: (value: UploadOut) => void
  reject: (error: unknown) => void
}

function setup(options: { maxBusyRetries?: number } = {}) {
  const calls: Call[] = []
  let active = 0
  let maxActive = 0
  const upload = vi.fn((file: File, request: UploadRequest) => {
    const pending = deferred<UploadOut>()
    active += 1
    maxActive = Math.max(maxActive, active)
    const settle = () => {
      active -= 1
    }
    pending.promise.then(settle, settle)
    calls.push({ file, request, resolve: pending.resolve, reject: pending.reject })
    return pending.promise
  })
  const handlers = {
    onStart: vi.fn(),
    onProgress: vi.fn(),
    onBusy: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
  }
  const wait = vi.fn(() => Promise.resolve())
  const queue = new UploadQueue({ upload, handlers, wait, ...options })
  return { queue, calls, upload, handlers, wait, maxActive: () => maxActive }
}

const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('UploadQueue', () => {
  it('runs at most 3 uploads at a time, in order', async () => {
    const { queue, calls, handlers, maxActive } = setup()
    for (const name of ['a', 'b', 'c', 'd', 'e']) queue.add(name, file(`${name}.jpg`))
    expect(MAX_CONCURRENT_UPLOADS).toBe(3)
    expect(calls.map((call) => call.file.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(queue.activeCount).toBe(3)
    expect(queue.pendingCount).toBe(2)

    calls[1].resolve(image('b'))
    await flush()
    expect(handlers.onSuccess).toHaveBeenCalledWith('b', image('b'))
    expect(calls.map((call) => call.file.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])

    calls[0].reject(new ApiError({ status: 422, code: 'unsupported_image' }))
    calls[2].resolve(image('c'))
    await flush()
    expect(calls).toHaveLength(5)
    calls[3].resolve(image('d'))
    calls[4].resolve(image('e'))
    await flush()
    expect(maxActive()).toBe(3)
    expect(queue.activeCount).toBe(0)
    expect(handlers.onError).toHaveBeenCalledWith('a', expect.objectContaining({ code: 'unsupported_image' }))
  })

  it('reports progress for the running upload', async () => {
    const { queue, calls, handlers } = setup()
    queue.add('a', file('a.jpg'))
    calls[0].request.onProgress(0.4)
    expect(handlers.onStart).toHaveBeenCalledWith('a')
    expect(handlers.onProgress).toHaveBeenCalledWith('a', 0.4)
  })

  it('sends the clip of a Live Photo with its photo, also when retrying', async () => {
    const { queue, calls } = setup()
    const clip = new File(['clip'], 'IMG_1.MOV', { type: 'video/quicktime' })
    queue.add('live', file('IMG_1.jpg'), clip)
    queue.add('plain', file('b.jpg'))
    expect(calls.map((call) => [call.file.name, call.request.motion?.name ?? null])).toEqual([
      ['IMG_1.jpg', 'IMG_1.MOV'],
      ['b.jpg', null],
    ])
    calls[0].reject(new ApiError({ status: 503, code: 'request_busy', retryAfter: 0 }))
    await flush()
    await flush()
    expect(calls[2].request.motion).toBe(clip)
  })

  it('retries 503 request_busy after Retry-After, keeping its slot', async () => {
    const { queue, calls, handlers, wait } = setup()
    queue.add('a', file('a.jpg'))
    calls[0].reject(new ApiError({ status: 503, code: 'request_busy', retryAfter: 2 }))
    await flush()
    expect(handlers.onBusy).toHaveBeenCalledWith('a', 2000)
    expect(wait).toHaveBeenCalledWith(2000, expect.any(AbortSignal))
    expect(calls).toHaveLength(2)
    expect(handlers.onStart).toHaveBeenCalledTimes(2)
    calls[1].resolve(image('a'))
    await flush()
    expect(handlers.onSuccess).toHaveBeenCalledWith('a', image('a'))
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('gives up after too many busy answers', async () => {
    const { queue, calls, handlers } = setup({ maxBusyRetries: 2 })
    queue.add('a', file('a.jpg'))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      calls[attempt].reject(new ApiError({ status: 503, code: 'request_busy' }))
      await flush()
    }
    expect(calls).toHaveLength(3)
    expect(handlers.onBusy).toHaveBeenCalledTimes(2)
    expect(handlers.onError).toHaveBeenCalledWith('a', expect.objectContaining({ code: 'request_busy' }))
  })

  it('does not retry other errors', async () => {
    const { queue, calls, handlers } = setup()
    queue.add('a', file('a.jpg'))
    calls[0].reject(new ApiError({ status: 0, code: 'network' }))
    await flush()
    expect(calls).toHaveLength(1)
    expect(handlers.onError).toHaveBeenCalledWith('a', expect.objectContaining({ code: 'network' }))
  })

  it('cancels running and waiting uploads silently, freeing the slot', async () => {
    const { queue, calls, handlers } = setup()
    for (const name of ['a', 'b', 'c', 'd', 'e']) queue.add(name, file(`${name}.jpg`))
    queue.cancel('e')
    queue.cancel('a')
    expect(calls[0].request.signal.aborted).toBe(true)
    expect(calls.map((call) => call.file.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])
    calls[0].reject(new DOMException('aborted', 'AbortError'))
    await flush()
    expect(handlers.onError).not.toHaveBeenCalled()
    expect(queue.pendingCount).toBe(0)
  })

  it('stops everything on stop() and accepts work again after start()', () => {
    const { queue, calls } = setup()
    queue.add('a', file('a.jpg'))
    queue.stop()
    expect(calls[0].request.signal.aborted).toBe(true)
    queue.add('b', file('b.jpg'))
    expect(calls).toHaveLength(1)
    queue.start()
    queue.add('c', file('c.jpg'))
    expect(calls).toHaveLength(2)
  })
})

describe('busyRetryDelay', () => {
  it('uses Retry-After (bounded) or an exponential backoff', () => {
    expect(busyRetryDelay(new ApiError({ status: 503, code: 'request_busy', retryAfter: 1 }), 1)).toBe(1000)
    expect(busyRetryDelay(new ApiError({ status: 503, code: 'request_busy', retryAfter: 0 }), 1)).toBe(500)
    expect(busyRetryDelay(new ApiError({ status: 503, code: 'request_busy', retryAfter: 600 }), 1)).toBe(60_000)
    const busy = new ApiError({ status: 503, code: 'request_busy' })
    expect([1, 2, 3, 4, 5].map((attempt) => busyRetryDelay(busy, attempt))).toEqual([1000, 2000, 4000, 8000, 8000])
  })
})
