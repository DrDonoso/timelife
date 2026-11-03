import { useMemo, type CSSProperties } from 'react'
import { cx } from '../../components/utils'
import { useI18n } from '../../i18n'
import { useThemeColors } from '../../theme/useThemeColors'
import { ensureContrast, hubFill, monthColor, readableText } from '../../utils/color'
import styles from './HubPreview.module.css'

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1)

export interface YearHubProps {
  year: number
  /** The colour as chosen (it is painted adapted to the current palette, like the timeline does). */
  color: string
  /** Sample number for the count badge. */
  count?: number
  size?: 'md' | 'sm'
  className?: string
}

/** Year hub exactly as the timeline paints it: pearl fill, the year and a count badge. */
export function YearHub({ year, color, count = 12, size = 'md', className }: YearHubProps) {
  const { t } = useI18n()
  const { adapt, hubBadgeBg } = useThemeColors()
  const style = useMemo(() => {
    const painted = adapt(color)
    return {
      '--hub-fill': hubFill(painted),
      '--hub-text': readableText(painted, true),
      '--hub-badge-text': ensureContrast(painted, hubBadgeBg),
    } as CSSProperties
  }, [adapt, color, hubBadgeBg])
  return (
    <div
      className={cx(styles.hub, styles[size], className)}
      style={style}
      role="img"
      aria-label={t('adminAppearance.years.hubLabel', { year })}
    >
      <span className={styles.year} aria-hidden="true">
        {year}
      </span>
      <span className={styles.badge} aria-hidden="true">
        {count}
      </span>
    </div>
  )
}

/** The twelve month hubs of a year (same hue, light January → deep December), in the palette's version of `color`. */
export function MonthSwatches({ year, color, className }: { year: number; color: string; className?: string }) {
  const { t, formatDate } = useI18n()
  const { adapt } = useThemeColors()
  const months = useMemo(() => {
    const painted = adapt(color)
    return MONTHS.map((month) => {
      const fill = monthColor(painted, month)
      const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
      return {
        month,
        label: formatDate(firstDay, 'monthLong'),
        short: formatDate(firstDay, 'monthAbbr'),
        style: { '--month-fill': hubFill(fill), '--month-text': readableText(fill) } as CSSProperties,
      }
    })
  }, [adapt, color, formatDate, year])
  return (
    <div className={cx(styles.months, className)} role="img" aria-label={t('adminAppearance.years.monthsLabel', { year })}>
      {months.map(({ month, label, short, style }) => (
        <span key={month} className={styles.month} style={style} title={label} aria-hidden="true">
          {short}
        </span>
      ))}
    </div>
  )
}
