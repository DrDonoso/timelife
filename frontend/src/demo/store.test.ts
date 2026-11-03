import { beforeEach, describe, expect, it } from 'vitest'
import type { ImageCrop } from '../api/schema.gen'
import { normalizeCrop } from '../utils/crop'
import { cropKey, DemoStore, imageName, normalizeSearch, slugify, type EventInput, type UploadedFile } from './store'
import { DemoApiError } from './validation'

const NOW = new Date(2026, 9, 21, 12)
let store: DemoStore

function upload(name = 'Photo.jpg', changes: Partial<UploadedFile> = {}): UploadedFile {
  return {
    fileName: name,
    kind: 'image',
    width: 1200,
    height: 800,
    dominantColor: '#123456',
    thumb: new Blob(['thumb'], { type: 'image/webp' }),
    display: new Blob(['display'], { type: 'image/jpeg' }),
    video: null,
    duration: null,
    ...changes,
  }
}

function eventInput(overrides: Partial<EventInput> = {}): EventInput {
  return {
    title: 'Builds a den',
    date: '2026-10-20',
    notes: '',
    location: null,
    child_ids: [1],
    category_ids: [1],
    images: [],
    cover_image_id: null,
    ...overrides,
  }
}

/** Runs `action` and returns the API error it raised. */
function failure(action: () => unknown): { status: number; code: string; detail?: Record<string, unknown> } {
  try {
    action()
  } catch (error) {
    if (error instanceof DemoApiError) return { status: error.status, code: error.code, ...(error.detail ? { detail: error.detail } : {}) }
    throw error
  }
  throw new Error('expected an API error')
}

beforeEach(() => {
  store = new DemoStore(() => NOW)
})

describe('text helpers', () => {
  it('normalizes searches and slugs like the backend', () => {
    expect(normalizeSearch('  Árbol   de NAVIDAD ')).toBe('arbol de navidad')
    expect(slugify('Émma Rose!')).toBe('emma-rose')
    expect(slugify('***')).toBe('child')
    expect(imageName('C:\\fotos\\Beach day.HEIC')).toBe('Beach day')
    expect(imageName('.jpg')).toBe('.jpg')
    expect(imageName('')).toBe('image')
  })
})

describe('timeline', () => {
  it('lists a child’s live milestones newest first with covers and counts', () => {
    const timeline = store.timeline(1, {})
    expect(timeline.total).toBe(timeline.events.length)
    expect(timeline.events[0]).toMatchObject({ title: 'Rides her trike', date: '2026-10-17', image_count: 3 })
    expect(timeline.events[0].cover?.thumb_url).toMatch(/^\/api\/media\/[0-9a-f-]{36}\/thumb$/)
    const dates = timeline.events.map((event) => event.date)
    expect(dates).toEqual(dates.toSorted().toReversed())
    expect(timeline.events.at(-1)?.title).toBe('Welcome, Emma!')
    // Shared milestones appear on both timelines.
    expect(store.timeline(2, {}).events.some((event) => event.title === 'Brother and sister meet')).toBe(true)
  })

  it('filters by title words (accents and case ignored), inclusive dates and any category', () => {
    expect(store.timeline(1, { q: 'FIRST steps' }).events.map((event) => event.title)).toEqual(['First steps'])
    const range = store.timeline(1, { dateFrom: '2025-03-10', dateTo: '2025-03-10' }).events.map((event) => event.title)
    expect(range.toSorted()).toEqual(['First birthday!', 'First taste of cake'])
    const teeth = store.timeline(1, { categoryIds: [3] }).events
    expect(teeth.length).toBeGreaterThan(0)
    expect(teeth.every((event) => event.category_ids.includes(3))).toBe(true)
    expect(store.timeline(1, { q: 'nothing like this' })).toMatchObject({ events: [], total: store.timeline(1, {}).total })
  })

  it('refuses an inverted range and unknown children', () => {
    expect(failure(() => store.timeline(1, { dateFrom: '2026-01-02', dateTo: '2026-01-01' }))).toMatchObject({ status: 422, code: 'invalid_request' })
    expect(failure(() => store.timeline(99, {}))).toEqual({ status: 404, code: 'child_not_found' })
  })

  it('puts every child’s milestones together in the family timeline, shared ones once', () => {
    const family = store.timeline(null, {})
    const ids = family.events.map((event) => event.id)
    expect(family.child_id).toBeNull()
    expect(new Set(ids).size).toBe(ids.length)
    const own = new Set([...store.timeline(1, {}).events, ...store.timeline(2, {}).events].map((event) => event.id))
    expect(new Set(ids)).toEqual(own)
    expect(family.total).toBe(own.size)
    expect(family.events.some((event) => event.child_ids.length === 2)).toBe(true)
    const dates = family.events.map((event) => event.date)
    expect(dates).toEqual(dates.toSorted().toReversed())
    // Emma's and Leo's own "First steps".
    const steps = store.timeline(null, { q: 'FIRST steps' }).events
    expect(steps.map((event) => [event.title, event.child_ids])).toEqual([
      ['First steps', [2]],
      ['First steps', [1]],
    ])
  })
})

describe('events', () => {
  it('creates an event with pending uploads, the first one as default cover', () => {
    const [first, second] = [store.addUpload('event', upload('Den.jpg')), store.addUpload('event', upload())]
    const event = store.createEvent(eventInput({ images: [first, second].map(({ id, name }) => ({ id, name })) }))
    expect(event).toMatchObject({ title: 'Builds a den', version: 1, cover_image_id: first.id, deleted_at: null })
    expect(event.images.map((image) => image.name)).toEqual(['Den', 'Photo'])
    expect(store.timeline(1, {}).events[0]).toMatchObject({ id: event.id, image_count: 2 })
    // An attached image cannot be reused by another event.
    expect(failure(() => store.createEvent(eventInput({ images: [{ id: first.id, name: 'x' }] })))).toEqual({ status: 422, code: 'invalid_image' })
  })

  it('checks references and the cover', () => {
    expect(failure(() => store.createEvent(eventInput({ child_ids: [9] })))).toEqual({ status: 422, code: 'invalid_child' })
    expect(failure(() => store.createEvent(eventInput({ category_ids: [99] })))).toEqual({ status: 422, code: 'invalid_category' })
    const image = store.addUpload('event', upload())
    const cover = store.addUpload('event', upload())
    expect(
      failure(() => store.createEvent(eventInput({ images: [{ id: image.id, name: 'a' }], cover_image_id: cover.id }))),
    ).toEqual({ status: 422, code: 'invalid_cover' })
    const avatar = store.addUpload('avatar', upload())
    expect(failure(() => store.createEvent(eventInput({ images: [{ id: avatar.id, name: 'a' }] })))).toEqual({ status: 422, code: 'invalid_image' })
  })

  it('updates with optimistic versions and drops the images left out', () => {
    const original = store.adminEvent(1)
    const [kept, dropped] = original.images
    const body = { ...eventInput(), images: [{ id: kept.id, name: 'Renamed' }], version: original.version }
    const updated = store.updateEvent(1, body)
    expect(updated).toMatchObject({ title: 'Builds a den', version: 2, cover_image_id: kept.id })
    expect(updated.images.map((image) => image.name)).toEqual(['Renamed'])
    expect(failure(() => store.media(dropped.id, 'thumb', true))).toEqual({ status: 404, code: 'image_not_found' })
    expect(failure(() => store.updateEvent(1, body))).toEqual({ status: 409, code: 'event_stale' })
  })

  it('keeps thumbnail framings and serves the thumbnail of the current one', () => {
    const original = store.adminEvent(1)
    const [cover, other] = original.images
    const updated = store.updateEvent(1, {
      ...eventInput({ child_ids: original.child_ids }),
      images: [
        { id: cover.id, name: cover.name, crop: { x: 0, y: 0.5, zoom: 2 } },
        { id: other.id, name: other.name, crop: { x: 0.5, y: 0.5, zoom: 1 } },
      ],
      cover_image_id: cover.id,
      version: original.version,
    })
    const [framed, centred] = updated.images
    expect(framed.crop).toEqual(normalizeCrop({ x: 0, y: 0.5, zoom: 2 }, framed))
    const key = cropKey(framed.crop as ImageCrop)
    expect(key).toMatch(/^[0-9a-f]{12}$/)
    expect(framed.thumb_url).toBe(`/api/media/${cover.id}/thumb?v=${key}`)
    expect(centred).toMatchObject({ crop: null, thumb_url: `/api/media/${other.id}/thumb` })
    const event = store.timeline(original.child_ids[0], {}).events.find((item) => item.id === 1)
    expect(event?.cover?.thumb_url).toBe(framed.thumb_url)

    // Drawn pictures: an SVG of the framed square (here, flush with the left edge).
    const content = store.media(cover.id, 'thumb', false, key)
    if (content.kind !== 'svg') throw new Error('expected an SVG')
    expect(content.svg).toMatch(/^<svg [^>]*width="512" height="512" viewBox="0 /)
    expect(failure(() => store.media(cover.id, 'thumb', true, 'aaaaaaaaaaaa'))).toEqual({ status: 404, code: 'image_not_found' })
    expect(failure(() => store.media(cover.id, 'display', true, key))).toEqual({ status: 404, code: 'image_not_found' })

    // A visitor's upload is cropped from its display file by the media handler.
    const uploadOut = store.addUpload('event', upload())
    const created = store.createEvent(eventInput({ images: [{ id: uploadOut.id, name: 'Den', crop: { x: 0.25, y: 0.5, zoom: 2 } }] }))
    const crop = created.images[0].crop as ImageCrop
    expect(store.media(uploadOut.id, 'thumb', true, cropKey(crop))).toMatchObject({ kind: 'framed', crop, size: { width: 1200, height: 800 } })
  })

  it('moves events through the trash', () => {
    store.deleteEvent(5, 1)
    expect(failure(() => store.event(5))).toEqual({ status: 404, code: 'event_not_found' })
    expect(store.adminEvent(5).deleted_at).not.toBeNull()
    expect(store.trash()[0]).toMatchObject({ id: 5, deleted_by: 'Alex Carter' })
    expect(store.adminEvents({ page: 1, pageSize: 100 }).items.some((item) => item.id === 5)).toBe(false)
    expect(failure(() => store.deleteEvent(5, 1))).toEqual({ status: 404, code: 'event_not_found' })
    expect(store.restoreEvent(5).deleted_at).toBeNull()
    expect(failure(() => store.restoreEvent(5))).toEqual({ status: 409, code: 'event_not_deleted' })
    store.deleteEvent(5, 1)
    store.purgeEvent(5)
    expect(failure(() => store.adminEvent(5))).toEqual({ status: 404, code: 'event_not_found' })
    expect(store.trash()).toEqual([])
  })

  it('pages the admin list and filters it by child and category', () => {
    const page = store.adminEvents({ page: 2, pageSize: 20 })
    expect(page).toMatchObject({ page: 2, page_size: 20, total: 82 })
    expect(page.items).toHaveLength(20)
    expect(store.adminEvents({ childId: 2, page: 1, pageSize: 100 }).items.every((item) => item.child_ids.includes(2))).toBe(true)
    expect(store.adminEvents({ categoryId: 5, page: 1, pageSize: 100 }).items.every((item) => item.category_ids.includes(5))).toBe(true)
  })

  it('filters the admin list by an inclusive date range', () => {
    const day = store.adminEvents({ dateFrom: '2025-03-10', dateTo: '2025-03-10', page: 1, pageSize: 100 })
    expect(day.items.map((item) => item.title).toSorted()).toEqual(['First birthday!', 'First taste of cake'])
    const since = store.adminEvents({ dateFrom: '2026-01-01', page: 1, pageSize: 100 }).items
    expect(since.length).toBeGreaterThan(0)
    expect(since.every((item) => item.date >= '2026-01-01')).toBe(true)
    const until = store.adminEvents({ dateTo: '2024-12-31', page: 1, pageSize: 100 }).items
    expect(until.every((item) => item.date <= '2024-12-31')).toBe(true)
    expect(since.length + until.length).toBeLessThan(82)
    expect(failure(() => store.adminEvents({ dateFrom: '2026-01-02', dateTo: '2026-01-01', page: 1, pageSize: 20 }))).toMatchObject({
      status: 422,
      code: 'invalid_request',
    })
  })

  it('orders the events of a day like the API: new ones first, then as the administrator says', () => {
    const dayIds = () => store.adminEvents({ dateFrom: '2025-03-10', dateTo: '2025-03-10', page: 1, pageSize: 20 }).items.map((item) => item.id)
    const [first, second] = dayIds()
    const created = store.createEvent(eventInput({ title: 'Party games', date: '2025-03-10' }))
    expect(dayIds()).toEqual([created.id, first, second])

    // A subset takes the places its events already have.
    expect(store.reorderDay('2025-03-10', [second, created.id]).map((item) => item.id)).toEqual([second, first, created.id])
    expect(dayIds()).toEqual([second, first, created.id])
    const timeline = store.timeline(1, { dateFrom: '2025-03-10', dateTo: '2025-03-10' }).events
    expect(timeline.map((event) => [event.id, event.day_order])).toEqual([
      [second, 0],
      [first, 1],
      [created.id, 2],
    ])

    // Moving an event to another date puts it first of that day.
    const moved = store.adminEvents({ dateTo: '2024-12-31', page: 1, pageSize: 1 }).items[0].id
    expect(failure(() => store.reorderDay('2025-03-10', [moved, first]))).toEqual({ status: 422, code: 'invalid_order' })
    const original = store.adminEvent(moved)
    store.updateEvent(moved, { ...eventInput({ date: '2025-03-10' }), images: original.images.map(({ id, name }) => ({ id, name })), version: original.version })
    expect(dayIds()).toEqual([moved, second, first, created.id])
  })

  it('suggests the places of live events like the API: most used first, spellings merged', () => {
    const scenario = store.locations()
    expect(scenario.length).toBeGreaterThan(0)
    const counts = scenario.map((place) => place.count)
    expect(counts).toEqual(counts.toSorted((a, b) => b - a))

    for (const location of ['Esplugues', 'esplugues', 'Esplugues', 'Esplugues de Llobregat']) store.createEvent(eventInput({ location }))
    const places = store.locations()
    expect(places.filter((place) => normalizeSearch(place.name) === 'esplugues')).toEqual([{ name: 'Esplugues', count: 3 }])
    expect(places).toContainEqual({ name: 'Esplugues de Llobregat', count: 1 })
    expect(places.findIndex((place) => place.name === 'Esplugues')).toBeLessThan(places.findIndex((place) => place.name === 'Esplugues de Llobregat'))

    // The trash does not count.
    const trashed = store.createEvent(eventInput({ location: 'Only here once' }))
    expect(store.locations()).toContainEqual({ name: 'Only here once', count: 1 })
    store.deleteEvent(trashed.id, 1)
    expect(store.locations().some((place) => place.name === 'Only here once')).toBe(false)
  })
})

describe('categories and children', () => {
  it('creates, edits, reorders and protects categories in use (the trash counts)', () => {
    const created = store.createCategory({ name_es: 'Viajes', name_en: 'Travel', name_pt: 'Viagens', icon: 'plane', color: '#AABBCC' })
    expect(created).toEqual({ id: 12, key: null, name_es: 'Viajes', name_en: 'Travel', name_pt: 'Viagens', icon: 'plane', color: '#aabbcc', sort_order: 11 })
    const updated = store.updateCategory(12, { name_es: 'Viajes', name_en: 'Trips', name_pt: 'Passeios', icon: 'plane', color: '#000000' })
    expect(updated).toMatchObject({ name_en: 'Trips', name_pt: 'Passeios' })
    expect(store.listCategories().at(-1)).toEqual(updated)
    store.deleteCategory(12)
    const used = store.adminEvent(1).category_ids[0]
    expect(failure(() => store.deleteCategory(used))).toMatchObject({ status: 409, code: 'category_in_use' })
    const ids = store.listCategories().map((category) => category.id)
    expect(store.reorderCategories(ids.toReversed()).map((category) => category.id)).toEqual(ids.toReversed())
    expect(failure(() => store.reorderCategories(ids.slice(1)))).toEqual({ status: 422, code: 'invalid_order' })
  })

  it('starts with the default categories named in Spanish, English and Portuguese', () => {
    expect(store.listCategories().find((category) => category.key === 'language')).toMatchObject({
      name_es: 'Lenguaje y comunicación',
      name_en: 'Language & communication',
      name_pt: 'Linguagem e comunicação',
    })
    expect(store.listCategories().every((category) => category.name_pt.length > 0)).toBe(true)
  })

  it('makes each slug from the name once, unique, and never changes it', () => {
    const avatar = store.addUpload('avatar', upload('Face.png'))
    const child = store.createChild({ name: 'Emma', birth_date: null, avatar_image_id: avatar.id })
    expect(child).toMatchObject({ slug: 'emma-2', color: null, sort_order: 2, avatar: { id: avatar.id, name: 'Face' } })
    expect(store.createChild({ name: 'Émma!', birth_date: null, avatar_image_id: null }).slug).toBe('emma-3')
    // Renamed (even to another child's name), it keeps its address.
    const replacement = store.addUpload('avatar', upload())
    const updated = store.updateChild(child.id, { name: 'Leo', birth_date: '2026-01-01', avatar_image_id: replacement.id })
    expect(updated).toMatchObject({ name: 'Leo', slug: 'emma-2', birth_date: '2026-01-01', avatar: { id: replacement.id } })
    expect(store.listChildren().map((item) => item.slug)).toEqual(['emma', 'leo', 'emma-2', 'emma-3'])
    expect(failure(() => store.media(avatar.id, 'thumb', true))).toEqual({ status: 404, code: 'image_not_found' })
    store.deleteChild(child.id)
    // A deleted child's address is free again.
    expect(store.createChild({ name: 'Emma', birth_date: null, avatar_image_id: null }).slug).toBe('emma-2')
    expect(failure(() => store.deleteChild(1))).toMatchObject({ status: 409, code: 'child_in_use', detail: { events: expect.any(Number) } })
    expect(failure(() => store.updateChild(99, { name: 'X', birth_date: null, avatar_image_id: null }))).toEqual({ status: 404, code: 'child_not_found' })
  })

  it('gives a child its own line colour (lower-case) and takes it back', () => {
    expect(store.listChildren().map((child) => child.color)).toEqual([null, null])
    expect(store.setChildColor(2, '#AABBCC')).toMatchObject({ id: 2, slug: 'leo', color: '#aabbcc' })
    expect(store.listChildren().map((child) => child.color)).toEqual([null, '#aabbcc'])
    // Editing the child keeps it.
    const leo = store.listChildren()[1]
    expect(store.updateChild(2, { name: 'Leo', birth_date: leo.birth_date, avatar_image_id: leo.avatar?.id ?? null }).color).toBe('#aabbcc')
    expect(store.resetChildColor(2)).toEqual({ ...leo, color: null })
    // Resetting a child without its own colour changes nothing.
    expect(store.resetChildColor(2)).toEqual({ ...leo, color: null })
    expect(failure(() => store.setChildColor(99, '#000000'))).toEqual({ status: 404, code: 'child_not_found' })
    expect(failure(() => store.resetChildColor(99))).toEqual({ status: 404, code: 'child_not_found' })
  })
})

describe('users', () => {
  it('protects the visitor and the last administrator', () => {
    expect(store.sessionUser()).toEqual({ id: 1, email: 'alex@example.com', name: 'Alex Carter', role: 'admin', has_password: true })
    expect(store.listUsers().map((user) => user.role)).toEqual(['admin', 'admin', 'viewer', 'viewer', 'viewer', 'viewer'])
    expect(store.listUsers().filter((user) => user.must_change_password).map((user) => user.email)).toEqual(['mia@example.com'])
    expect(failure(() => store.updateUser(1, { role: 'viewer', disabled: null }, 1))).toEqual({ status: 409, code: 'cannot_modify_self' })
    expect(store.updateUser(2, { role: 'viewer', disabled: null, name: '' }, 1)).toMatchObject({ role: 'viewer', name: null })
    // Alex is now the only administrator.
    expect(failure(() => store.deleteUser(1, 3))).toEqual({ status: 409, code: 'last_admin' })
    expect(failure(() => store.createUser({ email: 'rose@example.com', role: 'viewer', name: null, password: 'temporal-1' }))).toEqual({
      status: 409,
      code: 'user_exists',
    })
    // Without Google sign-in (as in the demo) a new user needs a temporary password.
    expect(failure(() => store.createUser({ email: 'sam@example.com', role: 'admin', name: 'Sam', password: null }))).toEqual({
      status: 422,
      code: 'invalid_request',
    })
    const invited = store.createUser({ email: 'sam@example.com', role: 'admin', name: 'Sam', password: 'temporal-1' })
    expect(invited).toMatchObject({ google_linked: false, last_login_at: null, has_password: true, must_change_password: true })
    store.deleteUser(invited.id, 1)
    expect(failure(() => store.deleteUser(invited.id, 1))).toEqual({ status: 404, code: 'user_not_found' })
  })

  it('gives a temporary password to anyone but the visitor', () => {
    expect(store.setTemporaryPassword(3, 1)).toMatchObject({ email: 'rose@example.com', has_password: true, must_change_password: true })
    expect(failure(() => store.setTemporaryPassword(1, 1))).toEqual({ status: 409, code: 'cannot_modify_self' })
    expect(failure(() => store.setTemporaryPassword(99, 1))).toEqual({ status: 404, code: 'user_not_found' })
  })
})

describe('appearance and media', () => {
  it('stores year colours and the timeline settings with their background', () => {
    expect(store.appearance()).toMatchObject({
      year_colors: [],
      event_years: [2026, 2025, 2024],
      background: null,
      default_zoom: 'events',
      direction_desktop: 'right_to_left',
      direction_mobile: 'bottom_to_top',
    })
    expect(store.setYearColor(2025, '#ABCDEF').year_colors).toEqual([{ year: 2025, color: '#abcdef' }])
    expect(store.resetYearColor(2025).year_colors).toEqual([])
    expect(failure(() => store.setYearColor(1800, '#000000'))).toEqual({ status: 422, code: 'invalid_year' })
    const background = store.addUpload('background', upload())
    const directions = { direction_desktop: 'left_to_right', direction_mobile: 'top_to_bottom' } as const
    expect(store.updateSettings({ background_image_id: background.id, background_opacity: 0.4, default_zoom: 'months', ...directions })).toMatchObject({
      background: { id: background.id },
      background_opacity: 0.4,
      default_zoom: 'months',
      ...directions,
    })
    expect(store.appearance()).toMatchObject(directions)
    expect(
      failure(() => store.updateSettings({ background_image_id: store.addUpload('event', upload()).id, background_opacity: 0, default_zoom: 'years', ...directions })),
    ).toEqual({
      status: 422,
      code: 'invalid_image',
    })
  })

  it('serves drawn pictures as SVG and uploads as their files, hiding pending ones from viewers', () => {
    const cover = store.timeline(1, {}).events[0].cover
    const drawn = store.media(cover?.id as string, 'display', false)
    expect(drawn.kind === 'svg' && drawn.svg.startsWith('<svg')).toBe(true)
    const pending = store.addUpload('event', upload())
    expect(failure(() => store.media(pending.id, 'thumb', false))).toEqual({ status: 404, code: 'image_not_found' })
    const file = store.media(pending.id, 'display', true)
    expect(file.kind === 'blob' && file.blob.type).toBe('image/jpeg')
    expect(failure(() => store.media(pending.id, 'original', true))).toEqual({ status: 404, code: 'image_not_found' })
    // Photos have no video.
    expect(failure(() => store.media(pending.id, 'video', true))).toEqual({ status: 404, code: 'image_not_found' })
  })

  it('keeps the clip of Live Photos, shown to viewers only while Live is on', () => {
    const clip = new Blob(['clip'], { type: 'video/quicktime' })
    const live = store.addUpload('event', upload('IMG_7.jpg', { video: clip, duration: 2.5 }))
    const movie = store.addUpload('event', upload('Paseo.mp4', { kind: 'video', video: new Blob(['movie'], { type: 'video/mp4' }), duration: 30 }))
    expect(live).toMatchObject({ kind: 'image', video_status: 'ready', live: true, duration: 2.5, progress: null })
    expect(movie).toMatchObject({ kind: 'video', live: false, video_url: `/api/media/${movie.id}/video` })
    const event = store.createEvent(
      eventInput({
        images: [
          { id: live.id, name: 'Risas', live: false },
          { id: movie.id, name: 'Paseo', live: true },
        ],
      }),
    )
    expect(event.images.map((image) => image.live)).toEqual([false, false])
    expect(failure(() => store.media(live.id, 'video', false))).toEqual({ status: 404, code: 'image_not_found' })
    const own = store.media(live.id, 'video', true)
    expect(own.kind === 'blob' && own.blob).toBe(clip)
    expect(store.media(movie.id, 'video', false).kind).toBe('blob')
    expect(store.adminEvents({ page: 1, pageSize: 50 }).items.find((item) => item.id === event.id)).toMatchObject({ image_count: 2, video_count: 1 })

    // Saved without a choice, a Live Photo moves again.
    const updated = store.updateEvent(event.id, { ...eventInput(), images: [{ id: live.id, name: 'Risas' }], version: event.version })
    expect(updated.images[0].live).toBe(true)
    expect(store.media(live.id, 'video', false).kind).toBe('blob')
    expect(store.upload(live.id)).toMatchObject({ id: live.id, live: true })
    expect(failure(() => store.upload('00000000-0000-4000-8000-000000000000'))).toEqual({ status: 404, code: 'image_not_found' })
  })
})
