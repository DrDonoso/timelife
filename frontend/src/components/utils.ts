import type { TablerIcon } from '@tabler/icons-react'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'

/** A Tabler icon component (`IconPlus`) or a ready element (`<CategoryIcon icon="star" />`). */
export type IconSource = TablerIcon | ReactElement

/** Joins class names, skipping falsy values. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/** Renders an {@link IconSource}; components get `size`/`stroke` and are hidden from assistive tech. */
export function renderIcon(icon: IconSource | null | undefined, size: number, stroke = 2): ReactNode {
  if (!icon) return null
  if (isValidElement(icon)) return icon
  return createElement(icon, { size, stroke, 'aria-hidden': true, focusable: 'false' })
}
