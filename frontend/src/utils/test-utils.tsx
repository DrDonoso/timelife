// Shared helpers for vitest + Testing Library tests (import them from *.test.tsx files only).
import type { QueryClient } from '@tanstack/react-query'
import { fireEvent, render } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { vi } from 'vitest'
import { AppProviders, routes as appRoutes } from '../App'
import { createQueryClient } from '../api/queries'
import type { AuthConfigOut, CategoryOut, ChildOut, SessionOut } from '../api/schema.gen'
import { RootLayout } from '../shell/RootLayout'

// Motion animations complete instantly in tests (exit animations included).
MotionGlobalConfig.skipAnimations = true

export const ADMIN_SESSION: SessionOut = {
  authenticated: true,
  user: { id: 1, email: 'ada@example.com', name: 'Ada Admin', role: 'admin', has_password: true },
}
export const VIEWER_SESSION: SessionOut = {
  authenticated: true,
  user: { id: 2, email: 'vera@example.com', name: 'Vera Viewer', role: 'viewer', has_password: true },
}
export const ANONYMOUS_SESSION: SessionOut = { authenticated: false, user: null }
export const AUTH_CONFIG: AuthConfigOut = {
  google_enabled: true,
  dev_login_enabled: false,
  password_reset_enabled: false,
  setup_required: false,
}

export const TEST_CHILDREN: ChildOut[] = [
  { id: 1, name: 'Ana', slug: 'ana', birth_date: '2024-05-02', avatar: null, color: null, sort_order: 0 },
  { id: 2, name: 'Leo', slug: 'leo', birth_date: '2026-01-15', avatar: null, color: null, sort_order: 1 },
]

export const TEST_CATEGORIES: CategoryOut[] = [
  { id: 1, key: 'language', name_es: 'Lenguaje y comunicación', name_en: 'Language & communication', name_pt: 'Linguagem e comunicação', icon: 'message-circle', color: '#f59e0b', sort_order: 0 },
  { id: 2, key: 'sleep', name_es: 'Sueño', name_en: 'Sleep', name_pt: 'Sono', icon: 'moon', color: '#8b5cf6', sort_order: 1 },
  { id: 3, key: 'feeding', name_es: 'Alimentación', name_en: 'Feeding', name_pt: 'Alimentação', icon: 'baby-bottle', color: '#22c55e', sort_order: 2 },
]

const REPLY = Symbol('reply')

interface Reply {
  [REPLY]: true
  status: number
  body?: unknown
}

/** Explicit status (and optional JSON body) for a mocked endpoint: `reply(409, { code: 'slug_taken' })`. */
export function reply(status: number, body?: unknown): Reply {
  return { [REPLY]: true, status, body }
}

function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && REPLY in value
}

export interface MockRequest {
  url: URL
  method: string
  headers: Headers
  /** Parsed JSON body (FormData / raw values are passed through). */
  body: unknown
}

/** Static JSON body, a `reply(...)`, or a function computing either. */
export type MockHandler = unknown

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204 || body === undefined) return new Response(null, { status })
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * Stubs `fetch` with handlers keyed by `"METHOD /api/path"` (query string ignored).
 * Unknown endpoints answer 404 `{"code":"not_found"}`. Returns the mock for assertions.
 *
 *   mockApi({ 'GET /api/auth/session': ADMIN_SESSION, 'POST /api/admin/children': reply(409, { code: 'slug_taken' }) })
 */
export function mockApi(handlers: Record<string, MockHandler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const handler = handlers[`${method} ${url.pathname}`]
    if (handler === undefined) return jsonResponse(404, { code: 'not_found' })
    let body: unknown = init?.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        // keep the raw string
      }
    }
    const result =
      typeof handler === 'function'
        ? await (handler as (request: MockRequest) => unknown)({ url, method, headers: new Headers(init?.headers), body })
        : handler
    if (isReply(result)) return jsonResponse(result.status, result.body)
    return jsonResponse(200, result)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Session + auth config + reference data, plus any extra handlers. */
export function mockSignedIn(session: SessionOut = ADMIN_SESSION, extra: Record<string, MockHandler> = {}) {
  return mockApi({
    'GET /api/auth/session': session,
    'GET /api/auth/config': AUTH_CONFIG,
    'GET /api/version': { version: 'test', build_date: '' },
    'GET /api/children': TEST_CHILDREN,
    'GET /api/categories': TEST_CATEGORIES,
    'GET /api/appearance': {
      year_colors: [],
      event_years: [],
      background: null,
      background_opacity: 0.18,
      default_zoom: 'events',
      direction_desktop: 'right_to_left',
      direction_mobile: 'bottom_to_top',
    },
    'GET /api/admin/locations': [],
    ...extra,
  })
}

/** Query client without retries or background refetches (deterministic tests). */
export function createTestQueryClient(): QueryClient {
  const client = createQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: Infinity },
    mutations: { retry: false },
  })
  return client
}

export interface RenderOptions {
  /** Initial URL (default `/`). */
  route?: string
  /** Route pattern for `ui` (default `*`), e.g. `/c/:childSlug`. */
  path?: string
  queryClient?: QueryClient
}

/** Renders `ui` with every app provider (i18n, theme, auth, query, router, current child, toasts). */
export function renderWithProviders(ui: ReactNode, { route = '/', path = '*', queryClient = createTestQueryClient() }: RenderOptions = {}) {
  const routes: RouteObject[] = [{ element: <RootLayout />, children: [{ path, element: ui }] }]
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  const result = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...result, router, queryClient }
}

/** Renders the real app route tree at `route`. */
export function renderApp(route = '/', { queryClient = createTestQueryClient() }: Omit<RenderOptions, 'route' | 'path'> = {}) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [route] })
  const result = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...result, router, queryClient }
}

/** A finger at `[x, y]` (identifier 1), or `[x, y, identifier]`. */
export type Finger = readonly [x: number, y: number, id?: number]

function touchList(fingers: readonly Finger[]) {
  return fingers.map(([clientX, clientY, identifier = 1]) => ({ identifier, clientX, clientY, pageX: clientX, pageY: clientY }))
}

/**
 * Dispatches a touch event (jsdom has TouchEvent but no Touch): `touches` are the fingers on the
 * screen after it, `changed` the ones it is about (default `touches`; on touchend, the lifted ones).
 * An uncancelable touchmove is one the browser already scrolls with. Returns false when a listener
 * cancelled it.
 */
export function fireTouch(
  target: Element,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  touches: readonly Finger[],
  { changed = touches, cancelable = type !== 'touchcancel' }: { changed?: readonly Finger[]; cancelable?: boolean } = {},
): boolean {
  const event = new Event(type, { bubbles: true, cancelable, composed: true })
  Object.defineProperties(event, {
    touches: { value: touchList(touches) },
    targetTouches: { value: touchList(touches) },
    changedTouches: { value: touchList(changed) },
  })
  return fireEvent(target, event)
}

/**
 * Imports the lazily loaded route modules (admin pages, event detail). Use it as `beforeAll` in
 * files whose tests open those routes with {@link renderApp}: their first import transforms a
 * whole module graph on demand, which can outlast a `findBy*` wait when the suite runs in parallel.
 */
export async function preloadLazyRoutes(): Promise<void> {
  await Promise.all([
    import('../admin/AdminLayout'),
    import('../admin/events/EventsPage'),
    import('../admin/events/EventEditorPage'),
    import('../admin/trash/TrashPage'),
    import('../admin/categories/CategoriesPage'),
    import('../admin/children/ChildrenPage'),
    import('../admin/appearance/AppearancePage'),
    import('../admin/users/UsersPage'),
    import('../admin/backup/BackupPage'),
    import('../event-detail/EventDetailRoute'),
    import('../event-detail/NewEventRoute'),
    import('../admin/events/EventEditor'),
  ])
}
