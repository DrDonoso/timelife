import type { ImageOut } from '../api/schema.gen'
import type { OriginRect } from '../components/Modal'

/** Largest id the API accepts (ids are limited to 1..2^31-1). */
const MAX_ID = 2 ** 31 - 1

/** Lets a Modal's exit animation (≈200 ms) finish before the route changes. */
export const MODAL_EXIT_DELAY_MS = 220

/** `:eventId` route param → positive integer id, or `null` when it can't be an event id. */
export function parseEventId(value: string | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null
  const id = Number(value)
  return id >= 1 && id <= MAX_ID ? id : null
}

/** Cover first, then the remaining images in their saved order. */
export function orderImages(images: readonly ImageOut[], coverId: string | null | undefined): ImageOut[] {
  const cover = coverId ? images.find((image) => image.id === coverId) : undefined
  if (!cover) return [...images]
  return [cover, ...images.filter((image) => image !== cover)]
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** `originRect` from the router state set by the timeline (`{ originRect: { x, y, width, height } }`). */
export function readOriginRect(state: unknown): OriginRect | null {
  if (state === null || typeof state !== 'object' || !('originRect' in state)) return null
  const rect = (state as { originRect?: unknown }).originRect
  if (rect === null || typeof rect !== 'object') return null
  const { x, y, width, height } = rect as Record<string, unknown>
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/**
 * Photo open full screen, from the router state (`{ photo: <index> }`): the viewer has its own
 * history entry so that the phone's Back closes it. `null` when absent or out of `0..count-1`.
 */
export function readPhotoIndex(state: unknown, count: number): number | null {
  if (state === null || typeof state !== 'object' || !('photo' in state)) return null
  const photo = (state as { photo?: unknown }).photo
  return typeof photo === 'number' && Number.isInteger(photo) && photo >= 0 && photo < count ? photo : null
}

/** Router state of the full-screen entry: the current state (e.g. `originRect`) plus `photo`. */
export function withPhotoIndex(state: unknown, photo: number): Record<string, unknown> {
  const base = state !== null && typeof state === 'object' ? (state as Record<string, unknown>) : {}
  return { ...base, photo }
}

interface NavigationEntryLike {
  url: string | null
}

interface NavigationLike {
  currentEntry: { index: number } | null
  entries(): NavigationEntryLike[]
}

/**
 * True when the previous session-history entry is exactly `path` (pathname + search) on this
 * origin, so going back returns there without leaving a duplicate entry behind. Uses the
 * Navigation API where the browser has it; elsewhere (and in tests) it answers false.
 */
export function previousEntryIs(path: string, currentPath: string): boolean {
  if (typeof window === 'undefined') return false
  // Only meaningful when the router drives the real browser history (not a memory router).
  if (`${window.location.pathname}${window.location.search}` !== currentPath) return false
  const navigation = (window as Window & { navigation?: NavigationLike }).navigation
  const current = navigation?.currentEntry
  if (!navigation || !current || current.index < 1) return false
  const previous = navigation.entries()[current.index - 1]
  if (!previous?.url) return false
  try {
    const url = new URL(previous.url)
    return url.origin === window.location.origin && `${url.pathname}${url.search}` === path
  } catch {
    return false
  }
}

/** Indices `[start, end)` of the pagination dots shown around `active` (at most `max`). */
export function dotWindow(count: number, active: number, max = 7): { start: number; end: number } {
  if (count <= max) return { start: 0, end: count }
  const start = Math.min(Math.max(active - Math.floor(max / 2), 0), count - max)
  return { start, end: start + max }
}

const BUTTON_LIKE_INPUTS = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'color', 'file'])

/** Widgets that use the arrow keys themselves (text fields, sliders, lists, menus, tabs…). */
const ARROW_KEY_WIDGETS =
  '[role="textbox"],[role="slider"],[role="spinbutton"],[role="combobox"],[role="listbox"],[role="menu"],' +
  '[role="menubar"],[role="radiogroup"],[role="tablist"],[role="grid"],[role="tree"],[role="treegrid"]'

/** True when ←/→ pressed on `target` belong to it (the carousel must not react). */
export function ownsArrowKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  // Text fields, selects and media players (arrows seek a focused video).
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'VIDEO' || tag === 'AUDIO') return true
  if (tag === 'INPUT') return !BUTTON_LIKE_INPUTS.has((target as HTMLInputElement).type)
  return target.closest(ARROW_KEY_WIDGETS) !== null
}
