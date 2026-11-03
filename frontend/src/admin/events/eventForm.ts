import type { EventIn, EventOut, EventUpdateIn, ImageCrop, ImageOut, UploadOut } from '../../api/schema.gen'
import type { TranslationKey, TranslationParams } from '../../i18n'
import { normalizeCrop } from '../../utils/crop'
import { isISODate, todayISO } from '../../utils/dates'

/** Backend limits (spec 20-api `EventIn`), mirrored for client-side validation. */
export const EVENT_LIMITS = {
  title: 120,
  location: 200,
  notes: 5000,
  children: 20,
  categories: 20,
  images: 50,
  imageName: 160,
} as const

/** Positive integer id (backend range 1..2^31-1) from a route/query param, else null. */
export function parseId(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null
  const id = Number(value)
  return id >= 1 && id <= 2_147_483_647 ? id : null
}

export interface EventFormValues {
  title: string
  /** `YYYY-MM-DD` or null while the date field is incomplete. */
  date: string | null
  childIds: number[]
  /** Ordered: first = primary category, order = ring order. */
  categoryIds: number[]
  location: string
  notes: string
}

export type ImageStatus = 'queued' | 'uploading' | 'busy' | 'processing' | 'done' | 'error'

/**
 * One item of the editor (a photo, a video or a Live Photo): already attached, uploading, being
 * converted, uploaded (pending) or failed.
 */
export interface DraftImage {
  /** Stable local key (the image id for images that came from the server). */
  key: string
  /** Server id once uploaded. */
  id: string | null
  name: string
  /** The admin edited the name (an upload finishing later must not overwrite it). */
  renamed: boolean
  /** `video` for videos (guessed from the file until the server answers). */
  kind: 'image' | 'video'
  image: UploadOut | ImageOut | null
  /** Original file, kept to retry failed uploads. */
  file: File | null
  /** Clip of a Live Photo, uploaded with `file` (paired by file name). */
  motionFile: File | null
  /** Live Photos: show the motion (on by default). */
  live: boolean
  /** `blob:` preview shown while the upload runs. */
  previewUrl: string | null
  /** `processing`: uploaded, its video is being converted on the server (saving is allowed). */
  status: ImageStatus
  /** Upload progress 0..1 (conversion progress while `processing`). */
  progress: number
  /** Error code (`errors.<code>`) of a failed upload or conversion. */
  error: string | null
  /** Thumbnail framing (as the server stores it); null = the centred square. */
  crop: ImageCrop | null
}

export type EventField = 'title' | 'date' | 'children' | 'categories' | 'location' | 'notes' | 'images'
export type EventFormErrors = Partial<Record<EventField, string>>

type Translate = (key: TranslationKey, params?: TranslationParams) => string

export function initialFormValues(event: EventOut | null, defaultChildIds: readonly number[] = []): EventFormValues {
  if (event) {
    return {
      title: event.title,
      date: event.date,
      childIds: [...event.child_ids],
      categoryIds: [...event.category_ids],
      location: event.location ?? '',
      notes: event.notes,
    }
  }
  return {
    title: '',
    date: todayISO(),
    childIds: [...new Set(defaultChildIds)],
    categoryIds: [],
    location: '',
    notes: '',
  }
}

/** A photo of the server that comes with a clip (a Live Photo), whatever the state of its conversion. */
export function isLivePhoto(image: Pick<ImageOut, 'kind' | 'video_status'> | null): boolean {
  return image !== null && image.kind === 'image' && image.video_status !== null
}

/** A Live Photo of the editor: uploaded with a clip (or from a `.livp`) or already one on the server. */
export function isLiveDraft(draft: Pick<DraftImage, 'image' | 'motionFile' | 'file'>): boolean {
  if (draft.image) return isLivePhoto(draft.image)
  return draft.motionFile !== null || (draft.file !== null && mediaKindOf(draft.file) === 'livp')
}

/** Editor state of a server image: a conversion still running, a video that could not be converted… */
function serverState(image: UploadOut | ImageOut): Pick<DraftImage, 'status' | 'progress' | 'error'> {
  if (image.video_status === 'processing') {
    return { status: 'processing', progress: 'progress' in image && image.progress !== null ? image.progress : 0, error: null }
  }
  if (image.kind === 'video' && image.video_status === 'failed') {
    return { status: 'error', progress: 1, error: 'video_processing_failed' }
  }
  return { status: 'done', progress: 1, error: null }
}

export function draftFromImage(image: ImageOut): DraftImage {
  return {
    key: image.id,
    id: image.id,
    name: image.name,
    renamed: false,
    kind: image.kind,
    image,
    file: null,
    motionFile: null,
    live: image.live,
    previewUrl: null,
    ...serverState(image),
    crop: image.crop,
  }
}

/** Changes of an editor item once the server answered for it (an upload or a conversion poll). */
export function draftUploaded(draft: DraftImage, image: UploadOut | ImageOut): Partial<DraftImage> {
  return {
    ...serverState(image),
    id: image.id,
    image,
    kind: image.kind,
    name: draft.renamed ? draft.name : image.name,
  }
}

/** `crop` as the server stores it for `image` (null without an uploaded picture). */
export function draftCrop(image: Pick<DraftImage, 'image'>, crop: ImageCrop | null): ImageCrop | null {
  return image.image ? normalizeCrop(crop, image.image) : null
}

/** The cover: the chosen image while it is still in the list, otherwise the first one. */
export function effectiveCoverKey(images: readonly DraftImage[], coverKey: string | null): string | null {
  if (coverKey !== null && images.some((image) => image.key === coverKey)) return coverKey
  return images[0]?.key ?? null
}

/** Snapshot used to detect unsaved changes (raw values, image order, names, framings, Live choices and cover). */
export function formSnapshot(values: EventFormValues, images: readonly DraftImage[], coverKey: string | null): string {
  return JSON.stringify({
    ...values,
    images: images.map((image) => [image.key, image.name, image.crop, image.live]),
    cover: effectiveCoverKey(images, coverKey),
  })
}

/** Uploaded items (finished, or still converting their video): what an `EventIn` lists. */
function isUploaded(image: DraftImage): image is DraftImage & { id: string } {
  return (image.status === 'done' || image.status === 'processing') && image.id !== null
}

/** `EventIn` with ordered categories and images; only finished uploads are included. */
export function buildEventIn(values: EventFormValues, images: readonly DraftImage[], coverKey: string | null): EventIn {
  const uploaded = images.filter(isUploaded)
  const coverKeyValue = effectiveCoverKey(uploaded, coverKey)
  const cover = uploaded.find((image) => image.key === coverKeyValue) ?? null
  return {
    title: values.title.trim(),
    date: values.date ?? '',
    notes: values.notes.trim(),
    location: values.location.trim() || null,
    child_ids: [...values.childIds],
    category_ids: [...values.categoryIds],
    images: uploaded.map((image) => ({
      id: image.id,
      name: image.name.trim(),
      ...(image.crop ? { crop: image.crop } : {}),
      ...(isLiveDraft(image) ? { live: image.live } : {}),
    })),
    cover_image_id: cover?.id ?? null,
  }
}

export function buildEventUpdateIn(
  values: EventFormValues,
  images: readonly DraftImage[],
  coverKey: string | null,
  version: number,
): EventUpdateIn {
  return { ...buildEventIn(values, images, coverKey), version }
}

/** Client-side validation mirroring the backend (`EventIn`) plus the uploader state. */
export function validateEventForm(values: EventFormValues, images: readonly DraftImage[], t: Translate): EventFormErrors {
  const errors: EventFormErrors = {}
  const title = values.title.trim()
  if (!title) errors.title = t('adminEvents.editor.validation.titleRequired')
  else if (title.length > EVENT_LIMITS.title) errors.title = t('adminEvents.editor.validation.tooLong', { max: EVENT_LIMITS.title })

  if (!values.date || !isISODate(values.date)) errors.date = t('adminEvents.editor.validation.dateRequired')

  if (values.childIds.length === 0) errors.children = t('adminEvents.editor.validation.childrenRequired')
  else if (values.childIds.length > EVENT_LIMITS.children) {
    errors.children = t('adminEvents.editor.validation.tooMany', { max: EVENT_LIMITS.children })
  }

  if (values.categoryIds.length === 0) errors.categories = t('adminEvents.editor.validation.categoriesRequired')
  else if (values.categoryIds.length > EVENT_LIMITS.categories) {
    errors.categories = t('adminEvents.editor.validation.tooMany', { max: EVENT_LIMITS.categories })
  }

  if (values.location.trim().length > EVENT_LIMITS.location) {
    errors.location = t('adminEvents.editor.validation.tooLong', { max: EVENT_LIMITS.location })
  }
  if (values.notes.trim().length > EVENT_LIMITS.notes) {
    errors.notes = t('adminEvents.editor.validation.tooLong', { max: EVENT_LIMITS.notes })
  }

  if (images.some((image) => image.status === 'queued' || image.status === 'uploading' || image.status === 'busy')) {
    errors.images = t('adminEvents.editor.validation.imagesUploading')
  } else if (images.some((image) => image.status === 'error')) {
    errors.images = t('adminEvents.editor.validation.imagesFailed')
  } else if (images.length > EVENT_LIMITS.images) {
    errors.images = t('adminEvents.editor.validation.tooManyImages', { max: EVENT_LIMITS.images })
  } else if (images.some((image) => !image.name.trim() || image.name.trim().length > EVENT_LIMITS.imageName)) {
    errors.images = t('adminEvents.editor.validation.imageNames', { max: EVENT_LIMITS.imageName })
  }
  return errors
}

/** Backend `invalid_request.fields` keys (last pydantic `loc` item) → editor field. */
const SERVER_FIELDS: Readonly<Record<string, EventField>> = {
  title: 'title',
  date: 'date',
  notes: 'notes',
  location: 'location',
  child_ids: 'children',
  category_ids: 'categories',
  images: 'images',
  name: 'images',
  cover_image_id: 'images',
}

/** Business error codes that belong to one field. */
const CODE_FIELDS: Readonly<Record<string, EventField>> = {
  invalid_child: 'children',
  child_not_found: 'children',
  invalid_category: 'categories',
  category_not_found: 'categories',
  invalid_image: 'images',
  invalid_cover: 'images',
  image_not_found: 'images',
}

export function serverFieldOf(name: string): EventField | null {
  return SERVER_FIELDS[name] ?? null
}

export function fieldOfErrorCode(code: string): EventField | null {
  return CODE_FIELDS[code] ?? null
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────────

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'] as const
const ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'heic', 'heif', 'gif'] as const
export const ACCEPTED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/3gpp',
  'video/3gpp2',
  'video/x-m4v',
  'video/x-msvideo',
  'video/avi',
  'video/mp2t',
] as const
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', '3gp', '3g2', 'avi', 'mts', 'm2ts'] as const
/** iCloud.com downloads a Live Photo as a `.livp`: a ZIP holding the photo and its clip. */
const LIVE_PHOTO_EXTENSION = 'livp'
const GENERIC_TYPES = ['', 'application/octet-stream']
const ZIP_TYPES = ['application/zip', 'application/x-zip-compressed']
/** Photo and clip of a Live Photo as iPhones export them (`IMG_1234.HEIC` + `IMG_1234.MOV`). */
const LIVE_STILL_EXTENSIONS = ['heic', 'heif', 'jpg', 'jpeg']
const LIVE_CLIP_EXTENSIONS = ['mov', 'mp4']

/** `accept` list for the file picker (MIME types plus extensions: HEIC often has no MIME type). */
export const FILE_ACCEPT: readonly string[] = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`)]

/** `accept` list of the event uploader: photos, videos and `.livp` Live Photos. */
export const MEDIA_ACCEPT: readonly string[] = [
  ...FILE_ACCEPT,
  ...ACCEPTED_VIDEO_TYPES,
  ...VIDEO_EXTENSIONS.map((ext) => `.${ext}`),
  `.${LIVE_PHOTO_EXTENSION}`,
]

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Quick client-side check before uploading (the server decodes the file and has the last word).
 * Accepts the supported MIME types, or a supported extension when the browser reports no (or a
 * generic) type, as happens with HEIC on Windows.
 */
export function isSupportedImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  const type = file.type.toLowerCase()
  if ((ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)) return true
  const extension = extensionOf(file.name)
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) return false
  return GENERIC_TYPES.includes(type) || type.startsWith('image/')
}

export type MediaFileKind = 'image' | 'video' | 'livp'

/** What the event uploader takes a file for (null: neither a photo, a video nor a `.livp`). */
export function mediaKindOf(file: Pick<File, 'name' | 'type'>): MediaFileKind | null {
  if (isSupportedImageFile(file)) return 'image'
  const type = file.type.toLowerCase()
  const extension = extensionOf(file.name)
  if ((ACCEPTED_VIDEO_TYPES as readonly string[]).includes(type)) return 'video'
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(extension) && (GENERIC_TYPES.includes(type) || type.startsWith('video/'))) {
    return 'video'
  }
  if (extension === LIVE_PHOTO_EXTENSION && (GENERIC_TYPES.includes(type) || ZIP_TYPES.includes(type))) return 'livp'
  return null
}

/** One upload of the event uploader: a file, plus the clip of a Live Photo. */
export interface MediaUpload {
  file: File
  motion: File | null
}

function stemOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase()
}

/**
 * The uploads for `files`, in their order: a photo and a clip with the same name (a Live Photo
 * exported from an iPhone: `IMG_1234.HEIC` + `IMG_1234.MOV`) become one upload, at the photo's
 * place. Names shared by more files are not paired.
 */
export function pairLivePhotos(files: readonly File[]): MediaUpload[] {
  const stills = new Map<string, File[]>()
  const clips = new Map<string, File[]>()
  for (const file of files) {
    const extension = extensionOf(file.name)
    const group = LIVE_STILL_EXTENSIONS.includes(extension) ? stills : LIVE_CLIP_EXTENSIONS.includes(extension) ? clips : null
    if (!group) continue
    const stem = stemOf(file.name)
    group.set(stem, [...(group.get(stem) ?? []), file])
  }
  const motions = new Map<File, File>()
  for (const [stem, [still, ...otherStills]] of stills) {
    const [clip, ...otherClips] = clips.get(stem) ?? []
    if (clip && otherStills.length === 0 && otherClips.length === 0) motions.set(still, clip)
  }
  const paired = new Set(motions.values())
  return files.filter((file) => !paired.has(file)).map((file) => ({ file, motion: motions.get(file) ?? null }))
}

/** File name without its extension (what the server stores as the image name). */
export function fileStem(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim()
  return stem.slice(0, EVENT_LIMITS.imageName)
}

/** Errors that will not go away by retrying the same file. */
const PERMANENT_UPLOAD_ERRORS = new Set([
  'unsupported_image',
  'unsupported_media',
  'unsupported_video',
  'video_too_long',
  'invalid_live_photo',
  'video_processing_failed',
  'upload_too_large',
  'request_too_large',
  'image_dimensions_too_large',
  'invalid_purpose',
])

export function canRetryUpload(code: string | null): boolean {
  return code !== null && !PERMANENT_UPLOAD_ERRORS.has(code)
}

/** Moves the dragged `keys` before/after `targetKey`, keeping their relative order. */
export function moveImages<T extends { key: string }>(
  list: readonly T[],
  keys: ReadonlySet<string>,
  targetKey: string,
  position: 'before' | 'after',
): T[] {
  if (keys.has(targetKey)) return [...list]
  const moving = list.filter((item) => keys.has(item.key))
  const rest = list.filter((item) => !keys.has(item.key))
  const index = rest.findIndex((item) => item.key === targetKey)
  if (index < 0 || moving.length === 0) return [...list]
  const at = position === 'after' ? index + 1 : index
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)]
}

/** Inserts `items` before/after `targetKey` (appends when the target is unknown or missing). */
export function insertImages<T extends { key: string }>(
  list: readonly T[],
  items: readonly T[],
  target?: { key: string; position: 'before' | 'after' } | null,
): T[] {
  const index = target ? list.findIndex((item) => item.key === target.key) : -1
  if (index < 0) return [...list, ...items]
  const at = target?.position === 'after' ? index + 1 : index
  return [...list.slice(0, at), ...items, ...list.slice(at)]
}
