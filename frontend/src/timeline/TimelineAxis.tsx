import { memo, type CSSProperties } from 'react'
import { useI18n } from '../i18n'
import { mirror } from './direction'
import { rangeIndices, type LayoutMarker, type TimelineLayout } from './layout'
import type { TimelinePalette } from './palette'
import styles from './TimelineAxis.module.css'

/** Width of the colour blend between two years on the tinted axis. */
const YEAR_BLEND = 36

function px(value: number): string {
  return `${Math.round(value)}px`
}

/** Gradient direction running from the newest end of the line. */
function fromNewest(layout: Pick<TimelineLayout, 'orientation' | 'reversed'>): string {
  if (layout.orientation === 'horizontal') return layout.reversed ? 'to left' : 'to right'
  return layout.reversed ? 'to top' : 'to bottom'
}

/** Hub levels: the axis is tinted with each year's colour along its extent. */
function yearGradient(layout: TimelineLayout, palette: TimelinePalette): string | null {
  if (layout.level === 'events' || layout.years.length === 0) return null
  const origin = layout.axisStart
  const stops = layout.years.flatMap((span, index) => {
    const color = `color-mix(in srgb, ${palette.year(span.year).color} 60%, var(--color-line))`
    const from = index === 0 ? 0 : span.start - origin + YEAR_BLEND / 2
    const to = index === layout.years.length - 1 ? layout.axisEnd - origin : span.end - origin - YEAR_BLEND / 2
    return [`${color} ${px(from)}`, `${color} ${px(Math.max(from, to))}`]
  })
  return `linear-gradient(${fromNewest(layout)}, ${stops.join(', ')})`
}

/** `translate3d` to a physical position: `main` along the axis, `cross` across it. */
export function translateTo(orientation: TimelineLayout['orientation'], main: number, cross = 0): string {
  return orientation === 'horizontal' ? `translate3d(${main}px, ${cross}px, 0)` : `translate3d(${cross}px, ${main}px, 0)`
}

/** Places a zero-size slot at the logical track position `main` (mirrored in reversed frames). */
export function slotTransform(layout: Pick<TimelineLayout, 'orientation' | 'reversed' | 'length'>, main: number, cross = 0): string {
  return translateTo(layout.orientation, mirror(main, layout.length, layout.reversed), cross)
}

interface MarkerProps {
  marker: LayoutMarker
  /** CSS transform of its slot. */
  transform: string
  palette: TimelinePalette
  /** Seconds; `null` = no entrance animation. */
  revealDelay: number | null
}

const Marker = memo(function Marker({ marker, transform, palette, revealDelay }: MarkerProps) {
  const { formatDate } = useI18n()
  const reveal = revealDelay !== null
  const style = {
    transform,
    '--reveal-delay': `${Math.round((revealDelay ?? 0) * 1000)}ms`,
  } as CSSProperties
  if (marker.kind === 'year') {
    const colors = palette.year(marker.year)
    return (
      <div className={styles.slot} style={style} data-reveal={reveal || undefined}>
        <span
          className={styles.yearChip}
          style={{ '--chip-fill': colors.fill, '--chip-text': colors.text, '--chip-color': colors.color } as CSSProperties}
        >
          {marker.year}
        </span>
      </div>
    )
  }
  const colors = palette.month(marker.year, marker.month ?? 1)
  const firstDay = `${marker.year}-${String(marker.month ?? 1).padStart(2, '0')}-01`
  return (
    <div className={styles.slot} style={style} data-reveal={reveal || undefined}>
      <span className={styles.monthChip} style={{ '--chip-color': colors.color } as CSSProperties}>
        <span className={styles.dot} />
        {formatDate(firstDay, 'monthYear')}
      </span>
    </div>
  )
})

export interface TimelineAxisProps {
  layout: TimelineLayout
  palette: TimelinePalette
  /** Main-axis window (track coordinates) where markers are rendered. */
  from: number
  to: number
  /** Markers fade in after this many seconds (level changes, first load); `null` = static. */
  revealDelay: number | null
}

/** Rounded axis line (tinted by year at hub levels; replaced by the children's lanes when there are any) and the month / year boundary chips. */
export function TimelineAxis({ layout, palette, from, to, revealDelay }: TimelineAxisProps) {
  const horizontal = layout.orientation === 'horizontal'
  const extent = Math.max(0, layout.axisEnd - layout.axisStart)
  // The physical start of the line is its oldest end in reversed frames.
  const start = layout.reversed ? layout.length - layout.axisEnd : layout.axisStart
  const lineStyle: CSSProperties = horizontal ? { left: start, width: extent } : { top: start, height: extent }
  const tint = yearGradient(layout, palette)
  const [first, last] = rangeIndices(layout.markers, from, to)
  return (
    <div className={styles.axis} aria-hidden="true">
      {layout.lanes.length === 0 && (
        <div className={styles.line} style={lineStyle}>
          {tint && <span key={layout.level} className={styles.tint} style={{ backgroundImage: tint }} />}
        </div>
      )}
      {layout.markers.slice(first, last).map((marker) => (
        <Marker
          key={`${layout.level}:${marker.key}`}
          marker={marker}
          transform={slotTransform(layout, marker.main)}
          palette={palette}
          revealDelay={revealDelay}
        />
      ))}
    </div>
  )
}
