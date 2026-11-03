import type { ReactNode } from 'react'
import styles from './PageHeader.module.css'
import { cx, renderIcon, type IconSource } from './utils'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  icon?: IconSource
  /** Primary actions (e.g. "Nuevo evento"), aligned to the end. */
  actions?: ReactNode
  className?: string
}

/** Page title block for admin pages: icon + h1 + description, actions on the right. */
export function PageHeader({ title, description, icon, actions, className }: PageHeaderProps) {
  return (
    <header className={cx(styles.header, className)}>
      <div className={styles.heading}>
        {icon && (
          <span className={styles.icon} aria-hidden="true">
            {renderIcon(icon, 22)}
          </span>
        )}
        <div className={styles.text}>
          <h1 className={styles.title}>{title}</h1>
          {description && <p className={styles.description}>{description}</p>}
        </div>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}
