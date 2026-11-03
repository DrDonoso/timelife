import { useMemo, type CSSProperties } from 'react'
import { CategoryIcon } from '../icons/CategoryIcon'
import { useI18n } from '../i18n'
import { useThemeColors } from '../theme/useThemeColors'
import { categoryName, type CategoryLike } from '../utils/categories'
import { ensureContrast } from '../utils/color'
import styles from './CategoryBadge.module.css'
import { cx } from './utils'

export interface CategoryBadgeProps {
  category: CategoryLike
  /** Diameter in px (default 26). */
  size?: number
  /** Hide from assistive tech when the name is shown elsewhere. */
  decorative?: boolean
  /** Ring in the page background colour (for overlapping stacks). */
  ring?: boolean
  className?: string
}

/**
 * Small circle in the category colour (adapted to the palette, deepened for contrast) with the
 * white category icon.
 */
export function CategoryBadge({ category, size = 26, decorative = false, ring = false, className }: CategoryBadgeProps) {
  const { lang } = useI18n()
  const { adapt } = useThemeColors()
  const name = categoryName(category, lang)
  const background = useMemo(() => ensureContrast(adapt(category.color)), [adapt, category.color])
  return (
    <span
      className={cx(styles.badge, ring && styles.ring, className)}
      style={{ '--badge-size': `${size}px`, '--badge-bg': background } as CSSProperties}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : name}
    >
      <CategoryIcon icon={category.icon} size={Math.round(size * 0.58)} stroke={2} />
    </span>
  )
}

export interface CategoryBadgeGroupProps {
  /** In display order (first = primary). */
  categories: readonly CategoryLike[]
  /** Badges shown before the "+N" chip (default 3). */
  max?: number
  size?: number
  className?: string
}

/** Overlapping category badges with a "+N" chip; announced as the list of names. */
export function CategoryBadgeGroup({ categories, max = 3, size = 26, className }: CategoryBadgeGroupProps) {
  const { lang, t } = useI18n()
  const visible = categories.slice(0, max)
  const hidden = categories.length - visible.length
  const label = categories.map((category) => categoryName(category, lang)).join(', ')
  return (
    <span
      className={cx(styles.group, className)}
      role="img"
      aria-label={label}
      title={label}
      style={{ '--badge-size': `${size}px` } as CSSProperties}
    >
      {visible.map((category, index) => (
        <CategoryBadge key={category.id ?? `${category.icon}-${index}`} category={category} size={size} decorative ring />
      ))}
      {hidden > 0 && (
        <span className={styles.more} aria-hidden="true" title={t('components.categoryBadges.more', { count: hidden })}>
          +{hidden}
        </span>
      )}
    </span>
  )
}
