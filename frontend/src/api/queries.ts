import { QueryClient, useQuery } from '@tanstack/react-query'
import { ApiError, api } from './client'
import type {
  AppearanceOut,
  AuthConfigOut,
  CategoryOut,
  ChildOut,
  EventOut,
  SessionOut,
  TimelineOut,
  VersionOut,
} from './schema.gen'

/** Timeline filters (URL `q`, `from`, `to`, `cat`). Dates are `YYYY-MM-DD`. */
export interface TimelineFilters {
  q: string
  from: string | null
  to: string | null
  categoryIds: number[]
}

export const EMPTY_FILTERS: TimelineFilters = { q: '', from: null, to: null, categoryIds: [] }

/** Parameters of `GET /api/admin/events` (camelCase; map to snake_case when calling the API). */
export interface AdminEventsParams {
  q?: string
  childId?: number | null
  categoryId?: number | null
  /** Inclusive `YYYY-MM-DD` bounds. */
  from?: string | null
  to?: string | null
  page?: number
  pageSize?: number
}

/** Shared query keys. Invalidate by prefix (`['timeline']`, `['admin']`, …) after mutations. */
export const qk = {
  authConfig: ['auth', 'config'] as const,
  session: ['auth', 'session'] as const,
  version: ['version'] as const,
  children: ['children'] as const,
  categories: ['categories'] as const,
  appearance: ['appearance'] as const,
  timeline: (scope: number | 'all', filters: TimelineFilters) => ['timeline', scope, filters] as const,
  event: (id: number) => ['event', id] as const,
  adminEvents: (params: AdminEventsParams) => ['admin', 'events', params] as const,
  adminEvent: (id: number) => ['admin', 'event', id] as const,
  locations: ['admin', 'locations'] as const,
  trash: ['admin', 'trash'] as const,
  users: ['admin', 'users'] as const,
}

/** Query keys that stay cached when the user signs out (public, not personal data). */
const PUBLIC_ROOTS = new Set(['auth', 'version'])

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 2
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  })
}

/** Removes every cached query with private data (after sign-out or an expired session). */
export function clearPrivateQueries(client: QueryClient): void {
  const predicate = (query: { queryKey: readonly unknown[] }) => !PUBLIC_ROOTS.has(String(query.queryKey[0]))
  void client.cancelQueries({ predicate })
  client.removeQueries({ predicate })
}

/**
 * After creating, editing, deleting, restoring or purging events: timeline, detail, admin lists
 * and appearance (`event_years`) may all change.
 */
export function invalidateEventQueries(client: QueryClient, eventId?: number): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['timeline'] }),
    client.invalidateQueries({ queryKey: eventId === undefined ? ['event'] : qk.event(eventId) }),
    client.invalidateQueries({ queryKey: ['admin'] }),
    client.invalidateQueries({ queryKey: qk.appearance }),
  ]).then(() => undefined)
}

interface QueryToggle {
  /** Defaults to true; pass false to wait (e.g. until signed in). */
  enabled?: boolean
}

export function useAuthConfig() {
  return useQuery({
    queryKey: qk.authConfig,
    queryFn: ({ signal }) => api.get<AuthConfigOut>('/api/auth/config', { signal }),
    staleTime: Infinity,
  })
}

export function useSession() {
  return useQuery({
    queryKey: qk.session,
    queryFn: ({ signal }) => api.get<SessionOut>('/api/auth/session', { signal }),
    staleTime: 5 * 60_000,
  })
}

export function useVersion() {
  return useQuery({
    queryKey: qk.version,
    queryFn: ({ signal }) => api.get<VersionOut>('/api/version', { signal }),
    staleTime: Infinity,
  })
}

export function useChildren({ enabled = true }: QueryToggle = {}) {
  return useQuery({
    queryKey: qk.children,
    queryFn: ({ signal }) => api.get<ChildOut[]>('/api/children', { signal }),
    enabled,
  })
}

export function useCategories({ enabled = true }: QueryToggle = {}) {
  return useQuery({
    queryKey: qk.categories,
    queryFn: ({ signal }) => api.get<CategoryOut[]>('/api/categories', { signal }),
    enabled,
  })
}

export function useAppearance({ enabled = true }: QueryToggle = {}) {
  return useQuery({
    queryKey: qk.appearance,
    queryFn: ({ signal }) => api.get<AppearanceOut>('/api/appearance', { signal }),
    enabled,
  })
}

/**
 * Timeline of a child (by id) or of every child together (`'all'`) with server-side filters;
 * keeps the previous result while refetching.
 */
export function useTimeline(scope: number | 'all' | null | undefined, filters: TimelineFilters) {
  const childId = scope === 'all' ? null : (scope ?? null)
  return useQuery({
    queryKey: qk.timeline(scope ?? 0, filters),
    queryFn: ({ signal }) =>
      api.get<TimelineOut>(scope === 'all' ? '/api/timeline' : `/api/children/${scope}/timeline`, {
        params: {
          q: filters.q.trim(),
          date_from: filters.from,
          date_to: filters.to,
          category_id: filters.categoryIds,
        },
        signal,
      }),
    enabled: scope != null,
    // Filter changes keep the current events on screen; switching timeline must not show the old one's.
    placeholderData: (previous) => (previous && previous.child_id === childId ? previous : undefined),
  })
}

/** While a video of the event is converted, the event is fetched again this often. */
export const PROCESSING_REFRESH_MS = 5000

export function useEvent(id: number | null | undefined) {
  return useQuery({
    queryKey: qk.event(id ?? 0),
    queryFn: ({ signal }) => api.get<EventOut>(`/api/events/${id}`, { signal }),
    enabled: id != null,
    // A video still being converted becomes playable without reopening the event.
    refetchInterval: (query) =>
      query.state.data?.images.some((image) => image.video_status === 'processing') ? PROCESSING_REFRESH_MS : false,
  })
}
