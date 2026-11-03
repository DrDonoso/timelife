import type { IconProps } from '@tabler/icons-react'
import { createElement } from 'react'
import { categoryIcon } from './registry'

export interface CategoryIconProps extends IconProps {
  /** Registry key (`CategoryOut.icon`); unknown keys render the fallback icon. */
  icon: string | null | undefined
}

/** Category icon by key. Decorative by default; pass `aria-label` (or `title`) to expose it. */
export function CategoryIcon({ icon, size = 20, stroke = 1.75, ...rest }: CategoryIconProps) {
  const labelled = Boolean(rest['aria-label'] || rest.title)
  return createElement(categoryIcon(icon), {
    size,
    stroke,
    'aria-hidden': labelled ? undefined : true,
    focusable: 'false',
    role: labelled ? 'img' : undefined,
    ...rest,
  })
}
