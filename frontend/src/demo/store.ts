/**
 * The demo's database: everything lives in memory, starts from the scenario on every page load
 * and follows the backend's rules (src/timelife/*.py): newest-first ordering, accent-insensitive
 * title search, the trash, optimistic versions, permanent slugs, pending uploads, "in use"
 * protections and the administrator safeguards. Errors are the backend's codes ({@link DemoApiError}).
 */
import type {
  AppearanceOut,
  BackupSummaryOut,
  CategoryOut,
  ChildOut,
  EventOut,
  EventPageOut,
  EventSummaryOut,
  ImageCrop,
  ImageOut,
  LocationOut,
  SessionUserOut,
  SettingsIn,
  TimelineOut,
  TrashItemOut,
  UploadOut,
  UserOut,
} from '../api/schema.gen'
import { normalizeCrop, type PictureSize } from '../utils/crop'
import { dominantColor, photoArt, renderArt, type Art, type Variant } from './artwork'
import { buildScenario, CATEGORIES, isoInstant, USERS, type Scenario } from './scenario'
import { DemoApiError } from './validation'

export type Purpose = 'event' | 'avatar' | 'background'
export type Zoom = 'years' | 'months' | 'events'
export type Direction = AppearanceOut['direction_desktop']
export type Role = 'admin' | 'viewer'

export const PURPOSES: readonly Purpose[] = ['event', 'avatar', 'background']
export const DIRECTIONS: readonly Direction[] = ['left_to_right', 'right_to_left', 'top_to_bottom', 'bottom_to_top']
const SLUG_MAX_LENGTH = 80
const TITLE_SEARCH_LENGTH = 240
const NAME_LENGTH = 160
const MIN_YEAR = 1900
const MAX_YEAR = 2200
/** src/timelife/events.py `MAX_LOCATIONS`. */
const MAX_LOCATIONS = 500

interface StoredImage {
  id: string
  purpose: Purpose
  name: string
  /** `video`: a visitor's video (its pictures show a frame near the start). */
  kind: 'image' | 'video'
  width: number
  height: number
  dominantColor: string
  position: number
  eventId: number | null
  /** Thumbnail framing (event images); null = the centred square. */
  crop: ImageCrop | null
  /** Uploaded and not attached to anything yet. */
  pending: boolean
  /** Seconds of a video or of a Live Photo's clip. */
  duration: number | null
  /** Live Photos: the clip is shown. */
  live: boolean
  /** Drawn pictures (the scenario) or the files of a visitor's upload. */
  art: Art | null
  /** `video`: the video, or a Live Photo's clip (played as uploaded). */
  files: { thumb: Blob; display: Blob; video: Blob | null } | null
}

interface StoredEvent {
  id: number
  title: string
  titleSearch: string
  date: string
  /** Order among the events of the same date (lower first). */
  dayOrder: number
  notes: string
  location: string | null
  childIds: number[]
  /** Ordered: the first one is the primary category. */
  categoryIds: number[]
  coverImageId: string | null
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedBy: number | null
}

interface StoredChild {
  id: number
  name: string
  /** Made from the name when the child is added and never changed (links to `/c/<slug>` keep working). */
  slug: string
  birthDate: string | null
  avatarImageId: string | null
  /** Own colour of the child's line on the family timeline (`#rrggbb`); null = the automatic one. */
  color: string | null
  sortOrder: number
}

export interface EventInput {
  title: string
  date: string
  notes: string
  location: string | null
  child_ids: number[]
  category_ids: number[]
  images: { id: string; name: string; crop?: ImageCrop | null; live?: boolean | null }[]
  cover_image_id: string | null
}

/** No slug: it is made from the name when the child is added. */
export interface ChildInput {
  name: string
  birth_date: string | null
  avatar_image_id: string | null
}

export interface CategoryInput {
  name_es: string
  name_en: string
  name_pt: string
  icon: string
  color: string
}

export interface UploadedFile {
  fileName: string
  /** `video` for videos; a Live Photo is an `image` with a `video` (its clip). */
  kind: 'image' | 'video'
  width: number
  height: number
  dominantColor: string
  thumb: Blob
  display: Blob
  video: Blob | null
  duration: number | null
}

export interface TimelineQuery {
  q?: string
  dateFrom?: string | null
  dateTo?: string | null
  categoryIds?: readonly number[]
}

export interface AdminEventsQuery {
  q?: string
  childId?: number | null
  categoryId?: number | null
  dateFrom?: string | null
  dateTo?: string | null
  page: number
  pageSize: number
}

export interface UserUpdate {
  role: Role | null
  disabled: boolean | null
  /** Present only when the request sent `name` (blank or null clears it). */
  name?: string | null
}

export type MediaContent =
  | { kind: 'svg'; svg: string }
  | { kind: 'blob'; blob: Blob }
  /** A visitor's upload seen through its framing: cropped from `display` by the handler. */
  | { kind: 'framed'; display: Blob; crop: ImageCrop; size: PictureSize }

/** 12 hex digits identifying a framing (the backend hashes it too; only stability matters here). */
export function cropKey({ x, y, zoom }: ImageCrop): string {
  const text = `crop1:${x.toFixed(4)}:${y.toFixed(4)}:${zoom.toFixed(4)}`
  let first = 0x811c9dc5
  let second = 0x01000193
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ code, 0x811c9dc5) >>> 0
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`.slice(0, 12)
}

/** `thumb_url` of an image: framed thumbnails carry their key (like the backend). */
function thumbUrl(id: string, crop: ImageCrop | null): string {
  return crop ? `/api/media/${id}/thumb?v=${cropKey(crop)}` : `/api/media/${id}/thumb`
}

/** A photo uploaded with its clip. */
function isLivePhoto(image: StoredImage): boolean {
  return image.kind === 'image' && Boolean(image.files?.video)
}

// Text ----------------------------------------------------------------------------------------

/** Accent/case-insensitive search form (src/timelife/text.py `normalize_search`). */
export function normalizeSearch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/\s+/u).filter(Boolean).join(' ')
}

function searchTokens(q: string | undefined): string[] {
  return [...new Set(normalizeSearch(q ?? '').split(' ').filter(Boolean))]
}

/** ASCII slug of a name, at most 80 characters ('child' if empty). */
export function slugify(text: string): string {
  const ascii = text.normalize('NFKD').replace(/[^\u0020-\u007e]/g, '')
  const slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, '') || 'child'
}

function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  let slug = base
  for (let number = 2; taken.has(slug); number += 1) {
    const suffix = `-${number}`
    slug = `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
  }
  return slug
}

/** Display name of an upload: its file name without folders or extension, or "image". */
export function imageName(fileName: string): string {
  const name = (fileName.split(/[\\/]/).pop() ?? '')
    .normalize('NFC')
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\p{Cc}/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .join(' ')
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 && /^[A-Za-z0-9]{1,10}$/.test(name.slice(dot + 1)) && name.slice(0, dot).trim() ? name.slice(0, dot) : name
  return stem.slice(0, NAME_LENGTH).trim() || 'image'
}

/** src/timelife/events.py `NEWEST_FIRST`: date (newest first), day order, then the most recently created. */
const NEWEST_FIRST = (a: StoredEvent, b: StoredEvent) =>
  a.date !== b.date
    ? a.date < b.date
      ? 1
      : -1
    : a.dayOrder !== b.dayOrder
      ? a.dayOrder - b.dayOrder
      : a.createdAt !== b.createdAt
        ? a.createdAt < b.createdAt
          ? 1
          : -1
        : b.id - a.id

// Store ---------------------------------------------------------------------------------------

export class DemoStore {
  private readonly images = new Map<string, StoredImage>()
  private readonly events = new Map<number, StoredEvent>()
  private readonly children = new Map<number, StoredChild>()
  private readonly categories = new Map<number, CategoryOut>()
  private readonly users = new Map<number, UserOut>()
  private readonly yearColors = new Map<number, string>()
  private settings: { backgroundImageId: string | null; opacity: number; zoom: Zoom; desktop: Direction; mobile: Direction } = {
    backgroundImageId: null,
    opacity: 0.18,
    zoom: 'events',
    desktop: 'right_to_left',
    mobile: 'bottom_to_top',
  }
  private next = { event: 1, child: 1, category: 1, user: 1 }
  private readonly clock: () => Date
  readonly scenario: Scenario

  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock
    this.scenario = buildScenario(clock())
    this.load(this.scenario)
  }

  private now(): string {
    return isoInstant(this.clock())
  }

  private load({ children, events }: Scenario): void {
    CATEGORIES.forEach((category, index) => {
      const id = this.next.category++
      this.categories.set(id, { id, sort_order: index, ...category })
    })
    const categoryIds = new Map(CATEGORIES.map((category, index) => [category.key, index + 1]))

    const childIds = new Map<string, number>()
    children.forEach((child, index) => {
      const art: Art = { kind: 'avatar', seed: child.slug, background: child.background, hair: child.hair, shirt: child.shirt, pigtails: child.pigtails }
      this.addArt(child.avatarId, 'avatar', child.name, art, 800, 800)
      const id = this.next.child++
      this.children.set(id, {
        id,
        name: child.name,
        slug: child.slug,
        birthDate: child.birthDate,
        avatarImageId: child.avatarId,
        color: null,
        sortOrder: index,
      })
      childIds.set(child.slug, id)
    })

    for (const planned of events) {
      const { milestone } = planned
      const id = this.next.event++
      planned.photos.forEach((photo, position) => {
        const art: Art = photoArt(milestone, photo, position)
        const image = this.addArt(photo.id, 'event', photo.name, art, photo.width, photo.height)
        image.position = position
        image.eventId = id
      })
      this.events.set(id, {
        id,
        title: milestone.title,
        titleSearch: normalizeSearch(milestone.title).slice(0, TITLE_SEARCH_LENGTH),
        date: planned.date,
        dayOrder: 0,
        notes: milestone.notes,
        location: milestone.location,
        childIds: milestone.children.map((slug) => childIds.get(slug) as number),
        categoryIds: milestone.categories.map((key) => categoryIds.get(key) as number),
        coverImageId: planned.photos[planned.cover]?.id ?? null,
        version: 1,
        createdAt: planned.recordedAt,
        updatedAt: planned.recordedAt,
        deletedAt: null,
        deletedBy: null,
      })
    }

    const firstBirth = Date.parse(`${children[0].birthDate}T09:00:00Z`)
    const now = this.clock().getTime()
    for (const user of USERS) {
      const id = this.next.user++
      const invited = Math.min(now, firstBirth + user.invitedAfterDays * 86_400_000)
      this.users.set(id, {
        id,
        email: user.email,
        name: user.name,
        role: user.role,
        disabled: user.disabled,
        google_linked: false,
        has_password: true,
        must_change_password: user.password === 'temporary',
        created_at: isoInstant(new Date(invited)),
        last_login_at: user.lastLoginMinutesAgo === null ? null : isoInstant(new Date(Math.max(invited, now - user.lastLoginMinutesAgo * 60_000))),
      })
    }
  }

  private addArt(id: string, purpose: Purpose, name: string, art: Art, width: number, height: number): StoredImage {
    const image: StoredImage = {
      id,
      purpose,
      name,
      kind: 'image',
      width,
      height,
      dominantColor: dominantColor(art),
      position: 0,
      eventId: null,
      crop: null,
      pending: false,
      duration: null,
      live: false,
      art,
      files: null,
    }
    this.images.set(id, image)
    return image
  }

  // Session -----------------------------------------------------------------------------------

  /** The visitor: the demo has no sign-in and always acts as the first (administrator) user. */
  sessionUser(): SessionUserOut {
    const user = this.users.get(1) as UserOut
    return { id: user.id, email: user.email, name: user.name, role: user.role, has_password: user.has_password }
  }

  // Responses ---------------------------------------------------------------------------------

  private imageOut(image: StoredImage): ImageOut {
    const video = image.files?.video ?? null
    return {
      id: image.id,
      name: image.name,
      kind: image.kind,
      width: image.width,
      height: image.height,
      dominant_color: image.dominantColor,
      crop: image.crop ? { ...image.crop } : null,
      thumb_url: thumbUrl(image.id, image.crop),
      display_url: `/api/media/${image.id}/display`,
      // Played as uploaded: ready at once.
      video_status: video ? 'ready' : null,
      video_url: video ? `/api/media/${image.id}/video` : null,
      duration: image.duration,
      live: isLivePhoto(image) && image.live,
    }
  }

  private videoCount(eventId: number): number {
    return this.eventImages(eventId).filter((image) => image.kind === 'video').length
  }

  private eventImages(eventId: number): StoredImage[] {
    return [...this.images.values()].filter((image) => image.eventId === eventId).toSorted((a, b) => a.position - b.position)
  }

  private cover(event: StoredEvent): StoredImage | null {
    const image = event.coverImageId ? this.images.get(event.coverImageId) : undefined
    return image && image.eventId === event.id ? image : null
  }

  private eventOut(event: StoredEvent): EventOut {
    return {
      id: event.id,
      title: event.title,
      date: event.date,
      notes: event.notes,
      location: event.location,
      child_ids: event.childIds.toSorted((a, b) => a - b),
      category_ids: [...event.categoryIds],
      images: this.eventImages(event.id).map((image) => this.imageOut(image)),
      cover_image_id: event.coverImageId,
      version: event.version,
      created_at: event.createdAt,
      updated_at: event.updatedAt,
      deleted_at: event.deletedAt,
    }
  }

  private summaryOut(event: StoredEvent): EventSummaryOut {
    const cover = this.cover(event)
    return {
      id: event.id,
      title: event.title,
      date: event.date,
      location: event.location,
      child_ids: event.childIds.toSorted((a, b) => a - b),
      category_ids: [...event.categoryIds],
      cover: cover ? this.imageOut(cover) : null,
      image_count: this.eventImages(event.id).length,
      video_count: this.videoCount(event.id),
      updated_at: event.updatedAt,
    }
  }

  private childOut(child: StoredChild): ChildOut {
    const avatar = child.avatarImageId ? this.images.get(child.avatarImageId) : undefined
    return {
      id: child.id,
      name: child.name,
      slug: child.slug,
      birth_date: child.birthDate,
      avatar: avatar ? this.imageOut(avatar) : null,
      color: child.color,
      sort_order: child.sortOrder,
    }
  }

  private liveEvents(): StoredEvent[] {
    return [...this.events.values()].filter((event) => event.deletedAt === null)
  }

  // Reference data ----------------------------------------------------------------------------

  listChildren(): ChildOut[] {
    return [...this.children.values()].toSorted((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((child) => this.childOut(child))
  }

  listCategories(): CategoryOut[] {
    return [...this.categories.values()].toSorted((a, b) => a.sort_order - b.sort_order || a.id - b.id).map((category) => ({ ...category }))
  }

  appearance(): AppearanceOut {
    const background = this.settings.backgroundImageId ? this.images.get(this.settings.backgroundImageId) : undefined
    return {
      year_colors: [...this.yearColors].toSorted(([a], [b]) => b - a).map(([year, color]) => ({ year, color })),
      event_years: [...new Set(this.liveEvents().map((event) => Number(event.date.slice(0, 4))))].toSorted((a, b) => b - a),
      background: background && background.purpose === 'background' && !background.pending ? this.imageOut(background) : null,
      background_opacity: this.settings.opacity,
      default_zoom: this.settings.zoom,
      direction_desktop: this.settings.desktop,
      direction_mobile: this.settings.mobile,
    }
  }

  // Timeline and detail -----------------------------------------------------------------------

  /** A child's timeline, or every child's together (the family view) when `childId` is null. */
  timeline(childId: number | null, { q, dateFrom, dateTo, categoryIds = [] }: TimelineQuery): TimelineOut {
    if (dateFrom && dateTo && dateFrom > dateTo) throw new DemoApiError(422, 'invalid_request', { fields: { date_to: 'value_error' } })
    if (childId !== null && !this.children.has(childId)) throw new DemoApiError(404, 'child_not_found')
    const live = this.liveEvents().filter((event) => childId === null || event.childIds.includes(childId))
    const tokens = searchTokens(q)
    const wanted = new Set(categoryIds)
    const events = live
      .filter(
        (event) =>
          tokens.every((token) => event.titleSearch.includes(token)) &&
          (!dateFrom || event.date >= dateFrom) &&
          (!dateTo || event.date <= dateTo) &&
          (wanted.size === 0 || event.categoryIds.some((id) => wanted.has(id))),
      )
      .toSorted(NEWEST_FIRST)
    return {
      child_id: childId,
      total: live.length,
      events: events.map((event) => {
        const cover = this.cover(event)
        return {
          id: event.id,
          title: event.title,
          date: event.date,
          day_order: event.dayOrder,
          category_ids: [...event.categoryIds],
          child_ids: event.childIds.toSorted((a, b) => a - b),
          cover: cover ? { id: cover.id, thumb_url: thumbUrl(cover.id, cover.crop), dominant_color: cover.dominantColor } : null,
          image_count: this.eventImages(event.id).length,
          created_at: event.createdAt,
        }
      }),
    }
  }

  /** `GET /api/events/{id}`: trashed events are not found. */
  event(id: number): EventOut {
    const event = this.events.get(id)
    if (!event || event.deletedAt !== null) throw new DemoApiError(404, 'event_not_found')
    return this.eventOut(event)
  }

  // Administration: events --------------------------------------------------------------------

  /** `GET /api/admin/events/{id}`: trashed events too. */
  adminEvent(id: number): EventOut {
    const event = this.events.get(id)
    if (!event) throw new DemoApiError(404, 'event_not_found')
    return this.eventOut(event)
  }

  adminEvents({ q, childId, categoryId, dateFrom, dateTo, page, pageSize }: AdminEventsQuery): EventPageOut {
    if (dateFrom && dateTo && dateFrom > dateTo) throw new DemoApiError(422, 'invalid_request', { fields: { date_to: 'value_error' } })
    const tokens = searchTokens(q)
    const matching = this.liveEvents()
      .filter(
        (event) =>
          tokens.every((token) => event.titleSearch.includes(token)) &&
          (childId == null || event.childIds.includes(childId)) &&
          (categoryId == null || event.categoryIds.includes(categoryId)) &&
          (!dateFrom || event.date >= dateFrom) &&
          (!dateTo || event.date <= dateTo),
      )
      .toSorted(NEWEST_FIRST)
    const start = (page - 1) * pageSize
    return {
      items: matching.slice(start, start + pageSize).map((event) => this.summaryOut(event)),
      total: matching.length,
      page,
      page_size: pageSize,
    }
  }

  /**
   * `GET /api/admin/locations` (src/timelife/events.py `list_locations`): places of the live
   * events; spellings that differ only in case or accents are one place, named by its most used
   * spelling (on a tie, the one saved last); most used first, then alphabetically.
   */
  locations(): LocationOut[] {
    const places = new Map<string, Map<string, { count: number; latest: string }>>()
    for (const event of this.liveEvents()) {
      if (!event.location) continue
      const key = normalizeSearch(event.location)
      const spellings = places.get(key) ?? new Map<string, { count: number; latest: string }>()
      places.set(key, spellings)
      const spelling = spellings.get(event.location)
      if (!spelling) spellings.set(event.location, { count: 1, latest: event.updatedAt })
      else {
        spelling.count += 1
        if (event.updatedAt > spelling.latest) spelling.latest = event.updatedAt
      }
    }
    const merged = [...places].map(([key, spellings]) => {
      const variants = [...spellings]
      const [name] = variants.reduce((best, current) =>
        current[1].count > best[1].count || (current[1].count === best[1].count && current[1].latest > best[1].latest) ? current : best,
      )
      return { key, name, count: variants.reduce((total, [, spelling]) => total + spelling.count, 0) }
    })
    const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
    return merged
      .toSorted((a, b) => b.count - a.count || order(a.key, b.key) || order(a.name, b.name))
      .slice(0, MAX_LOCATIONS)
      .map(({ name, count }) => ({ name, count }))
  }

  private ensureReferences(body: EventInput): void {
    if (body.child_ids.some((id) => !this.children.has(id))) throw new DemoApiError(422, 'invalid_child')
    if (body.category_ids.some((id) => !this.categories.has(id))) throw new DemoApiError(422, 'invalid_category')
  }

  private chosenCover(body: EventInput): string | null {
    const ids = body.images.map((image) => image.id)
    if (body.cover_image_id === null) return ids[0] ?? null
    if (!ids.includes(body.cover_image_id)) throw new DemoApiError(422, 'invalid_cover')
    return body.cover_image_id
  }

  /** The listed images: pending event uploads, or images already attached to `eventId`. */
  private attachable(ids: readonly string[], purpose: Purpose, { eventId = null, keep = null }: { eventId?: number | null; keep?: string | null } = {}): StoredImage[] {
    if (new Set(ids).size !== ids.length) throw new DemoApiError(422, 'invalid_image')
    return ids.map((id) => {
      const image = this.images.get(id)
      const allowed =
        image !== undefined &&
        image.purpose === purpose &&
        (id === keep || (image.pending && image.eventId === null) || (eventId !== null && image.eventId === eventId))
      if (!allowed) throw new DemoApiError(422, 'invalid_image')
      return image
    })
  }

  /** Saves the event's fields and images (validated before anything changes). */
  private write(event: StoredEvent, body: EventInput, images: StoredImage[], cover: string | null, now: string): void {
    event.title = body.title
    event.titleSearch = normalizeSearch(body.title).slice(0, TITLE_SEARCH_LENGTH)
    event.date = body.date
    event.notes = body.notes
    event.location = body.location
    event.childIds = [...body.child_ids]
    event.categoryIds = [...body.category_ids]
    event.coverImageId = cover
    event.updatedAt = now
    const listed = new Set(images.map((image) => image.id))
    for (const image of this.eventImages(event.id)) if (!listed.has(image.id)) this.images.delete(image.id)
    images.forEach((image, position) => {
      image.position = position
      image.name = body.images[position].name
      image.crop = normalizeCrop(body.images[position].crop, image)
      image.live = isLivePhoto(image) && (body.images[position].live ?? true)
      image.eventId = event.id
      image.pending = false
    })
  }

  /** `dayOrder` that puts an event before every other live event of `date`. */
  private firstOfDay(date: string, otherThan: number | null = null): number {
    const orders = this.liveEvents()
      .filter((event) => event.date === date && event.id !== otherThan)
      .map((event) => event.dayOrder)
    return orders.length ? Math.min(...orders) - 1 : 0
  }

  createEvent(body: EventInput): EventOut {
    this.ensureReferences(body)
    const cover = this.chosenCover(body)
    const images = this.attachable(
      body.images.map((image) => image.id),
      'event',
    )
    const now = this.now()
    const id = this.next.event++
    const event: StoredEvent = {
      id,
      title: '',
      titleSearch: '',
      date: body.date,
      dayOrder: this.firstOfDay(body.date),
      notes: '',
      location: null,
      childIds: [],
      categoryIds: [],
      coverImageId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
    }
    this.write(event, body, images, cover, now)
    this.events.set(id, event)
    return this.eventOut(event)
  }

  updateEvent(id: number, body: EventInput & { version: number }): EventOut {
    const event = this.events.get(id)
    if (!event || event.deletedAt !== null) throw new DemoApiError(404, 'event_not_found')
    if (body.version !== event.version) throw new DemoApiError(409, 'event_stale')
    this.ensureReferences(body)
    const cover = this.chosenCover(body)
    const images = this.attachable(
      body.images.map((image) => image.id),
      'event',
      { eventId: id },
    )
    if (body.date !== event.date) event.dayOrder = this.firstOfDay(body.date, id)
    this.write(event, body, images, cover, this.now())
    event.version += 1
    return this.eventOut(event)
  }

  /** `PUT /api/admin/events/day-order`: the listed events of `date` take its places in that order. */
  reorderDay(date: string, ids: readonly number[]): EventSummaryOut[] {
    const day = this.liveEvents()
      .filter((event) => event.date === date)
      .toSorted(NEWEST_FIRST)
    const current = day.map((event) => event.id)
    const wanted = new Set(ids)
    if (ids.some((id) => !current.includes(id))) throw new DemoApiError(422, 'invalid_order')
    const order = [...current]
    current
      .flatMap((id, index) => (wanted.has(id) ? [index] : []))
      .forEach((slot, position) => {
        order[slot] = ids[position]
      })
    const byId = new Map(day.map((event) => [event.id, event]))
    order.forEach((id, position) => {
      const event = byId.get(id)
      if (event) event.dayOrder = position
    })
    return order.flatMap((id) => {
      const event = byId.get(id)
      return event ? [this.summaryOut(event)] : []
    })
  }

  deleteEvent(id: number, userId: number): void {
    const event = this.events.get(id)
    if (!event || event.deletedAt !== null) throw new DemoApiError(404, 'event_not_found')
    event.deletedAt = this.now()
    event.deletedBy = userId
  }

  trash(): TrashItemOut[] {
    return [...this.events.values()]
      .filter((event) => event.deletedAt !== null)
      .toSorted((a, b) => ((a.deletedAt as string) < (b.deletedAt as string) ? 1 : a.deletedAt === b.deletedAt ? b.id - a.id : -1))
      .map((event) => {
        const cover = this.cover(event)
        const deleter = event.deletedBy === null ? undefined : this.users.get(event.deletedBy)
        return {
          id: event.id,
          title: event.title,
          date: event.date,
          child_ids: event.childIds.toSorted((a, b) => a - b),
          category_ids: [...event.categoryIds],
          cover: cover ? this.imageOut(cover) : null,
          image_count: this.eventImages(event.id).length,
          video_count: this.videoCount(event.id),
          deleted_at: event.deletedAt as string,
          deleted_by: deleter ? deleter.name || deleter.email : null,
        }
      })
  }

  private trashed(id: number): StoredEvent {
    const event = this.events.get(id)
    if (!event) throw new DemoApiError(404, 'event_not_found')
    if (event.deletedAt === null) throw new DemoApiError(409, 'event_not_deleted')
    return event
  }

  restoreEvent(id: number): EventOut {
    const event = this.trashed(id)
    event.deletedAt = null
    event.deletedBy = null
    return this.eventOut(event)
  }

  purgeEvent(id: number): void {
    const event = this.trashed(id)
    for (const image of this.eventImages(id)) this.images.delete(image.id)
    this.events.delete(event.id)
  }

  // Administration: uploads and media ---------------------------------------------------------

  /** A pending upload, attached later by the form that uses it. */
  addUpload(purpose: Purpose, file: UploadedFile): UploadOut {
    const image: StoredImage = {
      id: crypto.randomUUID(),
      purpose,
      name: imageName(file.fileName),
      kind: file.kind,
      width: file.width,
      height: file.height,
      dominantColor: file.dominantColor,
      position: 0,
      eventId: null,
      crop: null,
      pending: true,
      duration: file.duration,
      // Live Photos start with their motion on.
      live: file.kind === 'image' && file.video !== null,
      art: null,
      files: { thumb: file.thumb, display: file.display, video: file.video },
    }
    this.images.set(image.id, image)
    return { ...this.imageOut(image), progress: null }
  }

  /** `GET /api/admin/uploads/{id}`: nothing to wait for in the demo (videos are played as uploaded). */
  upload(id: string): UploadOut {
    const image = this.images.get(id)
    if (!image) throw new DemoApiError(404, 'image_not_found')
    return { ...this.imageOut(image), progress: null }
  }

  /**
   * Viewers see attached avatars/backgrounds and images of live events; administrators everything.
   * `version` (thumbnails only) is the framing key of a `thumb_url`: only the current one exists.
   * `video` is the video of a video or the clip of a Live Photo (viewers: only while it is shown).
   */
  media(id: string, variant: string, isAdmin: boolean, version: string | null = null): MediaContent {
    const image = this.images.get(id)
    if (!image || (variant !== 'thumb' && variant !== 'display' && variant !== 'video')) throw new DemoApiError(404, 'image_not_found')
    const event = image.eventId === null ? undefined : this.events.get(image.eventId)
    const visible = !image.pending && (image.purpose !== 'event' || (event !== undefined && event.deletedAt === null))
    if (!isAdmin && !visible) throw new DemoApiError(404, 'image_not_found')
    if (variant === 'video') {
      const video = image.files?.video
      if (!video || (!isAdmin && image.kind !== 'video' && !image.live) || version !== null) throw new DemoApiError(404, 'image_not_found')
      return { kind: 'blob', blob: video }
    }
    if (version !== null) {
      if (variant !== 'thumb' || !image.crop || cropKey(image.crop) !== version) throw new DemoApiError(404, 'image_not_found')
      if (image.files) return { kind: 'framed', display: image.files.display, crop: image.crop, size: { width: image.width, height: image.height } }
      return { kind: 'svg', svg: renderArt(image.art as Art, 'thumb', image.crop) }
    }
    if (image.files) return { kind: 'blob', blob: image.files[variant as 'thumb' | 'display'] }
    return { kind: 'svg', svg: renderArt(image.art as Art, variant as Variant) }
  }

  // Administration: categories ----------------------------------------------------------------

  private category(id: number): CategoryOut {
    const category = this.categories.get(id)
    if (!category) throw new DemoApiError(404, 'category_not_found')
    return category
  }

  createCategory(body: CategoryInput): CategoryOut {
    const id = this.next.category++
    const orders = [...this.categories.values()].map((category) => category.sort_order)
    const category: CategoryOut = {
      id,
      key: null,
      ...body,
      color: body.color.toLowerCase(),
      sort_order: orders.length ? Math.max(...orders) + 1 : 0,
    }
    this.categories.set(id, category)
    return { ...category }
  }

  updateCategory(id: number, body: CategoryInput): CategoryOut {
    const category = this.category(id)
    Object.assign(category, body, { color: body.color.toLowerCase() })
    return { ...category }
  }

  deleteCategory(id: number): void {
    this.category(id)
    const events = [...this.events.values()].filter((event) => event.categoryIds.includes(id)).length
    if (events) throw new DemoApiError(409, 'category_in_use', { detail: { events } })
    this.categories.delete(id)
  }

  reorderCategories(ids: readonly number[]): CategoryOut[] {
    this.applyOrder(this.categories, ids, (category, position) => {
      category.sort_order = position
    })
    return this.listCategories()
  }

  /** 422 `invalid_order` unless `ids` lists every row exactly once. */
  private applyOrder<T>(rows: Map<number, T>, ids: readonly number[], place: (row: T, position: number) => void): void {
    if (ids.length !== rows.size || new Set(ids).size !== ids.length || ids.some((id) => !rows.has(id))) {
      throw new DemoApiError(422, 'invalid_order')
    }
    ids.forEach((id, position) => place(rows.get(id) as T, position))
  }

  // Administration: children ------------------------------------------------------------------

  private child(id: number): StoredChild {
    const child = this.children.get(id)
    if (!child) throw new DemoApiError(404, 'child_not_found')
    return child
  }

  /** Slug of a new child named `name`: `slugify(name)`, made unique among every child with `-2`, `-3`… */
  private newSlug(name: string): string {
    return uniqueSlug(slugify(name), new Set([...this.children.values()].map((child) => child.slug)))
  }

  createChild(body: ChildInput): ChildOut {
    const slug = this.newSlug(body.name)
    const [avatar] = body.avatar_image_id ? this.attachable([body.avatar_image_id], 'avatar') : []
    if (avatar) avatar.pending = false
    const orders = [...this.children.values()].map((child) => child.sortOrder)
    const id = this.next.child++
    const child: StoredChild = {
      id,
      name: body.name,
      slug,
      birthDate: body.birth_date,
      avatarImageId: avatar?.id ?? null,
      color: null,
      sortOrder: orders.length ? Math.max(...orders) + 1 : 0,
    }
    this.children.set(id, child)
    return this.childOut(child)
  }

  /** The slug stays: it never changes, not even when the child is renamed. */
  updateChild(id: number, body: ChildInput): ChildOut {
    const child = this.child(id)
    const previous = child.avatarImageId
    const [avatar] = body.avatar_image_id ? this.attachable([body.avatar_image_id], 'avatar', { keep: previous }) : []
    if (avatar) avatar.pending = false
    if (previous !== null && previous !== body.avatar_image_id) this.images.delete(previous)
    Object.assign(child, { name: body.name, birthDate: body.birth_date, avatarImageId: avatar?.id ?? null })
    return this.childOut(child)
  }

  deleteChild(id: number): void {
    const child = this.child(id)
    const events = [...this.events.values()].filter((event) => event.childIds.includes(id)).length
    if (events) throw new DemoApiError(409, 'child_in_use', { detail: { events } })
    if (child.avatarImageId) this.images.delete(child.avatarImageId)
    this.children.delete(id)
  }

  reorderChildren(ids: readonly number[]): ChildOut[] {
    this.applyOrder(this.children, ids, (child, position) => {
      child.sortOrder = position
    })
    return this.listChildren()
  }

  /** The child's own line colour on the family timeline. */
  setChildColor(id: number, color: string): ChildOut {
    const child = this.child(id)
    child.color = color.toLowerCase()
    return this.childOut(child)
  }

  /** Back to the automatic colour (nothing changes for a child without its own). */
  resetChildColor(id: number): ChildOut {
    const child = this.child(id)
    child.color = null
    return this.childOut(child)
  }

  // Administration: appearance ----------------------------------------------------------------

  setYearColor(year: number, color: string): AppearanceOut {
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) throw new DemoApiError(422, 'invalid_year')
    this.yearColors.set(year, color.toLowerCase())
    return this.appearance()
  }

  resetYearColor(year: number): AppearanceOut {
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) throw new DemoApiError(422, 'invalid_year')
    this.yearColors.delete(year)
    return this.appearance()
  }

  updateSettings(body: SettingsIn): AppearanceOut {
    const current = this.settings.backgroundImageId
    const wanted = body.background_image_id
    if (wanted !== null) {
      const [image] = this.attachable([wanted], 'background', { keep: current })
      image.pending = false
    }
    if (current !== null && current !== wanted && this.images.get(current)?.purpose === 'background') this.images.delete(current)
    this.settings = {
      backgroundImageId: wanted,
      opacity: body.background_opacity,
      zoom: body.default_zoom,
      desktop: body.direction_desktop,
      mobile: body.direction_mobile,
    }
    return this.appearance()
  }

  // Administration: users ---------------------------------------------------------------------

  listUsers(): UserOut[] {
    return [...this.users.values()]
      .toSorted((a, b) => Number(a.role !== 'admin') - Number(b.role !== 'admin') || (a.email < b.email ? -1 : a.email > b.email ? 1 : 0))
      .map((user) => ({ ...user }))
  }

  /** Without Google sign-in (as in the demo) a new user needs a temporary password. */
  createUser(body: { email: string; role: Role; name: string | null; password: string | null }): UserOut {
    if (body.password === null) throw new DemoApiError(422, 'invalid_request', { fields: { password: 'missing' } })
    if ([...this.users.values()].some((user) => user.email === body.email)) throw new DemoApiError(409, 'user_exists')
    const id = this.next.user++
    const user: UserOut = {
      id,
      email: body.email,
      name: body.name,
      role: body.role,
      disabled: false,
      google_linked: false,
      has_password: true,
      must_change_password: true,
      created_at: this.now(),
      last_login_at: null,
    }
    this.users.set(id, user)
    return { ...user }
  }

  private user(id: number): UserOut {
    const user = this.users.get(id)
    if (!user) throw new DemoApiError(404, 'user_not_found')
    return user
  }

  /** 409 when `user` may not stop being an enabled administrator. */
  private checkAdminLoss(user: UserOut): void {
    const enabledAdmin = (candidate: UserOut) => candidate.role === 'admin' && !candidate.disabled
    const others = [...this.users.values()].filter((candidate) => candidate.id !== user.id && enabledAdmin(candidate)).length
    if (enabledAdmin(user) && others === 0) throw new DemoApiError(409, 'last_admin')
  }

  updateUser(id: number, body: UserUpdate, actorId: number): UserOut {
    const user = this.user(id)
    const role = body.role ?? user.role
    const disabled = body.disabled ?? user.disabled
    if (role !== user.role || disabled !== user.disabled) {
      if (user.id === actorId) throw new DemoApiError(409, 'cannot_modify_self')
      if (role !== 'admin' || disabled) this.checkAdminLoss(user)
      user.role = role
      user.disabled = disabled
    }
    if ('name' in body) user.name = body.name || null
    return { ...user }
  }

  deleteUser(id: number, actorId: number): void {
    const user = this.user(id)
    if (user.id === actorId) throw new DemoApiError(409, 'cannot_modify_self')
    this.checkAdminLoss(user)
    this.users.delete(id)
    for (const event of this.events.values()) if (event.deletedBy === id) event.deletedBy = null
  }

  /** A new temporary password (nothing is stored: the demo has no sign-in). */
  setTemporaryPassword(id: number, actorId: number): UserOut {
    const user = this.user(id)
    if (user.id === actorId) throw new DemoApiError(409, 'cannot_modify_self')
    user.has_password = true
    user.must_change_password = true
    return { ...user }
  }

  // Administration: import & export -----------------------------------------------------------

  /**
   * What an export would hold. The demo cannot export or import (its photos are drawn in the
   * page and nothing is kept on a server): those requests answer `demo_unavailable`.
   */
  backupSummary(): BackupSummaryOut {
    const attached = [...this.images.values()].filter((image) => !image.pending)
    const eventImages = attached.filter((image) => image.purpose === 'event' && image.eventId !== null)
    const photos = eventImages.filter((image) => image.kind === 'image')
    const background = this.appearance().background
    const exported = attached.filter((image) => image.purpose !== 'background' || image.id === background?.id)
    const users = [...this.users.values()]
    const live = this.liveEvents().length
    return {
      events: live,
      trashed_events: this.events.size - live,
      photos: photos.length,
      live_photos: photos.filter(isLivePhoto).length,
      videos: eventImages.length - photos.length,
      children: this.children.size,
      categories: this.categories.size,
      users: users.length,
      admins: users.filter((user) => user.role === 'admin').length,
      year_colors: this.yearColors.size,
      background: background !== null,
      // Uploaded files by their size; drawn ones as a typical JPEG of their size would be.
      media_bytes: exported.reduce(
        (sum, image) =>
          sum + (image.files ? image.files.display.size + (image.files.video?.size ?? 0) : Math.round(image.width * image.height * 0.3)),
        0,
      ),
    }
  }
}
