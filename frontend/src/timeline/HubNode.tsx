import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useEffect, type CSSProperties, type MouseEvent, type Ref } from 'react'
import { cx } from '../components/utils'
import { useI18n } from '../i18n'
import styles from './HubNode.module.css'
import type { HubColors } from './palette'

export interface HubNodeProps {
  kind: 'year' | 'month'
  year: number
  /** 1..12 for month hubs. */
  month?: number | null
  /** Events inside the hub (after filters). */
  count: number
  colors: HubColors
  /** Diameter in px (defaults: year 148, month 104). */
  size?: number
  /** Turns the hub into a button (drill into it). */
  onActivate?: (event: MouseEvent<HTMLButtonElement>) => void
  tabIndex?: number
  /** Hidden from assistive tech (animation copies). */
  decorative?: boolean
  /** Count-up of the badge from this value (zoom out), after `countDelay` seconds. */
  countFrom?: number | null
  countDelay?: number
  /** Identifies the node inside the timeline (`y2026`, `m2026-03`). */
  nodeKey?: string
  className?: string
  ref?: Ref<HTMLButtonElement & HTMLDivElement>
}

function CountUp({ value, from, delay }: { value: number; from: number | null; delay: number }) {
  const { formatNumber } = useI18n()
  const count = useMotionValue(from ?? value)
  const text = useTransform(count, (latest) => formatNumber(Math.round(latest)))
  useEffect(() => {
    if (from === null || from === value) {
      count.set(value)
      return
    }
    count.set(from)
    const controls = animate(count, value, { duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] })
    return () => controls.stop()
  }, [count, value, from, delay])
  return <motion.span>{text}</motion.span>
}

/**
 * Year / month hub: soft "pearl" disc in the year (or month-shade) colour showing only the year or
 * the month's first three letters (`2026`, `MAR`) with the event count in a badge at the top-right.
 * Full text in `aria-label` and in a hover/focus caption.
 */
export function HubNode({
  kind,
  year,
  month = null,
  count,
  colors,
  size,
  onActivate,
  tabIndex,
  decorative = false,
  countFrom = null,
  countDelay = 0,
  nodeKey,
  className,
  ref,
}: HubNodeProps) {
  const { t, formatDate } = useI18n()
  const isMonth = kind === 'month' && month !== null
  const firstDay = `${year}-${String(month ?? 1).padStart(2, '0')}-01`
  const name = isMonth ? formatDate(firstDay, 'monthAbbr') : String(year)
  const period = isMonth ? formatDate(firstDay, 'monthYearLong') : String(year)
  const label = t('timeline.hubLabel', { period, count })
  const diameter = size ?? (kind === 'year' ? 148 : 104)

  const style = {
    '--hub-size': `${diameter}px`,
    '--hub-fill': colors.fill,
    '--hub-color': colors.color,
    '--hub-text': colors.text,
    '--badge-text-light': colors.badgeLight,
    '--badge-text-dark': colors.badgeDark,
  } as CSSProperties

  const content = (
    <>
      <span className={styles.disc}>
        <span className={styles.name}>{name}</span>
      </span>
      <span className={styles.count} aria-hidden="true">
        <CountUp value={count} from={countFrom} delay={countDelay} />
      </span>
      {!decorative && (
        <span className={styles.caption} aria-hidden="true">
          {label}
        </span>
      )}
    </>
  )

  const shared = {
    className: cx(styles.hub, styles[kind], onActivate && styles.interactive, className),
    style,
    'data-node-key': nodeKey,
  }

  if (onActivate && !decorative) {
    return (
      <button {...shared} ref={ref} type="button" aria-label={label} tabIndex={tabIndex} onClick={onActivate}>
        {content}
      </button>
    )
  }
  return (
    <div {...shared} ref={ref} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined}>
      {content}
    </div>
  )
}
