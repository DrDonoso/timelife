import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { useI18n } from '../i18n'
import { nearestNodeIndex, type TimelineLayout } from './layout'
import type { TimelineModel } from './model'
import type { TimelinePalette } from './palette'
import styles from './TimelinePeriod.module.css'

export interface TimelinePeriodProps {
  model: TimelineModel
  layout: TimelineLayout
  palette: TimelinePalette
  /** Main-axis offset of the viewport centre (track coordinates). */
  centre: number
}

interface Period {
  key: string
  eyebrow: string
  title: string
  year: number
}

function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

/**
 * Decorative heading for what sits in the middle of the viewport ("Octubre" / "2026 · 4 hitos"),
 * like a photo library's date title. Hidden from assistive tech: chips and labels carry the data.
 */
export function TimelinePeriod({ model, layout, palette, centre }: TimelinePeriodProps) {
  const { t, formatDate, locale } = useI18n()
  const node = layout.nodes[nearestNodeIndex(layout, centre)]
  const entry = node ? model.byKey.get(node.key) : undefined
  let period: Period | null = null
  if (entry && layout.level === 'events' && entry.kind === 'event') {
    const month = model.byKey.get(entry.monthKey)
    const count = month?.kind === 'month' ? month.count : 0
    period = {
      key: entry.monthKey,
      eyebrow: `${entry.year} · ${t('timeline.count', { count })}`,
      title: capitalize(formatDate(`${entry.event.date.slice(0, 7)}-01`, 'monthLong'), locale),
      year: entry.year,
    }
  } else if (entry && layout.level === 'months') {
    const year = model.byKey.get(entry.kind === 'year' ? entry.key : entry.yearKey)
    period = {
      key: `y${entry.year}`,
      eyebrow: t('timeline.count', { count: year?.kind === 'year' ? year.count : 0 }),
      title: String(entry.year),
      year: entry.year,
    }
  } else if (entry && layout.level === 'years') {
    const newest = model.years[0]?.year ?? entry.year
    const oldest = model.years.at(-1)?.year ?? entry.year
    period = {
      key: 'all',
      eyebrow: t('timeline.count', { count: model.events.length }),
      title: newest === oldest ? String(newest) : t('common.dateRange', { from: oldest, to: newest }),
      year: newest,
    }
  }
  const colors = period ? palette.year(period.year) : null
  return (
    <div className={styles.period} aria-hidden="true">
      <AnimatePresence initial={false}>
        {period && colors && (
          <motion.div
            key={period.key}
            className={styles.content}
            style={{ '--period-light': colors.badgeLight, '--period-dark': colors.badgeDark } as CSSProperties}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className={styles.eyebrow}>{period.eyebrow}</span>
            <span className={styles.title}>{period.title}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
