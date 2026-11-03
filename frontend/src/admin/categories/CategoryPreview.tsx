import { useId, useMemo, type CSSProperties } from 'react'
import { CategoryBadge } from '../../components/CategoryBadge'
import { CategoryPill } from '../../components/CategoryPill'
import { cx } from '../../components/utils'
import { CategoryIcon } from '../../icons/CategoryIcon'
import { useI18n } from '../../i18n'
import type { ResolvedTheme } from '../../theme/themes'
import { ThemeScope, getThemeColors, useThemeColors } from '../../theme/useThemeColors'
import type { CategoryLike } from '../../utils/categories'
import { ensureContrast, segmentedBorder, segmentedRing, shiftLightness } from '../../utils/color'
import styles from './CategoryPreview.module.css'

const MODES: readonly ResolvedTheme[] = ['light', 'dark']

/** Sample date of the preview node (any fixed day: rendering must stay pure). */
const SAMPLE_DATE = '2026-03-12'

/** A tiny timeline event without photo: title label, ringed circle with the icon, badge and date. */
function MiniEventNode({ category }: { category: CategoryLike }) {
  const { t, formatDate } = useI18n()
  const { adapt } = useThemeColors()
  const color = adapt(category.color)
  const style = useMemo(() => {
    const deep = ensureContrast(color)
    return {
      '--node-ring': segmentedRing([color]),
      '--node-border': segmentedBorder([color]),
      '--node-fill': `linear-gradient(145deg, ${shiftLightness(deep, 0.12)} 0%, ${deep} 100%)`,
    } as CSSProperties
  }, [color])
  return (
    <div className={styles.node} style={style}>
      <span className={styles.nodeTitle}>{t('adminCategories.preview.sampleTitle')}</span>
      <span className={styles.nodeTrack}>
        <span className={styles.nodeCircle}>
          <span className={styles.nodeFill}>
            <CategoryIcon icon={category.icon} size={30} stroke={1.8} />
          </span>
          <CategoryBadge category={category} size={22} decorative ring className={styles.nodeBadge} />
        </span>
      </span>
      <span className={styles.nodeDate}>{formatDate(SAMPLE_DATE, 'dayMonth')}</span>
    </div>
  )
}

/** The current palette in one mode: its tokens (data-palette + data-theme) and its painted colours (ThemeScope). */
function Surface({ mode, category }: { mode: ResolvedTheme; category: CategoryLike }) {
  const { t } = useI18n()
  const { palette } = useThemeColors()
  return (
    <div className={styles.surface} data-palette={palette} data-theme={mode}>
      <ThemeScope mode={mode}>
        <span className={styles.surfaceLabel}>
          {t(mode === 'light' ? 'adminCategories.preview.light' : 'adminCategories.preview.dark')}
        </span>
        <div className={styles.chips}>
          <CategoryPill category={category} expanded />
          <CategoryPill category={category} expanded={false} />
          <CategoryBadge category={category} decorative />
        </div>
        <MiniEventNode category={category} />
      </ThemeScope>
    </div>
  )
}

/**
 * Live preview of a category as the app draws it — expanded and collapsed pill, badge and a small
 * timeline circle — in the light and the dark version of the current palette at once.
 */
export function CategoryPreview({ category, className }: { category: CategoryLike; className?: string }) {
  const { t } = useI18n()
  const headingId = useId()
  const { palette } = useThemeColors()
  // Pills and badges carry white text: say so when either surface had to deepen the colour.
  const deepened = MODES.some((mode) => {
    const color = getThemeColors(palette, mode).adapt(category.color)
    return ensureContrast(color) !== color
  })

  return (
    <section className={cx(styles.preview, className)} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading}>
        {t('adminCategories.preview.title')}
      </h3>
      {/* Purely visual: the pills inside must not become extra tab stops. */}
      <div className={styles.surfaces} inert>
        {MODES.map((mode) => (
          <Surface key={mode} mode={mode} category={category} />
        ))}
      </div>
      {deepened && <p className={styles.note}>{t('adminCategories.preview.contrastNote')}</p>}
    </section>
  )
}
