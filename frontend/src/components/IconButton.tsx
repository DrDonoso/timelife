import type { ReactNode, Ref } from 'react'
import {
  Button as AriaButton,
  TooltipTrigger,
  type ButtonProps as AriaButtonProps,
  type Placement,
} from 'react-aria-components'
import styles from './IconButton.module.css'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'
import { cx, renderIcon, type IconSource } from './utils'

export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger' | 'overlay'
export type IconButtonSize = 'sm' | 'md' | 'lg'

const ICON_SIZES: Record<IconButtonSize, number> = { sm: 16, md: 20, lg: 22 }

export interface IconButtonProps
  extends Omit<AriaButtonProps, 'children' | 'className' | 'aria-label' | 'isPending'> {
  /** Accessible name, also shown as the tooltip. Include any state (e.g. "Filtros (2 activos)"). */
  label: string
  icon: IconSource
  /** `overlay` = translucent dark button for media (carousels). Default `ghost`. */
  variant?: IconButtonVariant
  size?: IconButtonSize
  /** Show the label as a tooltip on hover/focus (default true). */
  tooltip?: boolean
  tooltipPlacement?: Placement
  /** Small counter/dot on the top-right corner (visual only: put the information in `label`). */
  badge?: ReactNode
  isLoading?: boolean
  className?: string
  ref?: Ref<HTMLButtonElement>
}

/** Square/round icon-only button with a required accessible label and tooltip. */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  tooltip = true,
  tooltipPlacement = 'bottom',
  badge,
  isLoading = false,
  className,
  ref,
  ...props
}: IconButtonProps) {
  const button = (
    <AriaButton
      {...props}
      ref={ref}
      aria-label={label}
      isPending={isLoading}
      className={cx(styles.button, styles[variant], styles[size], className)}
    >
      {isLoading ? <Spinner size={ICON_SIZES[size]} decorative /> : renderIcon(icon, ICON_SIZES[size])}
      {badge !== undefined && badge !== null && badge !== false && (
        <span className={styles.badge} aria-hidden="true">
          {badge}
        </span>
      )}
    </AriaButton>
  )
  if (!tooltip) return button
  return (
    <TooltipTrigger delay={600} closeDelay={80}>
      {button}
      <Tooltip placement={tooltipPlacement}>{label}</Tooltip>
    </TooltipTrigger>
  )
}
