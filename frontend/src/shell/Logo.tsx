import styles from './Logo.module.css'

export interface LogoProps {
  size?: number
  /** Show the "Timelife" wordmark next to the mark. */
  withName?: boolean
  className?: string
}

/** Brand mark (public/logo.svg) with optional wordmark. Decorative: wrap it in a labelled link. */
export function Logo({ size = 32, withName = false, className }: LogoProps) {
  return (
    <span className={[styles.logo, className].filter(Boolean).join(' ')}>
      <img src="/logo.svg" alt="" width={size} height={size} className={styles.mark} draggable={false} />
      {withName && <span className={styles.name}>Timelife</span>}
    </span>
  )
}
