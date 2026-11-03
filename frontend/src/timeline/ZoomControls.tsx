import { IconMinus, IconPlus } from '@tabler/icons-react'
import { useId, type CSSProperties } from 'react'
import { IconButton } from '../components/IconButton'
import { SegmentedControl } from '../components/SegmentedControl'
import { cx } from '../components/utils'
import { useI18n } from '../i18n'
import { ZOOM_LEVELS, levelDepth, type ZoomLevel } from './types'
import styles from './ZoomControls.module.css'

export interface ZoomControlsProps {
  level: ZoomLevel
  onLevelChange: (level: ZoomLevel) => void
  onZoomIn: () => void
  onZoomOut: () => void
  /** Desktop: extra px kept free at the right edge (e.g. while the filter panel is open). */
  inset?: number
  className?: string
}

/** Floating "− · Años / Meses / Días · +" control (bottom-right on desktop, bottom-centre on mobile). */
export function ZoomControls({ level, onLevelChange, onZoomIn, onZoomOut, inset = 0, className }: ZoomControlsProps) {
  const { t } = useI18n()
  const hintId = useId()
  const depth = levelDepth(level)
  return (
    <div
      className={cx(styles.controls, className)}
      style={{ '--controls-inset': `${Math.max(0, inset)}px` } as CSSProperties}
      role="group"
      aria-label={t('timeline.zoom.group')}
      aria-describedby={hintId}
    >
      <IconButton
        label={t('timeline.zoom.out')}
        icon={IconMinus}
        size="sm"
        tooltipPlacement="top"
        isDisabled={depth === 0}
        onPress={onZoomOut}
        aria-keyshortcuts="-"
      />
      <SegmentedControl
        aria-label={t('timeline.zoom.level')}
        size="sm"
        value={level}
        onChange={onLevelChange}
        options={ZOOM_LEVELS.map((value) => ({ value, label: t(`timeline.levels.${value}`) }))}
        className={styles.levels}
      />
      <IconButton
        label={t('timeline.zoom.in')}
        icon={IconPlus}
        size="sm"
        tooltipPlacement="top"
        isDisabled={depth === ZOOM_LEVELS.length - 1}
        onPress={onZoomIn}
        aria-keyshortcuts="+"
      />
      <span id={hintId} className="visually-hidden">
        {t('timeline.hint')}
      </span>
    </div>
  )
}
