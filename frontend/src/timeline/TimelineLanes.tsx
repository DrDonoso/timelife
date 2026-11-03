import { memo, type CSSProperties } from 'react'
import { Avatar } from '../components/Avatar'
import { useThemeColors } from '../theme/useThemeColors'
import { mirror } from './direction'
import type { LayoutLane, TimelineLayout } from './layout'
import type { TimelineLane } from './model'
import { slotTransform } from './TimelineAxis'
import styles from './TimelineLanes.module.css'

/** Room across the outermost lanes for the stroke. */
const EDGE = 8

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** Half the cross size of the box holding the lane lines. */
export function lanesExtent(lanes: readonly LayoutLane[]): number {
  return lanes.reduce((extent, lane) => Math.max(extent, Math.abs(lane.offset)), 0) + EDGE
}

/**
 * SVG path data of the part of `lane` between the main-axis positions `from` and `to`, in physical
 * coordinates of a box `2 × extent` across the axis whose middle is the axis.
 */
export function lanePath(
  layout: Pick<TimelineLayout, 'orientation' | 'reversed' | 'length'>,
  lane: LayoutLane,
  from: number,
  to: number,
  extent: number,
): string {
  const horizontal = layout.orientation === 'horizontal'
  const point = (main: number, cross: number) => {
    const along = round(mirror(main, layout.length, layout.reversed))
    const across = round(cross + extent)
    return horizontal ? `${along} ${across}` : `${across} ${along}`
  }
  let path = ''
  let end: number | null = null
  for (const segment of lane.segments) {
    if (segment.to < from || segment.from > to) continue
    if (end !== segment.from) path += `M${point(segment.from, segment.c0)}`
    if (segment.c0 === segment.c1) {
      path += `L${point(segment.to, segment.c1)}`
    } else {
      const third = (segment.to - segment.from) / 3
      path += `C${point(segment.from + third, segment.c0)} ${point(segment.to - third, segment.c1)} ${point(segment.to, segment.c1)}`
    }
    end = segment.to
  }
  return path
}

export interface TimelineLanesProps {
  layout: TimelineLayout
  /** The model's lanes (names and avatars by `LayoutLane.index`). */
  people: readonly TimelineLane[]
  /** Main-axis window (track coordinates) to draw. */
  from: number
  to: number
  /** Seconds before they fade in (level changes); `null` = static. */
  revealDelay: number | null
  /** Avatar diameter at the newest end of each line. */
  avatarSize: number
}

/**
 * Family timeline lines (events level): each child's own line, tinted with its lane colour (the
 * child's own colour adapted to the palette, or the palette's lane colour for its position;
 * blended with the line colour for the lines), from its avatar at the newest end through its
 * milestones, merging into the shared ones. Decorative (the milestones' accessible names say whose
 * they are).
 */
export const TimelineLanes = memo(function TimelineLanes({ layout, people, from, to, revealDelay, avatarSize }: TimelineLanesProps) {
  const theme = useThemeColors()
  if (layout.lanes.length === 0) return null
  const horizontal = layout.orientation === 'horizontal'
  const extent = lanesExtent(layout.lanes)
  const box: CSSProperties = horizontal
    ? { left: 0, top: `calc(50% - ${extent}px)`, width: layout.length, height: 2 * extent }
    : { top: 0, left: `calc(50% - ${extent}px)`, width: 2 * extent, height: layout.length }
  const reveal = revealDelay !== null
  const delay = { '--reveal-delay': `${Math.round((revealDelay ?? 0) * 1000)}ms` } as CSSProperties
  const laneColor = (lane: LayoutLane) => theme.lane(lane.index, people[lane.index]?.color)
  return (
    <div className={styles.lanes} style={delay} data-reveal={reveal || undefined} data-lanes="">
      <svg className={styles.lines} style={box} aria-hidden="true" focusable="false">
        {layout.lanes.map((lane) => {
          const path = lanePath(layout, lane, from, to, extent)
          return path ? (
            <path
              key={lane.id}
              d={path}
              className={styles.line}
              style={{ '--lane-color': laneColor(lane) } as CSSProperties}
              data-lane={lane.id}
            />
          ) : null
        })}
      </svg>
      {layout.lanes.map((lane) => {
        const person = people[lane.index]
        if (!person || lane.head < from || lane.head > to) return null
        return (
          <div
            key={lane.id}
            className={styles.slot}
            style={{ transform: slotTransform(layout, lane.head, lane.offset), '--lane-color': laneColor(lane) } as CSSProperties}
          >
            <span className={styles.avatar}>
              <Avatar name={person.name} image={person.avatar} size={avatarSize} decorative />
            </span>
          </div>
        )
      })}
    </div>
  )
})
