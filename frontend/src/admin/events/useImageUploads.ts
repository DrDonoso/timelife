import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageCrop, ImageOut, UploadOut } from '../../api/schema.gen'
import { errorCode } from '../../i18n'
import { fetchUpload, uploadEventImage } from './adminEventsApi'
import {
  EVENT_LIMITS,
  draftCrop,
  draftFromImage,
  draftUploaded,
  effectiveCoverKey,
  fileStem,
  insertImages,
  mediaKindOf,
  moveImages,
  pairLivePhotos,
  type DraftImage,
} from './eventForm'
import { UploadQueue, type UploadFn } from './uploadQueue'

/** How often items whose video is being converted are checked. */
export const PROCESSING_POLL_MS = 2000

export interface InsertTarget {
  key: string
  position: 'before' | 'after'
}

/** Reads an upload's current state (`GET /api/admin/uploads/{id}`); injectable for tests. */
export type PollFn = (id: string, signal: AbortSignal) => Promise<UploadOut>

export interface ImageUploads {
  images: DraftImage[]
  /** Effective cover key (chosen image, else the first one). */
  coverKey: string | null
  /** Explicit choice (may point to a removed image; use `coverKey` for display). */
  chosenCoverKey: string | null
  /**
   * Adds files (a Live Photo's photo and clip become one item; unsupported files appear as failed
   * items); returns how many files were skipped by the limit.
   */
  addFiles: (files: readonly File[], target?: InsertTarget | null) => number
  remove: (key: string) => void
  retry: (key: string) => void
  rename: (key: string, name: string) => void
  reorder: (keys: ReadonlySet<string>, target: InsertTarget) => void
  setCover: (key: string) => void
  /** Thumbnail framing of an uploaded image (normalized like the server; null = centred). */
  setCrop: (key: string, crop: ImageCrop | null) => void
  /** Live Photos: show the motion or only the photo. */
  setLive: (key: string, live: boolean) => void
}

let localKeySequence = 0

function nextLocalKey(): string {
  localKeySequence += 1
  return `upload-${localKeySequence}`
}

function update(images: DraftImage[], key: string, patch: (image: DraftImage) => Partial<DraftImage> | null): DraftImage[] {
  let changed = false
  const next = images.map((image) => {
    if (image.key !== key) return image
    const changes = patch(image)
    if (!changes) return image
    changed = true
    return { ...image, ...changes }
  })
  return changed ? next : images
}

/**
 * State of the event images: immediate uploads (≤ 3 at a time, busy retries), progress, errors,
 * order, names, cover and Live choices; items whose video is being converted on the server are
 * polled until it is ready. `upload` and `poll` are injectable for tests.
 */
export function useImageUploads(
  initialImages: readonly ImageOut[],
  initialCoverId: string | null,
  upload: UploadFn = uploadEventImage,
  poll: PollFn = fetchUpload,
): ImageUploads {
  const [images, setImages] = useState<DraftImage[]>(() => initialImages.map(draftFromImage))
  const [chosenCoverKey, setChosenCoverKey] = useState<string | null>(initialCoverId)
  const [pollRound, setPollRound] = useState(0)
  const imagesRef = useRef(images)
  const previewUrls = useRef(new Set<string>())

  const [queue] = useState(
    () =>
      new UploadQueue({
        upload,
        handlers: {
          onStart: (key) =>
            setImages((current) => update(current, key, () => ({ status: 'uploading', progress: 0, error: null }))),
          onProgress: (key, fraction) => {
            const progress = Math.round(Math.min(1, Math.max(0, fraction)) * 100) / 100
            setImages((current) =>
              update(current, key, (image) => (image.progress === progress && image.status === 'uploading' ? null : { progress, status: 'uploading' })),
            )
          },
          onBusy: (key) => setImages((current) => update(current, key, () => ({ status: 'busy', progress: 0 }))),
          onSuccess: (key, image) => setImages((current) => update(current, key, (draft) => draftUploaded(draft, image))),
          onError: (key, error) =>
            setImages((current) => update(current, key, () => ({ status: 'error', error: errorCode(error) }))),
        },
      }),
  )

  useEffect(() => {
    imagesRef.current = images
  }, [images])

  useEffect(() => {
    const urls = previewUrls.current
    queue.start()
    return () => {
      queue.stop()
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [queue])

  // Videos being converted: ask the server again every few seconds until they are ready.
  const processing = images
    .filter((image) => image.status === 'processing' && image.id !== null)
    .map((image) => image.id)
    .join(',')
  useEffect(() => {
    if (!processing) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void Promise.allSettled(processing.split(',').map((id) => poll(id, controller.signal))).then((results) => {
        if (controller.signal.aborted) return
        const answers = new Map<string, UploadOut>()
        for (const result of results) {
          if (result.status === 'fulfilled') answers.set(result.value.id, result.value)
        }
        setImages((current) =>
          current.map((draft) => {
            const answer = draft.status === 'processing' && draft.id !== null ? answers.get(draft.id) : undefined
            return answer ? { ...draft, ...draftUploaded(draft, answer) } : draft
          }),
        )
        setPollRound((round) => round + 1)
      })
    }, PROCESSING_POLL_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [processing, pollRound, poll])

  const addFiles = useCallback(
    (files: readonly File[], target?: InsertTarget | null) => {
      const uploads = pairLivePhotos(files)
      const room = Math.max(0, EVENT_LIMITS.images - imagesRef.current.length)
      const accepted = uploads.slice(0, room)
      const skipped = uploads.slice(room).reduce((count, item) => count + (item.motion ? 2 : 1), 0)
      if (accepted.length === 0) return skipped
      const drafts = accepted.map(({ file, motion }): DraftImage => {
        const kind = mediaKindOf(file)
        let previewUrl: string | null = null
        if (kind === 'image') {
          previewUrl = URL.createObjectURL(file)
          previewUrls.current.add(previewUrl)
        }
        return {
          key: nextLocalKey(),
          id: null,
          name: fileStem(file.name),
          renamed: false,
          kind: kind === 'video' ? 'video' : 'image',
          image: null,
          file,
          motionFile: motion,
          live: true,
          previewUrl,
          status: kind ? 'queued' : 'error',
          progress: 0,
          error: kind ? null : 'unsupported_media',
          crop: null,
        }
      })
      // Counted now so a second drop before the next render still respects the limit.
      imagesRef.current = [...imagesRef.current, ...drafts]
      setImages((current) => insertImages(current, drafts, target))
      for (const draft of drafts) {
        if (draft.status === 'queued' && draft.file) queue.add(draft.key, draft.file, draft.motionFile)
      }
      return skipped
    },
    [queue],
  )

  const remove = useCallback(
    (key: string) => {
      queue.cancel(key)
      const removed = imagesRef.current.find((image) => image.key === key)
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl)
        previewUrls.current.delete(removed.previewUrl)
      }
      imagesRef.current = imagesRef.current.filter((image) => image.key !== key)
      setImages((current) => current.filter((image) => image.key !== key))
    },
    [queue],
  )

  const retry = useCallback(
    (key: string) => {
      const draft = imagesRef.current.find((item) => item.key === key)
      const file = draft?.file
      if (!file || !mediaKindOf(file)) return
      setImages((current) => update(current, key, (image) => (image.status === 'error' ? { status: 'queued', progress: 0, error: null } : null)))
      queue.add(key, file, draft.motionFile)
    },
    [queue],
  )

  const rename = useCallback((key: string, name: string) => {
    setImages((current) => update(current, key, () => ({ name, renamed: true })))
  }, [])

  const reorder = useCallback((keys: ReadonlySet<string>, target: InsertTarget) => {
    setImages((current) => moveImages(current, keys, target.key, target.position))
  }, [])

  const setCover = useCallback((key: string) => setChosenCoverKey(key), [])

  const setCrop = useCallback((key: string, crop: ImageCrop | null) => {
    setImages((current) =>
      update(current, key, (image) => {
        const next = draftCrop(image, crop)
        return JSON.stringify(next) === JSON.stringify(image.crop) ? null : { crop: next }
      }),
    )
  }, [])

  const setLive = useCallback((key: string, live: boolean) => {
    setImages((current) => update(current, key, (image) => (image.live === live ? null : { live })))
  }, [])

  return {
    images,
    coverKey: effectiveCoverKey(images, chosenCoverKey),
    chosenCoverKey,
    addFiles,
    remove,
    retry,
    rename,
    reorder,
    setCover,
    setCrop,
    setLive,
  }
}
