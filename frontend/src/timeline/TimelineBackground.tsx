import type { CSSProperties } from 'react'
import type { ImageOut } from '../api/schema.gen'
import styles from './TimelineBackground.module.css'

export interface TimelineBackgroundProps {
  /** Appearance background image (`display_url`); `null` → the default soft pattern. */
  image?: Pick<ImageOut, 'display_url'> | null
  /** 0..1 */
  opacity?: number
}

/** Decorative layer behind the timeline: the admin's background photo, or the built-in pattern. */
export function TimelineBackground({ image, opacity = 0.18 }: TimelineBackgroundProps) {
  const value = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.18
  return (
    <div className={styles.background} aria-hidden="true">
      {image ? (
        <div
          key={image.display_url}
          className={styles.image}
          style={{ backgroundImage: `url("${image.display_url}")`, '--image-opacity': value } as CSSProperties}
        />
      ) : (
        <div className={styles.pattern} />
      )}
      <div className={styles.glow} />
    </div>
  )
}
