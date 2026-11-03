import { IconCheck } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import {
  Header,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  Popover,
  Separator,
  Text,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  type MenuSectionProps as AriaMenuSectionProps,
  type Placement,
} from 'react-aria-components'
import overlay from './Overlay.module.css'
import { cx, renderIcon, type IconSource } from './utils'

export { MenuTrigger, SubmenuTrigger } from 'react-aria-components'

export interface MenuProps<T extends object> extends Omit<AriaMenuProps<T>, 'className'> {
  placement?: Placement
  className?: string
}

/**
 * Popover menu. Use inside `MenuTrigger` after its trigger button:
 * `<MenuTrigger><IconButton …/><Menu>…<MenuItem/></Menu></MenuTrigger>`.
 */
export function Menu<T extends object>({ placement = 'bottom end', className, ...props }: MenuProps<T>) {
  return (
    <Popover placement={placement} offset={8} className={overlay.popover}>
      <AriaMenu {...props} className={cx(overlay.list, className)} />
    </Popover>
  )
}

export interface MenuItemProps<T extends object = object> extends Omit<AriaMenuItemProps<T>, 'className' | 'children'> {
  icon?: IconSource
  description?: ReactNode
  tone?: 'default' | 'danger'
  className?: string
  children: ReactNode
}

/** Menu row with optional icon, description and a check mark in selectable sections. */
export function MenuItem<T extends object = object>({
  icon,
  description,
  tone = 'default',
  className,
  children,
  textValue,
  ...props
}: MenuItemProps<T>) {
  return (
    <AriaMenuItem
      {...props}
      textValue={textValue ?? (typeof children === 'string' ? children : undefined)}
      className={cx(overlay.option, tone === 'danger' && overlay.optionDanger, className)}
    >
      {({ isSelected, selectionMode }) => (
        <>
          {icon && <span className={overlay.optionIcon}>{renderIcon(icon, 18)}</span>}
          <span className={overlay.optionText}>
            <Text slot="label">{children}</Text>
            {description && (
              <Text slot="description" className={overlay.optionDescription}>
                {description}
              </Text>
            )}
          </span>
          {selectionMode !== 'none' && (
            <span className={overlay.optionCheck}>{isSelected && <IconCheck size={16} stroke={2.4} aria-hidden="true" />}</span>
          )}
        </>
      )}
    </AriaMenuItem>
  )
}

export interface MenuSectionProps<T extends object> extends Omit<AriaMenuSectionProps<T>, 'className' | 'children'> {
  /** Visible section heading. */
  title?: ReactNode
  className?: string
  children: ReactNode
}

export function MenuSection<T extends object>({ title, children, className, ...props }: MenuSectionProps<T>) {
  return (
    <AriaMenuSection {...props} className={className}>
      {title && <Header className={overlay.sectionHeader}>{title}</Header>}
      {children}
    </AriaMenuSection>
  )
}

export function MenuSeparator() {
  return <Separator className={overlay.separator} />
}
