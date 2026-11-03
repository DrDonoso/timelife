import { motion, useReducedMotion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { ToggleButton, ToggleButtonGroup, type Key } from 'react-aria-components'
import styles from './SegmentedControl.module.css'
import { cx, renderIcon, type IconSource } from './utils'

export interface SegmentedOption<V extends string> {
  value: V
  label: ReactNode
  icon?: IconSource
  /** Accessible name when `label` is short/visual (e.g. "ES" → "Español"). */
  'aria-label'?: string
  /** Value for the `lang` attribute of the option (language toggles). */
  lang?: string
  isDisabled?: boolean
}

export interface SegmentedControlProps<V extends string> {
  /** Accessible name of the group. */
  'aria-label': string
  options: readonly SegmentedOption<V>[]
  value: V
  onChange: (value: V) => void
  size?: 'sm' | 'md'
  /** Stretch to the container width with equal segments. */
  fullWidth?: boolean
  isDisabled?: boolean
  className?: string
}

/** Single-choice segmented control (radio semantics) with a sliding selection indicator. */
export function SegmentedControl<V extends string>({
  'aria-label': ariaLabel,
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  isDisabled,
  className,
}: SegmentedControlProps<V>) {
  const indicatorId = useId()
  const reduceMotion = useReducedMotion()
  return (
    <ToggleButtonGroup
      aria-label={ariaLabel}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys: Set<Key>) => {
        const [next] = keys
        if (next !== undefined && next !== value) onChange(String(next) as V)
      }}
      isDisabled={isDisabled}
      className={cx(styles.group, styles[size], fullWidth && styles.fullWidth, className)}
    >
      {options.map((option) => (
        <ToggleButton
          key={option.value}
          id={option.value}
          aria-label={option['aria-label']}
          lang={option.lang}
          isDisabled={option.isDisabled}
          className={styles.item}
        >
          {({ isSelected }) => (
            <>
              {isSelected && (
                <motion.span
                  layoutId={indicatorId}
                  className={styles.indicator}
                  transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
                />
              )}
              <span className={styles.content}>
                {renderIcon(option.icon, size === 'sm' ? 16 : 18)}
                {option.label}
              </span>
            </>
          )}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
