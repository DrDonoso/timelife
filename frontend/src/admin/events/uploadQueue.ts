import { isAbortError, isApiError } from '../../api/client'
import type { UploadOut } from '../../api/schema.gen'

/** The backend accepts 4 concurrent uploads in total; one client never uses more than 3. */
export const MAX_CONCURRENT_UPLOADS = 3
/** `503 request_busy` retries before the upload is reported as failed. */
export const MAX_BUSY_RETRIES = 8

export interface UploadRequest {
  onProgress: (fraction: number) => void
  signal: AbortSignal
  /** Clip of a Live Photo, sent with the photo. */
  motion: File | null
}

export type UploadFn = (file: File, request: UploadRequest) => Promise<UploadOut>

export interface UploadQueueHandlers {
  /** An attempt starts (also after each busy retry). */
  onStart: (key: string) => void
  onProgress: (key: string, fraction: number) => void
  /** The server answered `request_busy`; the upload is retried after `delayMs`. */
  onBusy: (key: string, delayMs: number) => void
  onSuccess: (key: string, image: UploadOut) => void
  onError: (key: string, error: unknown) => void
}

export interface UploadQueueOptions {
  upload: UploadFn
  handlers: UploadQueueHandlers
  concurrency?: number
  maxBusyRetries?: number
  /** Sleep used between busy retries (injectable for tests); rejects when `signal` aborts. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
}

function abortError(): DOMException {
  return new DOMException('The upload was cancelled.', 'AbortError')
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(abortError())
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Delay before retrying a busy upload: the server's `Retry-After`, else a short exponential backoff. */
export function busyRetryDelay(error: unknown, attempt: number): number {
  const seconds = isApiError(error) ? error.retryAfter : undefined
  if (seconds !== undefined) return Math.min(Math.max(seconds, 0.5), 60) * 1000
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 8000)
}

interface Task {
  key: string
  file: File
  motion: File | null
  controller: AbortController
}

/**
 * FIFO upload queue with a concurrency limit. Each task retries `503 request_busy` answers after
 * the server's `Retry-After` (holding its slot meanwhile) and reports progress through the handlers.
 */
export class UploadQueue {
  private readonly upload: UploadFn
  private readonly handlers: UploadQueueHandlers
  private readonly concurrency: number
  private readonly maxBusyRetries: number
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>
  private readonly waiting: Task[] = []
  private readonly running = new Map<string, Task>()
  private stopped = false

  constructor({ upload, handlers, concurrency = MAX_CONCURRENT_UPLOADS, maxBusyRetries = MAX_BUSY_RETRIES, wait = sleep }: UploadQueueOptions) {
    this.upload = upload
    this.handlers = handlers
    this.concurrency = Math.max(1, concurrency)
    this.maxBusyRetries = maxBusyRetries
    this.wait = wait
  }

  /** Uploads currently holding a slot (uploading or waiting to retry). */
  get activeCount(): number {
    return this.running.size
  }

  get pendingCount(): number {
    return this.waiting.length
  }

  /** Queues `file` (with the clip of a Live Photo, `motion`) under `key`, replacing any task of that key. */
  add(key: string, file: File, motion: File | null = null): void {
    if (this.stopped) return
    this.cancel(key)
    this.waiting.push({ key, file, motion, controller: new AbortController() })
    this.pump()
  }

  /** Drops a waiting task or aborts a running one (no handler is called for it afterwards). */
  cancel(key: string): void {
    const index = this.waiting.findIndex((task) => task.key === key)
    if (index >= 0) this.waiting.splice(index, 1)
    const running = this.running.get(key)
    if (running) {
      running.controller.abort()
      this.running.delete(key)
      this.pump()
    }
  }

  /** Re-enables the queue (after `stop`, e.g. a StrictMode remount). */
  start(): void {
    this.stopped = false
  }

  /** Cancels everything and ignores new tasks until `start`. */
  stop(): void {
    this.stopped = true
    this.waiting.length = 0
    for (const task of this.running.values()) task.controller.abort()
    this.running.clear()
  }

  private pump(): void {
    while (!this.stopped && this.running.size < this.concurrency && this.waiting.length > 0) {
      const task = this.waiting.shift() as Task
      this.running.set(task.key, task)
      void this.run(task)
    }
  }

  private isCurrent(task: Task): boolean {
    return !task.controller.signal.aborted && this.running.get(task.key) === task
  }

  private async run(task: Task): Promise<void> {
    const { signal } = task.controller
    try {
      for (let attempt = 1; ; attempt += 1) {
        this.handlers.onStart(task.key)
        try {
          const image = await this.upload(task.file, {
            signal,
            motion: task.motion,
            onProgress: (fraction) => {
              if (this.isCurrent(task)) this.handlers.onProgress(task.key, fraction)
            },
          })
          if (this.isCurrent(task)) this.handlers.onSuccess(task.key, image)
          return
        } catch (error) {
          if (!this.isCurrent(task) || isAbortError(error)) return
          if (!isApiError(error, 'request_busy') || attempt > this.maxBusyRetries) {
            this.handlers.onError(task.key, error)
            return
          }
          const delay = busyRetryDelay(error, attempt)
          this.handlers.onBusy(task.key, delay)
          await this.wait(delay, signal)
          if (!this.isCurrent(task)) return
        }
      }
    } catch (error) {
      // Only reachable when the wait between retries fails (cancelled → silent).
      if (this.isCurrent(task) && !isAbortError(error)) this.handlers.onError(task.key, error)
    } finally {
      if (this.running.get(task.key) === task) {
        this.running.delete(task.key)
        this.pump()
      }
    }
  }
}
