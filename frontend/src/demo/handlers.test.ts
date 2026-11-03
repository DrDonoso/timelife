import { setupServer } from 'msw/node'
import { File as NodeFile } from 'node:buffer'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, isApiError } from '../api/client'
import type {
  BackupSummaryOut,
  CategoryOut,
  ChildOut,
  EventOut,
  EventPageOut,
  EventSummaryOut,
  LocationOut,
  SessionOut,
  TimelineOut,
  UploadOut,
  UserOut,
} from '../api/schema.gen'
import { UNHANDLED_PREFIX, handlers, resetDemo } from './handlers'
import { DemoApiError } from './validation'

// Browsers decode uploads with createImageBitmap/canvas, which jsdom lacks. Node's own Blob: the
// mocked API answers through Node's Response, which cannot read jsdom's.
vi.mock('./images', async () => {
  const { Blob: NodeBlob } = await import('node:buffer')
  return {
    processUpload: vi.fn(async (file: File, motion: File | null = null) => {
      if (file.name.endsWith('.heic')) throw new DemoApiError(422, 'unsupported_image')
      const video = file.name.endsWith('.mp4')
      return {
        fileName: file.name,
        kind: video ? 'video' : 'image',
        width: 1200,
        height: 900,
        dominantColor: '#abcdef',
        thumb: new NodeBlob(['thumb'], { type: 'image/webp' }),
        display: new NodeBlob(['display'], { type: 'image/png' }),
        video: video ? new NodeBlob(['0123456789'], { type: 'video/mp4' }) : motion ? new NodeBlob(['clip'], { type: 'video/quicktime' }) : null,
        duration: video ? 42 : motion ? 2.5 : null,
      }
    }),
    framedThumb: vi.fn(async (_display: Blob, crop: { x: number; y: number; zoom: number }) => new NodeBlob([`framed ${crop.x} ${crop.y} ${crop.zoom}`], { type: 'image/webp' })),
  }
})

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => resetDemo(() => new Date(2026, 9, 21, 12)))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

async function apiError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (isApiError(error)) return { status: error.status, code: error.code, ...(error.fields ? { fields: error.fields } : {}) }
    throw error
  }
  throw new Error('expected an API error')
}

/**
 * Multipart upload of a one-line file (plus a Live Photo's `motion` clip), built by hand: under
 * jsdom neither the app's XHR upload nor jsdom's FormData reach MSW intact, and Node's fetch only
 * parses multipart bodies with its own File.
 */
async function upload(fileName: string, purpose: string, motion?: string): Promise<UploadOut> {
  vi.stubGlobal('File', NodeFile)
  const boundary = 'demo-test-boundary'
  const part = (field: string, name: string) => [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${field}"; filename="${name}"`,
    'Content-Type: application/octet-stream',
    '',
    'not really a picture',
  ]
  const body = [...part('file', fileName), ...(motion ? part('motion', motion) : []), `--${boundary}--`, ''].join('\r\n')
  const response = await fetch(`/api/admin/uploads?purpose=${purpose}`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'X-Timelife-Request': '1' },
  })
  const answer = await response.json()
  if (!response.ok) throw new Error(`${response.status} ${answer.code}`)
  return answer
}

describe('demo API', () => {
  it('is always signed in as the demo administrator, with no sign-in methods', async () => {
    expect(await api.get<SessionOut>('/api/auth/session')).toEqual({
      authenticated: true,
      user: { id: 1, email: 'alex@example.com', name: 'Alex Carter', role: 'admin', has_password: true },
    })
    expect(await api.get('/api/auth/config')).toEqual({
      google_enabled: false,
      dev_login_enabled: false,
      password_reset_enabled: false,
      setup_required: false,
    })
    expect(await apiError(api.post('/api/auth/dev-login', { username: 'admin', password: 'admin' }))).toEqual({ status: 404, code: 'not_found' })
    expect(await apiError(api.post('/api/auth/google/start', {}))).toEqual({ status: 503, code: 'google_disabled' })
    // No e-mail either ("forgot password" needs SMTP): 404 whatever the body, like the API without SMTP.
    expect(await apiError(api.post('/api/auth/password/forgot', { email: 'alex@example.com', locale: 'pt' }))).toEqual({ status: 404, code: 'not_found' })
    for (const path of ['/api/auth/login', '/api/auth/password', '/api/auth/password/reset', '/api/auth/setup']) {
      expect(await apiError(api.post(path, {}))).toEqual({ status: 403, code: 'demo_unavailable' })
    }
    expect(await api.get('/api/version')).toEqual({ version: 'demo', build_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
  })

  it('gives access with a temporary password and resets passwords', async () => {
    expect(await apiError(api.post('/api/admin/users', { email: 'sam@example.com' }))).toEqual({
      status: 422,
      code: 'invalid_request',
      fields: { password: 'missing' },
    })
    expect(await apiError(api.post('/api/admin/users', { email: 'sam@example.com', password: 'corta' }))).toEqual({
      status: 422,
      code: 'invalid_request',
      fields: { password: 'string_too_short' },
    })
    const sam = await api.post<UserOut>('/api/admin/users', { email: 'Sam@Example.com', password: ' temporal 1 ' })
    expect(sam).toMatchObject({ email: 'sam@example.com', role: 'viewer', has_password: true, must_change_password: true })
    expect(await apiError(api.put(`/api/admin/users/${sam.id}/password`, { password: 'x' }))).toEqual({
      status: 422,
      code: 'invalid_request',
      fields: { password: 'string_too_short' },
    })
    expect(await api.put<UserOut>('/api/admin/users/3/password', { password: 'otra-temporal' })).toMatchObject({ must_change_password: true })
    expect(await apiError(api.put('/api/admin/users/1/password', { password: 'otra-temporal' }))).toEqual({ status: 409, code: 'cannot_modify_self' })
  })

  it('serves the timeline with filters from the query string', async () => {
    const timeline = await api.get<TimelineOut>('/api/children/2/timeline', { params: { q: 'first', category_id: [6, 1] } })
    expect(timeline.child_id).toBe(2)
    expect(timeline.events.length).toBeGreaterThan(0)
    expect(timeline.events.every((event) => /first/i.test(event.title))).toBe(true)
    expect(await apiError(api.get('/api/children/2/timeline', { params: { date_from: '2026-02-30' } }))).toEqual({
      status: 422,
      code: 'invalid_request',
      fields: { date_from: 'date_from_datetime_parsing' },
    })
    expect(await apiError(api.get('/api/children/abc/timeline'))).toMatchObject({ status: 422, fields: { child_id: 'int_parsing' } })
    const family = await api.get<TimelineOut>('/api/timeline', { params: { q: 'first' } })
    expect(family.child_id).toBeNull()
    expect(family.events.length).toBeGreaterThan(timeline.events.length)
    expect(family.events.every((event) => /first/i.test(event.title))).toBe(true)
  })

  it('answers validation errors like FastAPI and requires the CSRF header on writes', async () => {
    expect(await apiError(api.post('/api/admin/events', { title: ' ', date: '2026-13-01', child_ids: [], category_ids: [1, 1], extra: 1 }))).toEqual({
      status: 422,
      code: 'invalid_request',
      fields: {
        title: 'string_too_short',
        date: 'date_from_datetime_parsing',
        child_ids: 'too_short',
        category_ids: 'value_error',
        extra: 'extra_forbidden',
      },
    })
    const response = await fetch('/api/admin/categories', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'invalid_origin' })
  })

  it('uploads into memory, saves an event with it and serves its files', async () => {
    const image = await upload('Garden party.png', 'event')
    expect(image).toMatchObject({ name: 'Garden party', width: 1200, height: 900, dominant_color: '#abcdef', kind: 'image', video_status: null, progress: null })
    const event = await api.post<EventOut>('/api/admin/events', {
      title: 'Garden party',
      date: '2026-10-20',
      child_ids: [1, 2],
      category_ids: [1],
      images: [{ id: image.id, name: image.name }],
    })
    expect(event).toMatchObject({ cover_image_id: image.id, child_ids: [1, 2], version: 1 })
    const display = await fetch(image.display_url)
    expect(display.headers.get('content-type')).toBe('image/png')
    expect(await display.text()).toBe('display')
    await expect(upload('IMG_1.heic', 'event')).rejects.toThrow('422 unsupported_image')
    await expect(upload('a.png', 'poster')).rejects.toThrow('422 invalid_purpose')

    // Framing the cover: its thumbnail URL changes and serves the framed picture.
    const framed = await api.put<EventOut>(`/api/admin/events/${event.id}`, {
      title: 'Garden party',
      date: '2026-10-20',
      child_ids: [1, 2],
      category_ids: [1],
      images: [{ id: image.id, name: image.name, crop: { x: 0, y: 0.5, zoom: 2 } }],
      version: event.version,
    })
    const [cover] = framed.images
    expect(cover.crop).toEqual({ x: 0.1875, y: 0.5, zoom: 2 })
    expect(cover.thumb_url).toMatch(new RegExp(`^/api/media/${image.id}/thumb\\?v=[0-9a-f]{12}$`))
    expect(await (await fetch(cover.thumb_url)).text()).toBe('framed 0.1875 0.5 2')
    expect((await fetch(`${cover.thumb_url.slice(0, -12)}000000000000`)).status).toBe(404)
    expect((await fetch(`/api/media/${image.id}/thumb?v=nope`)).status).toBe(422)
    expect(
      await apiError(
        api.put(`/api/admin/events/${event.id}`, {
          title: 'Garden party',
          date: '2026-10-20',
          child_ids: [1],
          category_ids: [1],
          images: [{ id: image.id, name: image.name, crop: { x: 2, y: 0.5, zoom: 1 } }],
          version: framed.version,
        }),
      ),
    ).toEqual({ status: 422, code: 'invalid_request', fields: { x: 'less_than_equal' } })
  })

  it('draws the sample photos as SVG', async () => {
    const [event] = (await api.get<TimelineOut>('/api/children/1/timeline')).events
    const response = await fetch(event.cover?.thumb_url as string)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(await response.text()).toMatch(/^<svg [^>]*width="512" height="512"/)
    expect((await fetch('/api/media/00000000-0000-4000-8000-000000000000/thumb')).status).toBe(404)
    expect((await fetch('/api/media/not-a-uuid/thumb')).status).toBe(422)
  })

  it('filters the admin list by dates and orders the events of a day', async () => {
    const day = await api.get<EventPageOut>('/api/admin/events', { params: { date_from: '2025-03-10', date_to: '2025-03-10' } })
    const ids = day.items.map((item) => item.id)
    expect(ids).toHaveLength(2)
    const reordered = await api.put<EventSummaryOut[]>('/api/admin/events/day-order', { date: '2025-03-10', ids: ids.toReversed() })
    expect(reordered.map((item) => item.id)).toEqual(ids.toReversed())
    const timeline = await api.get<TimelineOut>('/api/children/1/timeline', { params: { date_from: '2025-03-10', date_to: '2025-03-10' } })
    expect(timeline.events.map((event) => [event.id, event.day_order])).toEqual([
      [ids[1], 0],
      [ids[0], 1],
    ])
    expect(await apiError(api.put('/api/admin/events/day-order', { date: '2025-03-10', ids: [ids[0], ids[0]] }))).toMatchObject({
      status: 422,
      fields: { ids: 'value_error' },
    })
    expect(await apiError(api.put('/api/admin/events/day-order', { date: '2025-03-11', ids }))).toEqual({ status: 422, code: 'invalid_order' })
    expect(await apiError(api.get('/api/admin/events', { params: { date_from: '2026-02-01', date_to: '2026-01-01' } }))).toMatchObject({
      status: 422,
      fields: { date_to: 'value_error' },
    })
  })

  it('makes a new child’s address from its name and never changes it', async () => {
    const refused = { status: 422, code: 'invalid_request', fields: { slug: 'extra_forbidden' } }
    expect(await apiError(api.post('/api/admin/children', { name: 'Mia', slug: 'mia' }))).toEqual(refused)
    expect(await apiError(api.post('/api/admin/children', { name: 'Mia', slug: null }))).toEqual(refused)
    const created = await api.post<ChildOut>('/api/admin/children', { name: ' Léo ' })
    expect(created).toEqual({ id: 3, name: 'Léo', slug: 'leo-2', birth_date: null, avatar: null, color: null, sort_order: 2 })
    const renamed = await api.put<ChildOut>(`/api/admin/children/${created.id}`, { name: 'Mia Rose', birth_date: '2026-05-01' })
    expect(renamed).toMatchObject({ name: 'Mia Rose', slug: 'leo-2', birth_date: '2026-05-01' })
    expect(await apiError(api.put(`/api/admin/children/${created.id}`, { name: 'Mia', slug: 'mia' }))).toEqual(refused)
    expect((await api.get<ChildOut[]>('/api/children')).map((child) => [child.name, child.slug])).toEqual([
      ['Emma', 'emma'],
      ['Leo', 'leo'],
      ['Mia Rose', 'leo-2'],
    ])
  })

  it('sets and resets a child’s own line colour', async () => {
    expect((await api.get<ChildOut[]>('/api/children')).map((child) => child.color)).toEqual([null, null])
    expect(await api.put<ChildOut>('/api/admin/children/2/color', { color: ' #AABBCC ' })).toMatchObject({ id: 2, slug: 'leo', color: '#aabbcc' })
    expect((await api.get<ChildOut[]>('/api/children')).map((child) => child.color)).toEqual([null, '#aabbcc'])
    const invalid: [Record<string, unknown>, Record<string, string>][] = [
      [{ color: 'red' }, { color: 'string_pattern_mismatch' }],
      [{ color: '#abc' }, { color: 'string_pattern_mismatch' }],
      [{ color: null }, { color: 'string_type' }],
      [{}, { color: 'missing' }],
      [{ color: '#000000', name: 'Leo' }, { name: 'extra_forbidden' }],
    ]
    for (const [body, fields] of invalid) {
      expect(await apiError(api.put('/api/admin/children/2/color', body))).toEqual({ status: 422, code: 'invalid_request', fields })
    }
    expect(await api.del<ChildOut>('/api/admin/children/2/color')).toMatchObject({ id: 2, slug: 'leo', color: null })
    // Resetting again changes nothing.
    expect(await api.del<ChildOut>('/api/admin/children/2/color')).toMatchObject({ id: 2, color: null })
    expect(await apiError(api.put('/api/admin/children/99/color', { color: '#000000' }))).toEqual({ status: 404, code: 'child_not_found' })
    expect(await apiError(api.del('/api/admin/children/99/color'))).toEqual({ status: 404, code: 'child_not_found' })
    expect(await apiError(api.del('/api/admin/children/abc/color'))).toMatchObject({ status: 422, fields: { child_id: 'int_parsing' } })
    // Neither "order" nor ".../color" is taken for the child of "/api/admin/children/:childId".
    expect((await api.put<ChildOut[]>('/api/admin/children/order', { ids: [2, 1] })).map((child) => child.id)).toEqual([2, 1])
    expect(await api.put<ChildOut>('/api/admin/children/1', { name: 'Emma', birth_date: '2024-03-10' })).toMatchObject({ id: 1, color: null })
  })

  it('names categories in Portuguese too', async () => {
    const categories = await api.get<CategoryOut[]>('/api/categories')
    expect(categories.map((category) => category.name_pt)).toContain('Linguagem e comunicação')
    const body = { name_es: 'Viajes', name_en: 'Travel', icon: 'plane', color: '#00AA00' }
    const invalid: [unknown, string][] = [
      [undefined, 'missing'],
      [' ', 'string_too_short'],
      ['x'.repeat(61), 'string_too_long'],
      ['Via\u0007gens', 'value_error'],
      [7, 'string_type'],
    ]
    for (const [name_pt, type] of invalid) {
      expect(await apiError(api.post('/api/admin/categories', { ...body, name_pt }))).toEqual({
        status: 422,
        code: 'invalid_request',
        fields: { name_pt: type },
      })
    }
    const created = await api.post<CategoryOut>('/api/admin/categories', { ...body, name_pt: '  Viagens \n de  família ' })
    expect(created).toMatchObject({ key: null, name_es: 'Viajes', name_en: 'Travel', name_pt: 'Viagens de família', color: '#00aa00' })
    expect(await apiError(api.put(`/api/admin/categories/${created.id}`, body))).toMatchObject({ status: 422, fields: { name_pt: 'missing' } })
    expect(await api.put<CategoryOut>(`/api/admin/categories/${created.id}`, { ...body, name_pt: 'Passeios' })).toMatchObject({ name_pt: 'Passeios' })
    expect((await api.get<CategoryOut[]>('/api/categories')).at(-1)).toMatchObject({ id: created.id, name_pt: 'Passeios' })
  })

  it('keeps changes until the demo is reset', async () => {
    await api.del('/api/admin/events/1')
    expect((await api.get<unknown[]>('/api/admin/trash')).length).toBe(1)
    resetDemo()
    expect(await api.get<unknown[]>('/api/admin/trash')).toEqual([])
  })

  it('suggests the places already used, the most used first', async () => {
    const places = await api.get<LocationOut[]>('/api/admin/locations')
    expect(places.length).toBeGreaterThan(0)
    expect(places[0]).toEqual({ name: expect.any(String), count: expect.any(Number) })
    const counts = places.map((place) => place.count)
    expect(counts).toEqual(counts.toSorted((a, b) => b - a))
  })

  it('plays videos and Live Photos as uploaded, with byte ranges and the Live choice', async () => {
    const movie = await upload('Picnic.mp4', 'event')
    expect(movie).toMatchObject({ kind: 'video', video_status: 'ready', video_url: `/api/media/${movie.id}/video`, duration: 42, live: false })
    const live = await upload('IMG_0001.HEIC.png', 'event', 'IMG_0001.MOV')
    expect(live).toMatchObject({ kind: 'image', video_status: 'ready', duration: 2.5, live: true })
    expect(await api.get(`/api/admin/uploads/${live.id}`)).toEqual(live)
    await expect(upload('avatar.png', 'avatar', 'clip.mov')).rejects.toThrow('422 invalid_live_photo')

    const whole = await fetch(movie.video_url as string)
    expect([whole.status, whole.headers.get('accept-ranges'), await whole.text()]).toEqual([200, 'bytes', '0123456789'])
    const part = await fetch(movie.video_url as string, { headers: { Range: 'bytes=2-5' } })
    expect([part.status, part.headers.get('content-range'), await part.text()]).toEqual([206, 'bytes 2-5/10', '2345'])
    const tail = await fetch(movie.video_url as string, { headers: { Range: 'bytes=-3' } })
    expect([tail.status, await tail.text()]).toEqual([206, '789'])
    expect((await fetch(movie.video_url as string, { headers: { Range: 'bytes=20-' } })).status).toBe(416)

    const event = await api.post<EventOut>('/api/admin/events', {
      title: 'Picnic',
      date: '2026-10-20',
      child_ids: [1],
      category_ids: [1],
      images: [
        { id: movie.id, name: 'Picnic' },
        { id: live.id, name: 'Laughs', live: false },
      ],
    })
    expect(event.images.map((image) => [image.kind, image.live])).toEqual([
      ['video', false],
      ['image', false],
    ])
    const [item] = (await api.get<EventPageOut>('/api/admin/events', { params: { q: 'picnic' } })).items
    expect([item.image_count, item.video_count]).toEqual([2, 1])
  })

  it('summarises what an export would hold, but cannot export or import', async () => {
    const summary = await api.get<BackupSummaryOut>('/api/admin/backup/summary')
    expect(summary).toMatchObject({ events: 82, trashed_events: 0, children: 2, categories: 11, users: 6, background: false })
    expect(summary.photos).toBeGreaterThan(82)
    expect(summary.media_bytes).toBeGreaterThan(0)
    expect(await api.get('/api/admin/backup/imports')).toEqual([])
    const unavailable = { status: 403, code: 'demo_unavailable' }
    expect(await apiError(api.post('/api/admin/backup/imports', { filename: 'copia.zip', size: 10 }))).toEqual(unavailable)
    expect(await apiError(api.get('/api/admin/backup/export'))).toEqual(unavailable)
    expect(await apiError(api.post(`/api/admin/backup/imports/${'0'.repeat(32)}/start`, { mode: 'merge' }))).toEqual(unavailable)
  })

  it('makes requests it does not serve loud', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await apiError(api.get('/api/not-there'))).toEqual({ status: 501, code: 'not_implemented' })
    expect(error).toHaveBeenCalledWith(`${UNHANDLED_PREFIX} GET /api/not-there`)
  })
})
