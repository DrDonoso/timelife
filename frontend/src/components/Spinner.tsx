import type { CSSProperties } from 'react'
import { useI18n } from '../i18n'
import styles from './Spinner.module.css'
import { cx } from './utils'

const SIZES = { sm: 16, md: 24, lg: 40 } as const

export interface SpinnerProps {
  size?: keyof typeof SIZES | number
  /** Accessible label (default "Cargando"). Ignored when `decorative`. */
  label?: string
  /** Hide from assistive tech (e.g. inside a button that already announces its pending state). */
  decorative?: boolean
  className?: string
}

/** Indeterminate progress indicator; inherits `color`. */
export function Spinner({ size = 'md', label, decorative = false, className }: SpinnerProps) {
  const { t } = useI18n()
  const pixels = typeof size === 'number' ? size : SIZES[size]
  const style = { '--spinner-size': `${pixels}px` } as CSSProperties
  return (
    <span
      className={cx(styles.spinner, className)}
      style={style}
      role={decorative ? undefined : 'progressbar'}
      aria-label={decorative ? undefined : (label ?? t('components.spinner.label'))}
      aria-hidden={decorative || undefined}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className={styles.track} cx="12" cy="12" r="9.5" />
        <circle className={styles.arc} cx="12" cy="12" r="9.5" />
      </svg>
    </span>
  )
}

export interface LoadingStateProps {
  /** Visible message under the spinner (also its accessible label). */
  message?: string
  /** Fill the available height (page-level loading). */
  fill?: boolean
  /**
   * Float centred over the page in a small card without taking layout space (Suspense fallback of
   * overlay routes such as the event detail).
   */
  overlay?: boolean
  className?: string
}

/** Centred spinner that fades in after a short delay, so fast loads don't flash. */
export function LoadingState({ message, fill = false, overlay = false, className }: LoadingStateProps) {
  const content = (
    <div className={cx(styles.loading, fill && styles.fill, overlay && styles.card, className)}>
      <Spinner size="lg" label={message} className={styles.loadingSpinner} />
      {message && (
        <p className={styles.message} aria-hidden="true">
          {message}
        </p>
      )}
    </div>
  )
  return overlay ? <div className={styles.overlay}>{content}</div> : content
}
