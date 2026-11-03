import type { AppearanceOut } from '../api/schema.gen'
import type { Orientation } from './types'

/** How time runs along the timeline, oldest → newest (appearance settings, per kind of device). */
export type TimelineDirection = AppearanceOut['direction_desktop']

export interface TimelineDirections {
  /** Desktops and tablets (≥ 768 px wide). */
  desktop: TimelineDirection
  /** Phones. */
  mobile: TimelineDirection
}

/** Today's layout: newest on the left on desktops, at the top on phones. */
export const DEFAULT_DIRECTIONS: TimelineDirections = { desktop: 'right_to_left', mobile: 'bottom_to_top' }

/**
 * Where the timeline sits on screen. The layout itself is logical — `main` grows from the newest
 * milestone towards the oldest — and a `reversed` frame shows it mirrored, with the newest at the
 * right (horizontal) or at the bottom (vertical) end.
 */
export interface AxisFrame {
  orientation: Orientation
  /** Newest milestone at the right / bottom end. */
  reversed: boolean
  /** Phone-sized screen (horizontal lines use smaller circles). */
  compact: boolean
}

export function frameOf(direction: TimelineDirection, compact: boolean): AxisFrame {
  switch (direction) {
    case 'left_to_right':
      return { orientation: 'horizontal', reversed: true, compact }
    case 'right_to_left':
      return { orientation: 'horizontal', reversed: false, compact }
    case 'top_to_bottom':
      return { orientation: 'vertical', reversed: true, compact }
    default:
      return { orientation: 'vertical', reversed: false, compact }
  }
}

/** Frame for the current screen size (`mobile` below 768 px). */
export function frameFor(directions: TimelineDirections, mobile: boolean): AxisFrame {
  return frameOf(mobile ? directions.mobile : directions.desktop, mobile)
}

export function sameFrame(a: AxisFrame, b: AxisFrame): boolean {
  return a.orientation === b.orientation && a.reversed === b.reversed && a.compact === b.compact
}

/**
 * Logical ↔ physical position along an extent of `size` px (an involution): track positions
 * against the track length, screen offsets against the viewport, scroll offsets against the
 * maximum scroll.
 */
export function mirror(value: number, size: number, reversed: boolean): number {
  return reversed ? size - value : value
}
