import type { ReactNode } from 'react'
import {
  Label,
  Slider as AriaSlider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  Switch as AriaSwitch,
  type SliderProps as AriaSliderProps,
  type SwitchProps as AriaSwitchProps,
} from 'react-aria-components'
import fieldStyles from './Field.module.css'
import styles from './Switch.module.css'
import { cx } from './utils'

export interface SwitchProps extends Omit<AriaSwitchProps, 'className' | 'children'> {
  /** Visible label (or pass `aria-label`). */
  children?: ReactNode
  className?: string
}

/** On/off toggle (react-aria Switch). */
export function Switch({ children, className, ...props }: SwitchProps) {
  return (
    <AriaSwitch {...props} className={cx(styles.switch, className)}>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      {children && <span className={styles.switchLabel}>{children}</span>}
    </AriaSwitch>
  )
}

export interface SliderProps extends Omit<AriaSliderProps<number>, 'className' | 'children'> {
  label?: ReactNode
  /** Show the formatted value next to the label (default true). */
  showValue?: boolean
  className?: string
}

/** Single-thumb slider (e.g. background opacity with `formatOptions={{ style: 'percent' }}`). */
export function Slider({ label, showValue = true, className, ...props }: SliderProps) {
  return (
    <AriaSlider {...props} className={cx(fieldStyles.field, styles.slider, className)}>
      {(label || showValue) && (
        <div className={styles.sliderHeader}>
          {label && <Label className={fieldStyles.label}>{label}</Label>}
          {showValue && <SliderOutput className={styles.output} />}
        </div>
      )}
      <SliderTrack className={styles.sliderTrack}>
        {({ state }) => (
          <>
            <span className={styles.sliderFill} style={{ width: `${state.getThumbPercent(0) * 100}%` }} />
            <SliderThumb className={styles.sliderThumb} />
          </>
        )}
      </SliderTrack>
    </AriaSlider>
  )
}
