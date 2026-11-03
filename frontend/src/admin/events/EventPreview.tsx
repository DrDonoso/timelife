import { IconCrop } from '@tabler/icons-react'
import type { CSSProperties } from 'react'
import { Button } from '../../components/Button'
import { CategoryBadgeGroup } from '../../components/CategoryBadge'
import { cx } from '../../components/utils'
import { useI18n } from '../../i18n'
import { useThemeColors } from '../../theme/useThemeColors'
import type { CategoryLike } from '../../utils/categories'
import { NEUTRAL_COLOR, segmentedBorder } from '../../utils/color'
import { isISODate } from '../../utils/dates'
import styles from './EventPreview.module.css'
import { RingThumb } from './RingThumb'

export interface EventPreviewProps {
  title: string
  date: string | null
  /** Ordered (ring order). */
  categories: readonly CategoryLike[]
  /** Cover photo (`thumb_url`, a `blob:` preview while uploading, or the whole picture). */
  coverSrc: string | null
  /** Positions the cover photo (an unsaved framing of the whole picture). */
  coverStyle?: CSSProperties
  coverPlaceholder?: string | null
  /** Opens the framing dialog of the cover; the button is disabled until the cover is uploaded. */
  onAdjustCover?: () => void
  canAdjustCover?: boolean
  className?: string
}

/**
 * Live replica of the timeline event node (self-contained on purpose): title pill with a 1px
 * segmented border, photo with the 2px segmented ring, category badges and the short date.
 */
export function EventPreview({
  title,
  date,
  categories,
  coverSrc,
  coverStyle,
  coverPlaceholder,
  onAdjustCover,
  canAdjustCover = false,
  className,
}: EventPreviewProps) {
  const { t, formatDate } = useI18n()
  const { adapt } = useThemeColors()
  const colors = categories.length > 0 ? categories.map((category) => adapt(category.color)) : [adapt(NEUTRAL_COLOR)]
  const label = title.trim()

  return (
    <figure className={cx(styles.preview, className)}>
      <figcaption className={styles.heading}>
        <span className={styles.title}>{t('adminEvents.preview.title')}</span>
        <span className={styles.caption}>{t('adminEvents.preview.caption')}</span>
      </figcaption>
      <div className={styles.stage} aria-hidden="true" data-testid="event-preview">
        <div className={styles.node}>
          <span className={styles.pill} style={{ '--pill-border': segmentedBorder(colors) } as CSSProperties}>
            <span className={styles.pillBody} data-empty={label ? undefined : true}>
              <span className={styles.pillText} title={label || undefined}>
                {label || t('adminEvents.preview.titlePlaceholder')}
              </span>
            </span>
          </span>
          <span className={styles.circle}>
            <RingThumb
              src={coverSrc}
              imageStyle={coverStyle}
              placeholder={coverPlaceholder}
              categories={categories}
              size={104}
              ringWidth={2}
            />
            {categories.length > 0 && <CategoryBadgeGroup categories={categories} max={3} size={26} className={styles.badges} />}
          </span>
          <span className={styles.date}>{date && isISODate(date) ? formatDate(date, 'dayMonth') : '—'}</span>
        </div>
      </div>
      {onAdjustCover && coverSrc && (
        <div className={styles.adjust}>
          <Button size="sm" variant="secondary" icon={IconCrop} isDisabled={!canAdjustCover} onPress={onAdjustCover}>
            {t('adminEvents.crop.adjust')}
          </Button>
          <span className={styles.adjustHint}>{t('adminEvents.crop.adjustHint')}</span>
        </div>
      )}
    </figure>
  )
}
