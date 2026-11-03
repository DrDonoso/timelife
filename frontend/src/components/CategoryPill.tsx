import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { CategoryIcon } from '../icons/CategoryIcon'
import { useI18n } from '../i18n'
import { useThemeColors } from '../theme/useThemeColors'
import { categoryName, type CategoryLike } from '../utils/categories'
import { ensureContrast } from '../utils/color'
import styles from './CategoryPill.module.css'
import { cx } from './utils'

const SIZES = { sm: 28, md: 36, lg: 44 } as const

export interface CategoryPillProps {
  category: CategoryLike
  /** Circle diameter: sm 28 · md 36 · lg 44 (default md). */
  size?: keyof typeof SIZES
  /** Force a state (admin previews); otherwise it expands on hover, keyboard focus or tap. */
  expanded?: boolean
  className?: string
}

/**
 * Category circle (white icon on the category colour) that expands into a pill with the name on
 * hover, keyboard focus or tap (tap again or tap elsewhere to collapse). The colour is adapted to
 * the palette and deepened with `ensureContrast` so the white text always reads (≥ 4.5:1). Its
 * accessible name is the category name in every state.
 */
export function CategoryPill({ category, size = 'md', expanded: forced, className }: CategoryPillProps) {
  const { lang } = useI18n()
  const { adapt } = useThemeColors()
  const reduceMotion = useReducedMotion()
  const name = categoryName(category, lang)
  const background = useMemo(() => ensureContrast(adapt(category.color)), [adapt, category.color])
  const diameter = SIZES[size]
  const [pinned, setPinned] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!pinned) return
    function collapse(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setPinned(false)
    }
    document.addEventListener('pointerdown', collapse)
    return () => document.removeEventListener('pointerdown', collapse)
  }, [pinned])

  const style = {
    '--pill-size': `${diameter}px`,
    '--pill-bg': background,
  } as CSSProperties

  return (
    <AriaButton
      ref={ref}
      aria-label={name}
      className={cx(styles.pill, styles[size], className)}
      style={style}
      onPress={(event) => {
        // Touch has no hover: a tap toggles the pill open/closed.
        if (event.pointerType === 'touch' || event.pointerType === 'pen' || event.pointerType === 'virtual') {
          setPinned((current) => !current)
        }
      }}
    >
      {({ isHovered, isFocusVisible }) => {
        const expanded = forced ?? (isHovered || isFocusVisible || pinned)
        return (
          <motion.span
            className={styles.body}
            data-expanded={expanded ? 'true' : 'false'}
            initial={false}
            animate={{ width: expanded ? 'auto' : diameter }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 }}
          >
            <span className={styles.icon}>
              <CategoryIcon icon={category.icon} size={Math.round(diameter * 0.52)} stroke={2} />
            </span>
            <motion.span
              className={styles.label}
              aria-hidden="true"
              initial={false}
              animate={{ opacity: expanded ? 1 : 0 }}
              transition={{ duration: reduceMotion ? 0 : expanded ? 0.18 : 0.08, delay: expanded && !reduceMotion ? 0.05 : 0 }}
            >
              {name}
            </motion.span>
          </motion.span>
        )
      }}
    </AriaButton>
  )
}
