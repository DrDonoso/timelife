import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, isAbortError, isApiError } from '../../api/client'
import type { ImageOut } from '../../api/schema.gen'

export type UploadPurpose = 'avatar' | 'background'

/** `accept` list for file pickers (HEIC files often come without a MIME type, hence the extensions). */
export const IMAGE_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
  '.gif',
]

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|hei[cf]|gif)$/i
/** The server answers 503 `request_busy` (Retry-After: 1) when too many uploads run at once. */
const BUSY_RETRIES = 3

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name)
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('The upload was aborted.', 'AbortError'))
      },
      { once: true },
    )
  })
}

/** `POST /api/admin/uploads?purpose=…` with progress, retrying while the server is busy. */
export async function uploadImage(
  file: File,
  purpose: UploadPurpose,
  { signal, onProgress }: { signal: AbortSignal; onProgress?: (fraction: number) => void },
): Promise<ImageOut> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api.upload<ImageOut>('/api/admin/uploads', file, {
        params: { purpose },
        signal,
        onProgress: onProgress ? (fraction) => onProgress(fraction) : undefined,
      })
    } catch (error) {
      if (!isApiError(error, 'request_busy') || attempt >= BUSY_RETRIES) throw error
      onProgress?.(0)
      // Honour Retry-After when the client exposes it, else back off 1 s, 2 s, 3 s.
      const retryAfter = (error as { retryAfter?: unknown }).retryAfter
      const seconds = typeof retryAfter === 'number' && retryAfter > 0 ? Math.min(retryAfter, 10) : attempt + 1
      await wait(seconds * 1000, signal)
    }
  }
}

export interface ImageUploadState {
  status: 'idle' | 'uploading' | 'error'
  /** Sent fraction, 0..1. */
  progress: number
  /** Object URL of the local file (preview while it uploads or after a failure). */
  previewUrl: string | null
  fileName: string | null
  error: unknown
}

const IDLE: ImageUploadState = { status: 'idle', progress: 0, previewUrl: null, fileName: null, error: null }

/**
 * One image upload at a time (avatar, background): local preview, progress, cancel and retry.
 * `onUploaded` receives the pending `ImageOut` to reference when the form is saved.
 */
export function useImageUpload(purpose: UploadPurpose, onUploaded: (image: ImageOut) => void) {
  const [state, setState] = useState<ImageUploadState>(IDLE)
  const controller = useRef<AbortController | null>(null)
  const lastFile = useRef<File | null>(null)
  const previewUrl = useRef<string | null>(null)
  const onUploadedRef = useRef(onUploaded)

  useEffect(() => {
    onUploadedRef.current = onUploaded
  })

  const releasePreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
  }, [])

  useEffect(
    () => () => {
      controller.current?.abort()
      releasePreview()
    },
    [releasePreview],
  )

  const upload = useCallback(
    async (file: File) => {
      controller.current?.abort()
      controller.current = null
      releasePreview()
      lastFile.current = file
      if (!isImageFile(file)) {
        setState({
          status: 'error',
          progress: 0,
          previewUrl: null,
          fileName: file.name,
          error: new ApiError({ status: 0, code: 'unsupported_image' }),
        })
        return
      }
      const url = URL.createObjectURL(file)
      previewUrl.current = url
      const abort = new AbortController()
      controller.current = abort
      setState({ status: 'uploading', progress: 0, previewUrl: url, fileName: file.name, error: null })
      try {
        const image = await uploadImage(file, purpose, {
          signal: abort.signal,
          onProgress: (fraction) =>
            setState((current) => (current.previewUrl === url && current.status === 'uploading' ? { ...current, progress: fraction } : current)),
        })
        if (controller.current !== abort) return
        controller.current = null
        releasePreview()
        setState(IDLE)
        onUploadedRef.current(image)
      } catch (error) {
        if (controller.current !== abort) return
        controller.current = null
        if (isAbortError(error)) {
          releasePreview()
          setState(IDLE)
          return
        }
        setState((current) => ({ ...current, status: 'error', error }))
      }
    },
    [purpose, releasePreview],
  )

  /** Aborts the upload in flight, or dismisses a failed one. */
  const cancel = useCallback(() => {
    if (controller.current) {
      controller.current.abort()
      return
    }
    releasePreview()
    setState(IDLE)
  }, [releasePreview])

  const retry = useCallback(() => {
    if (lastFile.current) void upload(lastFile.current)
  }, [upload])

  return { state, upload, cancel, retry }
}

export type ImageUploader = ReturnType<typeof useImageUpload>
