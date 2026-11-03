import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'
import { cx, renderIcon, type IconSource } from './utils'

export interface EmptyStateProps {
  icon?: IconSource
  title: ReactNode
  description?: ReactNode
  /** Buttons / links. */
  actions?: ReactNode
  /** `error` tints the icon with the danger colour. */
  tone?: 'neutral' | 'error'
  size?: 'sm' | 'md' | 'lg'
  /** Heading level of the title (default 2). */
  headingLevel?: 1 | 2 | 3
  className?: string
  children?: ReactNode
}

/** Friendly placeholder for empty lists, missing data and recoverable errors. */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  tone = 'neutral',
  size = 'md',
  headingLevel = 2,
  className,
  children,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <motion.section
      className={cx(styles.empty, styles[size], tone === 'error' && styles.error, className)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {icon && (
        <div className={styles.iconWrap} aria-hidden="true">
          {renderIcon(icon, size === 'sm' ? 24 : size === 'lg' ? 40 : 32, 1.75)}
        </div>
      )}
      <Heading className={styles.title}>{title}</Heading>
      {description && <p className={styles.description}>{description}</p>}
      {children}
      {actions && <div className={styles.actions}>{actions}</div>}
    </motion.section>
  )
}
