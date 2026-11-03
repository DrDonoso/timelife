import type { ReactNode } from 'react'
import { OverlayArrow, Tooltip as AriaTooltip, type TooltipProps as AriaTooltipProps } from 'react-aria-components'
import styles from './Tooltip.module.css'
import { cx } from './utils'

export interface TooltipProps extends Omit<AriaTooltipProps, 'children' | 'className'> {
  children: ReactNode
  className?: string
}

/** Styled react-aria Tooltip; place inside a `TooltipTrigger` next to its trigger. */
export function Tooltip({ children, className, offset = 8, ...props }: TooltipProps) {
  return (
    <AriaTooltip {...props} offset={offset} className={cx(styles.tooltip, className)}>
      <OverlayArrow className={styles.arrow}>
        <svg width={10} height={6} viewBox="0 0 10 6" aria-hidden="true">
          <path d="M0 0 L5 6 L10 0" />
        </svg>
      </OverlayArrow>
      {children}
    </AriaTooltip>
  )
}
