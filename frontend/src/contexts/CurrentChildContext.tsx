import { createContext, use, useEffect, useMemo, type ReactNode } from 'react'
import { useMatch } from 'react-router'
import { useChildren } from '../api/queries'
import type { ChildOut } from '../api/schema.gen'
import { STORAGE_KEYS, readStorage, writeStorage } from '../utils/storage'
import { useAuth } from './AuthContext'

/** Path of the family timeline ("All together": every child at once). */
export const FAMILY_PATH = '/all'
/** Remembered choice of the family timeline (never a slug: slugs are `[a-z0-9-]`). */
export const FAMILY_CHOICE = '@all'

/** Which timeline is open: a child's (by id) or the family one. */
export type TimelineScope = number | 'all'

export interface CurrentChildValue {
  /** Every child, in admin order (empty while loading or signed out). */
  children: ChildOut[]
  /** Child of the current `/c/:childSlug` route (null elsewhere or when the slug is unknown). */
  child: ChildOut | null
  /** Slug in the URL, even when it doesn't match a child. */
  slug: string | null
  /** On the family timeline (`/all`, every child together). */
  isAll: boolean
  /** Timeline shown by the current route: the child's id, `'all'` or null elsewhere. */
  scope: TimelineScope | null
  /** Base path of the timeline in the URL (`/c/<slug>` or `/all`; known before the children load), null elsewhere. */
  timelinePath: string | null
  isLoading: boolean
  error: unknown
}

const NO_CHILDREN: ChildOut[] = []

const CurrentChildContext = createContext<CurrentChildValue | null>(null)

/** Slug (or {@link FAMILY_CHOICE}) remembered from the last visited timeline (`timelife.child`). */
export function rememberedChildSlug(): string | null {
  return readStorage(STORAGE_KEYS.child)
}

/** Remembered child when it still exists, else the first one. */
export function defaultChild(children: readonly ChildOut[]): ChildOut | null {
  const remembered = rememberedChildSlug()
  return children.find((child) => child.slug === remembered) ?? children[0] ?? null
}

/** Path of the timeline to open by default: the remembered one (the family view needs two children). */
export function defaultTimelinePath(children: readonly ChildOut[]): string | null {
  if (rememberedChildSlug() === FAMILY_CHOICE && children.length > 1) return FAMILY_PATH
  const child = defaultChild(children)
  return child ? `/c/${child.slug}` : null
}

export function CurrentChildProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const match = useMatch({ path: '/c/:childSlug', end: false })
  const isAll = useMatch({ path: FAMILY_PATH, end: false }) !== null
  const slug = match?.params.childSlug ?? null
  const query = useChildren({ enabled: auth.status === 'authenticated' })
  const list = query.data ?? NO_CHILDREN
  const child = slug === null ? null : (list.find((item) => item.slug === slug) ?? null)
  const childSlug = child?.slug ?? null

  useEffect(() => {
    if (childSlug) writeStorage(STORAGE_KEYS.child, childSlug)
    else if (isAll) writeStorage(STORAGE_KEYS.child, FAMILY_CHOICE)
  }, [childSlug, isAll])

  const isLoading = auth.status === 'loading' || query.isLoading
  const error = query.isError && !query.data ? query.error : null
  const scope: TimelineScope | null = isAll ? 'all' : (child?.id ?? null)
  const timelinePath = isAll ? FAMILY_PATH : slug !== null ? `/c/${slug}` : null
  const value = useMemo(
    () => ({ children: list, child, slug, isAll, scope, timelinePath, isLoading, error }),
    [list, child, slug, isAll, scope, timelinePath, isLoading, error],
  )
  return <CurrentChildContext value={value}>{children}</CurrentChildContext>
}

export function useCurrentChild(): CurrentChildValue {
  const context = use(CurrentChildContext)
  if (!context) throw new Error('useCurrentChild must be used inside <CurrentChildProvider>')
  return context
}
