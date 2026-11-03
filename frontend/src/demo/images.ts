/**
 * What the upload pipeline (src/timelife/media.py and video.py) does to a photo or a video, done in
 * the visitor's browser: decode it (anything the browser can open), measure it, take its average
 * colour and make the 512 × 512 centre-crop thumbnail (or, later, the thumbnail of a framing). The
 * photo itself is the display variant unless its long edge exceeds 2048 px; a video gets the
 * pictures of a frame near its start and is played as it is (no conversion). Live Photos (a photo
 * and its clip, or an iCloud `.livp`) keep their clip. Nothing leaves the browser.
 */
import type { ImageCrop } from '../api/schema.gen'
import { cropBox, type PictureSize } from '../utils/crop'
import type { UploadedFile } from './store'
import { DemoApiError } from './validation'

const THUMB_SIZE = 512
const DISPLAY_EDGE = 2048
const MAX_PIXELS = 80_000_000
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024
const MAX_VIDEO_SECONDS = 10 * 60
const LIVE_MOTION_SECONDS = 10
const POSTER_SECONDS = 1
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'heic', 'heif', 'gif'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', '3gp', '3g2', 'avi', 'mts', 'm2ts'])
const LIVE_STILLS = new Set(['heic', 'heif', 'jpg', 'jpeg'])
const LIVE_CLIPS = new Set(['mov', 'mp4'])

type Canvas = OffscreenCanvas | HTMLCanvasElement

function canvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return element
}

function context(target: Canvas): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const result = target.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (!result) throw new DemoApiError(422, 'unsupported_image')
  return result
}

async function encode(target: Canvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in target) return target.convertToBlob({ type: 'image/webp', quality })
  return new Promise((resolve, reject) =>
    target.toBlob((blob) => (blob ? resolve(blob) : reject(new DemoApiError(422, 'unsupported_image'))), 'image/webp', quality),
  )
}

function hex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

/** Average colour of the thumbnail, weighted by opacity (Pillow's 1 × 1 box resize). */
function averageColor(thumb: Canvas): string {
  const side = 32
  const small = canvas(side, side)
  const smallContext = context(small)
  smallContext.imageSmoothingQuality = 'high'
  smallContext.drawImage(thumb, 0, 0, side, side)
  const { data } = smallContext.getImageData(0, 0, side, side)
  const sums = [0, 0, 0]
  let weight = 0
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3]
    for (let channel = 0; channel < 3; channel += 1) sums[channel] += data[index + channel] * alpha
    weight += alpha
  }
  return `#${sums.map((sum) => hex(weight ? Math.round(sum / weight) : 0)).join('')}`
}

type Picture = Omit<UploadedFile, 'kind' | 'video' | 'duration'>

/** Size, colour and pictures of a decoded `source`; `original` is the display picture when small enough. */
async function pictures(fileName: string, source: CanvasImageSource, width: number, height: number, original: Blob | null): Promise<Picture> {
  if (width < 1 || height < 1) throw new DemoApiError(422, 'unsupported_image')
  if (width * height > MAX_PIXELS) throw new DemoApiError(422, 'image_dimensions_too_large')

  const side = Math.min(width, height)
  const thumbCanvas = canvas(THUMB_SIZE, THUMB_SIZE)
  const thumbContext = context(thumbCanvas)
  thumbContext.imageSmoothingQuality = 'high'
  thumbContext.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE)

  let size = { width, height }
  const longest = Math.max(width, height)
  if (longest > DISPLAY_EDGE) {
    const ratio = DISPLAY_EDGE / longest
    size = { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
  }
  let display = original
  if (!display || longest > DISPLAY_EDGE) {
    const displayCanvas = canvas(size.width, size.height)
    const displayContext = context(displayCanvas)
    displayContext.imageSmoothingQuality = 'high'
    displayContext.drawImage(source, 0, 0, size.width, size.height)
    display = await encode(displayCanvas, 0.82)
  }
  return {
    fileName,
    ...size,
    dominantColor: averageColor(thumbCanvas),
    thumb: await encode(thumbCanvas, 0.8),
    display,
  }
}

async function processPicture(file: File, fileName = file.name): Promise<Picture> {
  if (file.size > MAX_UPLOAD_BYTES) throw new DemoApiError(413, 'upload_too_large')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // HEIC/HEIF, which most browsers cannot decode, ends up here too.
    throw new DemoApiError(422, 'unsupported_image')
  }
  try {
    return await pictures(fileName, bitmap, bitmap.width, bitmap.height, file)
  } finally {
    bitmap.close()
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(extensionOf(file.name))
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(extensionOf(file.name))
}

/** Resolves once `video` fires `type` (rejects on `error`); `start` triggers it. */
function mediaEvent(video: HTMLVideoElement, type: string, start: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(type, done)
      video.removeEventListener('error', fail)
    }
    const done = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new Error(`video ${type} failed`))
    }
    video.addEventListener(type, done)
    video.addEventListener('error', fail)
    start()
  })
}

/** A `<video>` of `clip` with its first frames decoded, and how to let it go. */
async function openVideo(clip: Blob): Promise<{ video: HTMLVideoElement; close: () => void }> {
  const url = URL.createObjectURL(clip)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  const close = () => {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
  try {
    await mediaEvent(video, 'loadeddata', () => {
      video.src = url
    })
  } catch {
    close()
    throw new DemoApiError(422, 'unsupported_video')
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth < 1 || video.videoHeight < 1) {
    close()
    throw new DemoApiError(422, 'unsupported_video')
  }
  return { video, close }
}

async function processVideo(file: File): Promise<UploadedFile> {
  if (file.size > MAX_VIDEO_BYTES) throw new DemoApiError(413, 'upload_too_large')
  const { video, close } = await openVideo(file)
  try {
    const duration = video.duration
    if (duration > MAX_VIDEO_SECONDS) throw new DemoApiError(422, 'video_too_long')
    const at = Math.min(POSTER_SECONDS, duration / 2)
    try {
      await mediaEvent(video, 'seeked', () => {
        video.currentTime = at
      })
    } catch {
      throw new DemoApiError(422, 'unsupported_video')
    }
    const picture = await pictures(file.name, video, video.videoWidth, video.videoHeight, null)
    return { ...picture, kind: 'video', video: file, duration }
  } finally {
    close()
  }
}

/** Duration of a Live Photo's clip; 422 `invalid_live_photo` unless a video of at most 10 s. */
async function motionDuration(clip: Blob): Promise<number> {
  if (clip.size > MAX_VIDEO_BYTES) throw new DemoApiError(413, 'upload_too_large')
  let opened: Awaited<ReturnType<typeof openVideo>>
  try {
    opened = await openVideo(clip)
  } catch {
    throw new DemoApiError(422, 'invalid_live_photo')
  }
  const { duration } = opened.video
  opened.close()
  if (duration > LIVE_MOTION_SECONDS) throw new DemoApiError(422, 'invalid_live_photo')
  return duration
}

interface ZipEntry {
  name: string
  data: Blob
}

/** The files of a ZIP archive (stored or deflated entries), read with the browser's own inflater. */
export async function unzip(archive: Blob): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(await archive.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset
      break
    }
  }
  if (end < 0) throw new DemoApiError(422, 'unsupported_media')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new DemoApiError(422, 'unsupported_media')
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/') || local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) continue
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = new Blob([bytes.slice(start, start + compressed)])
    if (method === 0) entries.push({ name, data: raw })
    else if (method === 8) entries.push({ name, data: await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob() })
    else throw new DemoApiError(422, 'unsupported_media')
  }
  return entries
}

/** The photo and the clip of an iCloud `.livp` (a ZIP holding both). */
async function readLivp(file: File): Promise<{ still: File; clip: Blob }> {
  if (file.size > MAX_UPLOAD_BYTES + MAX_VIDEO_BYTES) throw new DemoApiError(413, 'upload_too_large')
  const entries = (await unzip(file)).filter((entry) => !entry.name.startsWith('__MACOSX/') && !entry.name.split('/').at(-1)?.startsWith('._'))
  const stills = entries.filter((entry) => LIVE_STILLS.has(extensionOf(entry.name)))
  const clips = entries.filter((entry) => LIVE_CLIPS.has(extensionOf(entry.name)))
  if (stills.length !== 1 || clips.length !== 1) throw new DemoApiError(422, 'unsupported_media')
  const name = stills[0].name.split('/').at(-1) ?? stills[0].name
  return { still: new File([stills[0].data], name), clip: clips[0].data }
}

/**
 * An upload as the API stores it: a photo; for events also a video, a Live Photo (the photo plus
 * its clip, `motion`) or a `.livp`.
 */
export async function processUpload(file: File, motion: File | null = null, { event = true }: { event?: boolean } = {}): Promise<UploadedFile> {
  if (motion) {
    const still = await processPicture(file)
    return { ...still, kind: 'image', video: motion, duration: await motionDuration(motion) }
  }
  if (event && extensionOf(file.name) === 'livp') {
    const { still, clip } = await readLivp(file)
    const picture = await processPicture(still, file.name)
    return { ...picture, kind: 'image', video: clip, duration: await motionDuration(clip) }
  }
  if (event && isVideoFile(file) && !isImageFile(file)) return processVideo(file)
  if (event && !isImageFile(file)) throw new DemoApiError(422, 'unsupported_media')
  return { ...(await processPicture(file)), kind: 'image', video: null, duration: null }
}

const framed = new WeakMap<Blob, Map<string, Promise<Blob>>>()

/**
 * The 512 × 512 thumbnail of an upload seen through a framing (what the backend renders from
 * `display.webp`), memoised per picture and framing.
 */
export function framedThumb(display: Blob, crop: ImageCrop, size: PictureSize): Promise<Blob> {
  let byCrop = framed.get(display)
  if (!byCrop) {
    byCrop = new Map()
    framed.set(display, byCrop)
  }
  const key = `${crop.x}:${crop.y}:${crop.zoom}`
  let thumb = byCrop.get(key)
  if (!thumb) {
    thumb = (async () => {
      const bitmap = await createImageBitmap(display)
      try {
        // The stored size is the display size: scale in case the browser decodes another one.
        const scale = bitmap.width / size.width
        const { left, top, side } = cropBox(crop, size)
        const target = canvas(THUMB_SIZE, THUMB_SIZE)
        const targetContext = context(target)
        targetContext.imageSmoothingQuality = 'high'
        targetContext.drawImage(bitmap, left * scale, top * scale, side * scale, side * scale, 0, 0, THUMB_SIZE, THUMB_SIZE)
        return await encode(target, 0.8)
      } finally {
        bitmap.close()
      }
    })()
    byCrop.set(key, thumb)
  }
  return thumb
}
