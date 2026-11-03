/** Zoom levels from the widest to the most detailed ("events" is the user's "days" level). */
export const ZOOM_LEVELS = ['years', 'months', 'events'] as const

export type ZoomLevel = (typeof ZOOM_LEVELS)[number]

/** Horizontal (≥ 768 px, newest at the left) or vertical (mobile, newest at the top). */
export type Orientation = 'horizontal' | 'vertical'

export type NodeKind = 'year' | 'month' | 'event'

export const KIND_BY_LEVEL: Readonly<Record<ZoomLevel, NodeKind>> = { years: 'year', months: 'month', events: 'event' }

export const LEVEL_BY_KIND: Readonly<Record<NodeKind, ZoomLevel>> = { year: 'years', month: 'months', event: 'events' }

export function isZoomLevel(value: unknown): value is ZoomLevel {
  return typeof value === 'string' && (ZOOM_LEVELS as readonly string[]).includes(value)
}

/** 0 for years, 1 for months, 2 for events. */
export function levelDepth(level: ZoomLevel): number {
  return ZOOM_LEVELS.indexOf(level)
}
