import { Fragment, type CSSProperties } from 'react'
import type { ImageOut } from '../../api/schema.gen'
import { Avatar } from '../../components/Avatar'
import styles from './AppearancePage.module.css'

export interface PreviewLane {
  id: number
  name: string
  avatar: ImageOut | null
  /** Colour the timeline paints the child's line with. */
  color: string
}

/** Room between two neighbouring lines (px). */
const GAP = 30
/** Merged lines run side by side, like the strands of a cord (as on the timeline). */
const STRAND = 3.5
const AVATAR = 28
/** Width of the lines' viewBox: they stretch to the preview's width (the height is in px). */
const WIDTH = 1000
/** Where the lines meet at a shared milestone, and the own milestones before and after it. */
const SHARED = 500
const OWN_NEW = 170
const OWN_OLD = 800

/** Horizontal position of `x` (viewBox units) over the lines' box, which starts at the avatars. */
function across(x: number): string {
  return `calc(var(--preview-start) + (100% - var(--preview-start)) * ${x / WIDTH})`
}

/**
 * Decorative sketch of «Todos juntos»: each child's line in the colour the timeline gives it, from
 * its avatar at the newest end, apart, merging at a shared milestone and apart again.
 */
export function LanePreview({ lanes }: { lanes: readonly PreviewLane[] }) {
  const span = lanes.length - 1
  const height = span * GAP + AVATAR + 32
  const middle = height / 2
  const rows = lanes.map((lane, index) => ({
    lane,
    own: middle + (index - span / 2) * GAP,
    strand: middle + (index - span / 2) * STRAND,
    style: { '--lane-color': lane.color } as CSSProperties,
  }))
  return (
    <div className={styles.lanePreview} style={{ height }} aria-hidden="true" data-lane-preview="">
      <svg className={styles.previewLines} viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" focusable="false">
        {rows.map(({ lane, own, strand, style }) => (
          <path
            key={lane.id}
            d={`M0 ${own}L300 ${own}C370 ${own} 370 ${strand} 440 ${strand}L560 ${strand}C630 ${strand} 630 ${own} 700 ${own}L${WIDTH} ${own}`}
            className={styles.previewLine}
            style={style}
            vectorEffect="non-scaling-stroke"
            data-preview-lane={lane.id}
          />
        ))}
      </svg>
      {rows.map(({ lane, own, style }, index) => (
        <Fragment key={lane.id}>
          <span className={styles.previewDot} style={{ ...style, top: own, left: across(OWN_NEW + (index % 3) * 40) }} />
          <span className={styles.previewDot} style={{ ...style, top: own, left: across(OWN_OLD - (index % 2) * 50) }} />
        </Fragment>
      ))}
      <span className={styles.previewShared} style={{ top: middle, left: across(SHARED) }} />
      {rows.map(({ lane, own, style }) => (
        <span key={lane.id} className={styles.previewAvatar} style={{ ...style, top: own }}>
          <Avatar name={lane.name} image={lane.avatar} size={AVATAR} decorative />
        </span>
      ))}
    </div>
  )
}
