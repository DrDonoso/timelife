import { useState, type CSSProperties } from 'react'
import { cx } from '../../components/utils'
import { CategoryIcon } from '../../icons/CategoryIcon'
import { useThemeColors } from '../../theme/useThemeColors'
import type { CategoryLike } from '../../utils/categories'
import { NEUTRAL_COLOR, ensureContrast, segmentedRing, shiftLightness } from '../../utils/color'
import styles from './RingThumb.module.css'

export interface RingThumbProps {
  /** Photo URL (cover `thumb_url` or a `blob:` preview); null → category fallback. */
  src?: string | null
  /** Positions the photo (e.g. the whole picture showing an unsaved framing). */
  imageStyle?: CSSProperties
  /** Placeholder colour while the photo loads (`dominant_color`). */
  placeholder?: string | null
  /** In event order: the ring is split in equal arcs, the first one gives the fallback icon. */
  categories: readonly CategoryLike[]
  /** Outer diameter in px. */
  size?: number
  /** Ring thickness in px (the timeline uses 2). */
  ringWidth?: number
  className?: string
}

/** Fallback fill when an event has no photo: gradient of its primary category colour. */
export function categoryFill(color: string | undefined): string {
  const deep = ensureContrast(color ?? NEUTRAL_COLOR)
  return `linear-gradient(140deg, ${shiftLightness(deep, 0.1)} 0%, ${deep} 100%)`
}

/** Event circle in miniature: photo (or category gradient + icon) inside a segmented category ring, in the palette's colours. */
export function RingThumb({ src, imageStyle, placeholder, categories, size = 56, ringWidth = 2, className }: RingThumbProps) {
  const { adapt } = useThemeColors()
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const colors = categories.length > 0 ? categories.map((category) => adapt(category.color)) : [adapt(NEUTRAL_COLOR)]
  const primary = categories[0]
  const showPhoto = Boolean(src) && src !== failedSrc
  const style = {
    '--ring-size': `${size}px`,
    '--ring-width': `${ringWidth}px`,
    '--ring-gap': `${Math.max(1, Math.round(size / 40))}px`,
    background: segmentedRing(colors),
  } as CSSProperties

  return (
    <span className={cx(styles.ring, className)} style={style} aria-hidden="true">
      <span className={styles.gap}>
        <span
          className={styles.photo}
          style={{ background: showPhoto ? (placeholder ?? 'var(--color-surface-2)') : categoryFill(colors[0]) }}
        >
          {showPhoto && src ? (
            <img src={src} style={imageStyle} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailedSrc(src)} />
          ) : (
            <CategoryIcon icon={primary?.icon ?? 'star'} size={Math.round(size * 0.42)} stroke={1.8} className={styles.icon} />
          )}
        </span>
      </span>
    </span>
  )
}
