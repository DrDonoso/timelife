import type { ReactNode, Ref } from 'react'
import {
  Button as AriaButton,
  Link as AriaLink,
  type ButtonProps as AriaButtonProps,
  type LinkProps as AriaLinkProps,
} from 'react-aria-components'
import styles from './Button.module.css'
import { Spinner } from './Spinner'
import { cx, renderIcon, type IconSource } from './utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const ICON_SIZES: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 }

interface ButtonLookProps {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon. */
  icon?: IconSource
  /** Trailing icon (e.g. a chevron). */
  iconEnd?: IconSource
  fullWidth?: boolean
  className?: string
  children?: ReactNode
}

export interface ButtonProps extends ButtonLookProps, Omit<AriaButtonProps, 'children' | 'className' | 'isPending'> {
  /** Shows a spinner and keeps the button focusable but inert (announced as busy). */
  isLoading?: boolean
  ref?: Ref<HTMLButtonElement>
}

function classes({ variant = 'secondary', size = 'md', fullWidth, className }: ButtonLookProps, iconOnly: boolean) {
  return cx(styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth, iconOnly && styles.iconOnly, className)
}

/** Text button (react-aria Button). Default variant `secondary`, size `md`. */
export function Button({
  variant,
  size = 'md',
  icon,
  iconEnd,
  isLoading = false,
  fullWidth,
  className,
  children,
  ref,
  ...props
}: ButtonProps) {
  const iconSize = ICON_SIZES[size]
  return (
    <AriaButton
      {...props}
      ref={ref}
      isPending={isLoading}
      className={classes({ variant, size, fullWidth, className }, !children)}
    >
      {isLoading ? <Spinner size={iconSize} decorative /> : renderIcon(icon, iconSize)}
      {children !== undefined && children !== null && <span className={styles.label}>{children}</span>}
      {renderIcon(iconEnd, iconSize)}
    </AriaButton>
  )
}

export interface LinkButtonProps extends ButtonLookProps, Omit<AriaLinkProps, 'children' | 'className'> {
  ref?: Ref<HTMLAnchorElement>
}

/** Link styled as a button (client-side navigation for in-app `href`s). */
export function LinkButton({ variant, size = 'md', icon, iconEnd, fullWidth, className, children, ref, ...props }: LinkButtonProps) {
  const iconSize = ICON_SIZES[size]
  return (
    <AriaLink {...props} ref={ref} className={classes({ variant, size, fullWidth, className }, !children)}>
      {renderIcon(icon, iconSize)}
      {children !== undefined && children !== null && <span className={styles.label}>{children}</span>}
      {renderIcon(iconEnd, iconSize)}
    </AriaLink>
  )
}
