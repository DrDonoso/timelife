/**
 * MSW request handlers: the whole Timelife API, answered in the browser from {@link DemoStore}.
 *
 * They intercept at the network layer, so the demo runs the app's real API client, queries and
 * error handling. There is no sign-in: the session is always the demo's administrator. Every
 * write changes the in-memory store and lasts until the page is reloaded. Any other /api request
 * hits the catch-all at the end (501 and a console error, which the tests watch).
 *
 * ORDER MATTERS: MSW uses the first matching handler (`/order` before `/:id`, catch-all last).
 */
import { http, HttpResponse, type DefaultBodyType, type JsonBodyType, type PathParams, type StrictRequest } from 'msw'
import { framedThumb, processUpload } from './images'
import { DemoStore, DIRECTIONS, PURPOSES, type EventInput, type Purpose, type TimelineQuery, type UserUpdate, type Zoom } from './store'
import { DemoApiError, HEX_COLOR, ICON_PATTERN, isISODateString, parseBody, type Body } from './validation'

// Replaced at build time by vite.config.ts (`define`).
declare const __DEMO_BUILD_DATE__: string

let store = new DemoStore()

/** The live store (tests inspect it). */
export function demoStore(): DemoStore {
  return store
}

/** Starts again from the scenario, as a page reload does (tests). */
export function resetDemo(clock?: () => Date): DemoStore {
  store = new DemoStore(clock)
  return store
}

/** Prefix of the console error logged for /api requests the demo does not answer. */
export const UNHANDLED_PREFIX = '[demo] Unhandled API request:'

const CSRF_HEADER = 'X-Timelife-Request'
const ID_MAX = 2_147_483_647
const ROLES = ['admin', 'viewer'] as const
const ZOOMS: readonly Zoom[] = ['years', 'months', 'events']
const MEDIA_CACHE = 'private, max-age=31536000, immutable'

interface Info {
  request: StrictRequest<DefaultBodyType>
  params: PathParams
}

interface Options {
  /** Success status (204 answers without a body). */
  status?: number
  admin?: boolean
}

/** Wraps a resolver: CSRF header on writes, administrator check, JSON answer, API errors. */
function answer(resolve: (info: Info) => unknown, { status = 200, admin = false }: Options = {}) {
  return async (info: Info) => {
    try {
      const { method } = info.request
      if (method !== 'GET' && method !== 'HEAD' && info.request.headers.get(CSRF_HEADER) !== '1') {
        throw new DemoApiError(403, 'invalid_origin')
      }
      if (admin && store.sessionUser().role !== 'admin') throw new DemoApiError(403, 'admin_required')
      const result = await resolve(info)
      if (result instanceof Response) return result
      if (status === 204) return new HttpResponse(null, { status })
      return HttpResponse.json(result as JsonBodyType, { status })
    } catch (error) {
      if (error instanceof DemoApiError) return HttpResponse.json(error.payload as JsonBodyType, { status: error.status })
      throw error
    }
  }
}

async function json(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new DemoApiError(422, 'invalid_request', { fields: { body: 'json_invalid' } })
  }
}

function invalid(field: string, type: string): DemoApiError {
  return new DemoApiError(422, 'invalid_request', { fields: { [field]: type } })
}

/** Integer path or query value (`field` names it in validation errors). */
function integer(raw: string | readonly string[] | undefined | null, field: string, min = 1, max = ID_MAX): number {
  const value = typeof raw === 'string' ? raw : undefined
  if (value === undefined) throw invalid(field, 'missing')
  if (!/^-?\d+$/.test(value.trim())) throw invalid(field, 'int_parsing')
  const number = Number(value)
  if (number < min) throw invalid(field, 'greater_than_equal')
  if (number > max) throw invalid(field, 'less_than_equal')
  return number
}

function optionalDate(query: URLSearchParams, field: string): string | null {
  const value = query.get(field)
  if (value === null || value === '') return null
  if (!isISODateString(value)) throw invalid(field, 'date_from_datetime_parsing')
  return value
}

function search(query: URLSearchParams): string {
  const q = query.get('q') ?? ''
  if (q.length > 200) throw invalid('q', 'string_too_long')
  return q
}

/** Filters of a timeline request (`q`, `date_from`, `date_to`, repeated `category_id`). */
function timelineQuery(request: Request): TimelineQuery {
  const query = new URL(request.url).searchParams
  return {
    q: search(query),
    dateFrom: optionalDate(query, 'date_from'),
    dateTo: optionalDate(query, 'date_to'),
    categoryIds: query.getAll('category_id').map((value) => integer(value, 'category_id')),
  }
}

// Bodies (src/timelife/contracts.py) ----------------------------------------------------------

function eventBody(body: Body): EventInput {
  const images = body.list('images', { max: 50 }, (item) => ({
    id: item.uuid('id') ?? '',
    name: item.text('name', { max: 160 }),
    crop: item.optionalObject('crop', (crop) => ({
      x: crop.number('x', { min: 0, max: 1 }),
      y: crop.number('y', { min: 0, max: 1 }),
      zoom: crop.number('zoom', { min: 1, max: 4 }),
    })),
    live: item.optionalBoolean('live'),
  }))
  body.check(new Set(images.map((image) => image.id)).size === images.length, 'images', 'value_error')
  return {
    title: body.text('title', { max: 120 }),
    date: body.date('date') ?? '',
    notes: body.text('notes', { min: 0, max: 5000, lines: 'multi' }, ''),
    location: body.optionalText('location', { max: 200 }),
    child_ids: body.ids('child_ids', { min: 1, max: 20, unique: true }),
    category_ids: body.ids('category_ids', { min: 1, max: 20, unique: true }),
    images,
    cover_image_id: body.uuid('cover_image_id', { optional: true }),
  }
}

/** No `slug`: it is made from the name when the child is added (a `slug` field is refused as unknown). */
function childBody(body: Body) {
  return {
    name: body.text('name', { max: 80 }),
    birth_date: body.date('birth_date', { optional: true }),
    avatar_image_id: body.uuid('avatar_image_id', { optional: true }),
  }
}

function categoryBody(body: Body) {
  return {
    name_es: body.text('name_es', { max: 60 }),
    name_en: body.text('name_en', { max: 60 }),
    name_pt: body.text('name_pt', { max: 60 }),
    icon: body.pattern('icon', ICON_PATTERN),
    color: body.pattern('color', HEX_COLOR),
  }
}

/** A year's or a child's own colour. */
function colorBody(body: Body): string {
  return body.pattern('color', HEX_COLOR)
}

function orderBody(body: Body): number[] {
  return body.ids('ids')
}

// Handlers ------------------------------------------------------------------------------------

const auth = [
  // No sign-in in the demo: neither Google nor the development login is offered…
  http.get('/api/auth/config', () =>
    HttpResponse.json({ google_enabled: false, dev_login_enabled: false, password_reset_enabled: false, setup_required: false }),
  ),
  // …and the visitor is always signed in as the demo's administrator.
  http.get('/api/auth/session', () => HttpResponse.json({ authenticated: true, user: store.sessionUser() })),
  // Signing out is not offered (the user menu resets the demo instead); answer like the API anyway.
  http.post('/api/auth/logout', answer(() => undefined, { status: 204 })),
  http.post('/api/auth/dev-login', answer(() => Promise.reject(new DemoApiError(404, 'not_found')))),
  http.post('/api/auth/google/start', answer(() => Promise.reject(new DemoApiError(503, 'google_disabled')))),
  // No e-mail either ("forgot password" needs SMTP), and no passwords are kept.
  http.post('/api/auth/password/forgot', answer(() => Promise.reject(new DemoApiError(404, 'not_found')))),
  ...['/api/auth/login', '/api/auth/password', '/api/auth/password/reset', '/api/auth/setup'].map((path) =>
    http.post(path, answer(() => Promise.reject(new DemoApiError(403, 'demo_unavailable')))),
  ),
]

const platform = [
  http.get('/api/version', () => HttpResponse.json({ version: 'demo', build_date: __DEMO_BUILD_DATE__ })),
]

const reading = [
  http.get('/api/children', answer(() => store.listChildren())),
  http.get('/api/categories', answer(() => store.listCategories())),
  http.get('/api/appearance', answer(() => store.appearance())),
  http.get(
    '/api/children/:childId/timeline',
    answer(({ request, params }) => store.timeline(integer(params.childId, 'child_id'), timelineQuery(request))),
  ),
  http.get('/api/timeline', answer(({ request }) => store.timeline(null, timelineQuery(request)))),
  http.get('/api/events/:eventId', answer(({ params }) => store.event(integer(params.eventId, 'event_id')))),
  http.get(
    '/api/media/:imageId/:variant',
    answer(async ({ request, params }) => {
      const id = typeof params.imageId === 'string' ? params.imageId.toLowerCase() : ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw invalid('image_id', 'uuid_parsing')
      const version = new URL(request.url).searchParams.get('v')
      if (version !== null && !/^[0-9a-f]{12}$/.test(version)) throw invalid('v', 'string_pattern_mismatch')
      const variant = String(params.variant)
      const content = store.media(id, variant, store.sessionUser().role === 'admin', version)
      if (content.kind === 'svg') return new HttpResponse(content.svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': MEDIA_CACHE } })
      const blob = content.kind === 'framed' ? await framedThumb(content.display, content.crop, content.size) : content.blob
      if (variant === 'video') return mediaRange(blob, request.headers.get('range'))
      return new HttpResponse(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream', 'Cache-Control': MEDIA_CACHE } })
    }),
  ),
]

/** A video answered like the API's `FileResponse`: whole, or the byte range a player asks for (206). */
export function mediaRange(blob: Blob, range: string | null): Response {
  const headers = { 'Content-Type': blob.type || 'video/mp4', 'Cache-Control': MEDIA_CACHE, 'Accept-Ranges': 'bytes' }
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (!match || (match[1] === '' && match[2] === '')) {
    return new HttpResponse(blob, { headers: { ...headers, 'Content-Length': String(blob.size) } })
  }
  const size = blob.size
  let start = match[1] === '' ? Math.max(0, size - Number(match[2])) : Number(match[1])
  let end = match[1] === '' || match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  if (start >= size || start > end) {
    return new HttpResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  start = Math.max(0, start)
  end = Math.max(start, end)
  return new HttpResponse(blob.slice(start, end + 1, blob.type), {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
  })
}

const events = [
  http.get(
    '/api/admin/events',
    answer(
      ({ request }) => {
        const query = new URL(request.url).searchParams
        const childId = query.get('child_id')
        const categoryId = query.get('category_id')
        return store.adminEvents({
          q: search(query),
          childId: childId === null ? null : integer(childId, 'child_id'),
          categoryId: categoryId === null ? null : integer(categoryId, 'category_id'),
          dateFrom: optionalDate(query, 'date_from'),
          dateTo: optionalDate(query, 'date_to'),
          page: query.has('page') ? integer(query.get('page'), 'page', 1, 100_000) : 1,
          pageSize: query.has('page_size') ? integer(query.get('page_size'), 'page_size', 1, 100) : 50,
        })
      },
      { admin: true },
    ),
  ),
  http.post(
    '/api/admin/events',
    answer(async ({ request }) => store.createEvent(parseBody(await json(request), eventBody)), { status: 201, admin: true }),
  ),
  // Before "/api/admin/events/:eventId" (MSW uses the first match).
  http.put(
    '/api/admin/events/day-order',
    answer(
      async ({ request }) => {
        const { date, ids } = parseBody(await json(request), (body) => ({
          date: body.date('date') ?? '',
          ids: body.ids('ids', { min: 1, max: 500, unique: true }),
        }))
        return store.reorderDay(date, ids)
      },
      { admin: true },
    ),
  ),
  http.get('/api/admin/events/:eventId', answer(({ params }) => store.adminEvent(integer(params.eventId, 'event_id')), { admin: true })),
  http.put(
    '/api/admin/events/:eventId',
    answer(
      async ({ request, params }) => {
        const id = integer(params.eventId, 'event_id')
        const body = parseBody(await json(request), (input) => ({ ...eventBody(input), version: input.id('version') }))
        return store.updateEvent(id, body)
      },
      { admin: true },
    ),
  ),
  http.delete(
    '/api/admin/events/:eventId',
    answer(({ params }) => store.deleteEvent(integer(params.eventId, 'event_id'), store.sessionUser().id), { status: 204, admin: true }),
  ),
  http.get('/api/admin/locations', answer(() => store.locations(), { admin: true })),
  http.get('/api/admin/trash', answer(() => store.trash(), { admin: true })),
  http.post(
    '/api/admin/trash/:eventId/restore',
    answer(({ params }) => store.restoreEvent(integer(params.eventId, 'event_id')), { admin: true }),
  ),
  http.delete(
    '/api/admin/trash/:eventId',
    answer(({ params }) => store.purgeEvent(integer(params.eventId, 'event_id')), { status: 204, admin: true }),
  ),
]

const uploads = [
  http.post(
    '/api/admin/uploads',
    answer(
      async ({ request }) => {
        const purpose = new URL(request.url).searchParams.get('purpose')
        if (purpose === null) throw invalid('purpose', 'missing')
        if (!PURPOSES.includes(purpose as Purpose)) throw new DemoApiError(422, 'invalid_purpose')
        let form: FormData
        try {
          form = await request.formData()
        } catch {
          throw invalid('file', 'missing')
        }
        const file = form.get('file')
        const motion = form.get('motion')
        // A form entry is a string or a File (no instanceof: tests run with two File classes).
        if (file === null || typeof file === 'string') throw invalid('file', 'missing')
        if (typeof motion === 'string') throw invalid('motion', 'missing')
        if (motion !== null && purpose !== 'event') throw new DemoApiError(422, 'invalid_live_photo')
        return store.addUpload(purpose as Purpose, await processUpload(file, motion, { event: purpose === 'event' }))
      },
      { status: 201, admin: true },
    ),
  ),
  http.get(
    '/api/admin/uploads/:imageId',
    answer(
      ({ params }) => {
        const id = typeof params.imageId === 'string' ? params.imageId.toLowerCase() : ''
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw invalid('image_id', 'uuid_parsing')
        return store.upload(id)
      },
      { admin: true },
    ),
  ),
]

const categories = [
  http.post(
    '/api/admin/categories',
    answer(async ({ request }) => store.createCategory(parseBody(await json(request), categoryBody)), { status: 201, admin: true }),
  ),
  http.put(
    '/api/admin/categories/order',
    answer(async ({ request }) => store.reorderCategories(parseBody(await json(request), orderBody)), { admin: true }),
  ),
  http.put(
    '/api/admin/categories/:categoryId',
    answer(
      async ({ request, params }) => {
        const id = integer(params.categoryId, 'category_id')
        return store.updateCategory(id, parseBody(await json(request), categoryBody))
      },
      { admin: true },
    ),
  ),
  http.delete(
    '/api/admin/categories/:categoryId',
    answer(({ params }) => store.deleteCategory(integer(params.categoryId, 'category_id')), { status: 204, admin: true }),
  ),
]

const children = [
  http.post(
    '/api/admin/children',
    answer(async ({ request }) => store.createChild(parseBody(await json(request), childBody)), { status: 201, admin: true }),
  ),
  // Before "/api/admin/children/:childId" (MSW uses the first match).
  http.put(
    '/api/admin/children/order',
    answer(async ({ request }) => store.reorderChildren(parseBody(await json(request), orderBody)), { admin: true }),
  ),
  http.put(
    '/api/admin/children/:childId/color',
    answer(
      async ({ request, params }) => {
        const id = integer(params.childId, 'child_id')
        return store.setChildColor(id, parseBody(await json(request), colorBody))
      },
      { admin: true },
    ),
  ),
  http.delete(
    '/api/admin/children/:childId/color',
    answer(({ params }) => store.resetChildColor(integer(params.childId, 'child_id')), { admin: true }),
  ),
  http.put(
    '/api/admin/children/:childId',
    answer(
      async ({ request, params }) => {
        const id = integer(params.childId, 'child_id')
        return store.updateChild(id, parseBody(await json(request), childBody))
      },
      { admin: true },
    ),
  ),
  http.delete(
    '/api/admin/children/:childId',
    answer(({ params }) => store.deleteChild(integer(params.childId, 'child_id')), { status: 204, admin: true }),
  ),
]

const appearance = [
  http.put(
    '/api/admin/year-colors/:year',
    answer(
      async ({ request, params }) => {
        const year = integer(params.year, 'year', -ID_MAX, ID_MAX)
        return store.setYearColor(year, parseBody(await json(request), colorBody))
      },
      { admin: true },
    ),
  ),
  http.delete(
    '/api/admin/year-colors/:year',
    answer(({ params }) => store.resetYearColor(integer(params.year, 'year', -ID_MAX, ID_MAX)), { admin: true }),
  ),
  http.put(
    '/api/admin/settings',
    answer(
      async ({ request }) =>
        store.updateSettings(
          parseBody(await json(request), (body) => ({
            background_image_id: body.uuid('background_image_id'),
            background_opacity: body.number('background_opacity', { min: 0, max: 1 }),
            default_zoom: body.literal('default_zoom', ZOOMS),
            direction_desktop: body.literal('direction_desktop', DIRECTIONS),
            direction_mobile: body.literal('direction_mobile', DIRECTIONS),
          })),
        ),
      { admin: true },
    ),
  ),
]

const users = [
  http.get('/api/admin/users', answer(() => store.listUsers(), { admin: true })),
  http.post(
    '/api/admin/users',
    answer(
      async ({ request }) =>
        store.createUser(
          parseBody(await json(request), (body) => ({
            email: body.email('email'),
            role: body.literal('role', ROLES, 'viewer'),
            name: body.optionalText('name', { max: 120 }),
            password: body.password('password', { optional: true }),
          })),
        ),
      { status: 201, admin: true },
    ),
  ),
  http.patch(
    '/api/admin/users/:userId',
    answer(
      async ({ request, params }) => {
        const id = integer(params.userId, 'user_id')
        const update = parseBody(await json(request), (body): UserUpdate => {
          const name = body.optionalText('name', { max: 120 })
          return {
            role: body.optionalLiteral('role', ROLES),
            disabled: body.optionalBoolean('disabled'),
            ...(body.present.has('name') ? { name } : {}),
          }
        })
        return store.updateUser(id, update, store.sessionUser().id)
      },
      { admin: true },
    ),
  ),
  http.put(
    '/api/admin/users/:userId/password',
    answer(
      async ({ request, params }) => {
        const id = integer(params.userId, 'user_id')
        parseBody(await json(request), (body) => body.password('password'))
        return store.setTemporaryPassword(id, store.sessionUser().id)
      },
      { admin: true },
    ),
  ),
  http.delete(
    '/api/admin/users/:userId',
    answer(({ params }) => store.deleteUser(integer(params.userId, 'user_id'), store.sessionUser().id), { status: 204, admin: true }),
  ),
]

const backup = [
  http.get('/api/admin/backup/summary', answer(() => store.backupSummary(), { admin: true })),
  http.get('/api/admin/backup/imports', answer(() => [], { admin: true })),
  // Exporting and importing need a server: everything else answers so, as a known error.
  http.all(
    '/api/admin/backup/*',
    answer(
      () => {
        throw new DemoApiError(403, 'demo_unavailable')
      },
      { admin: true },
    ),
  ),
]

/** Anything else under /api: a demo bug, made loud (console error + 501). */
const unhandled = http.all('/api/*', ({ request }) => {
  const { pathname } = new URL(request.url)
  console.error(`${UNHANDLED_PREFIX} ${request.method} ${pathname}`)
  return HttpResponse.json({ code: 'not_implemented' }, { status: 501 })
})

export const handlers = [
  ...auth,
  ...platform,
  ...reading,
  ...events,
  ...uploads,
  ...categories,
  ...children,
  ...appearance,
  ...users,
  ...backup,
  unhandled,
]
