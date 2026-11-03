import { IconCheck, IconChevronDown, IconChevronUp, IconPlus, IconX } from '@tabler/icons-react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react'
import { Button as AriaButton, ToggleButton, type Key } from 'react-aria-components'
import type { ImageOut } from '../api/schema.gen'
import { useI18n } from '../i18n'
import { useThemeColors } from '../theme/useThemeColors'
import { Avatar } from './Avatar'
import { CategoryBadge } from './CategoryBadge'
import styles from './ChipMultiSelect.module.css'
import { StaticFieldDescription, StaticFieldError, StaticFieldLabel } from './Field'
import fieldStyles from './Field.module.css'
import { cx } from './utils'

export interface ChipOption<K extends Key = number> {
  id: K
  label: string
  /** Category colour (with `icon` → category badge; alone → colour dot). */
  color?: string
  /** Category icon key. */
  icon?: string
  /** Person photo; pass `null` to show initials (children without avatar). */
  image?: ImageOut | null
}

export interface ChipMultiSelectProps<K extends Key = number> {
  label: ReactNode
  options: readonly ChipOption<K>[]
  value: readonly K[]
  onChange: (value: K[]) => void
  /**
   * Ordered mode: the selection keeps the order in which items were added (first = primary) and
   * can be reordered; used for event categories (ring order).
   */
  ordered?: boolean
  description?: ReactNode
  errorMessage?: ReactNode
  isRequired?: boolean
  isDisabled?: boolean
  className?: string
}

function OptionVisual<K extends Key>({ option }: { option: ChipOption<K> }) {
  const { adapt } = useThemeColors()
  if (option.icon) {
    return (
      <CategoryBadge
        category={{ color: option.color ?? '#94877c', icon: option.icon, name_es: option.label, name_en: option.label }}
        size={22}
        decorative
      />
    )
  }
  if (option.image !== undefined) return <Avatar name={option.label} image={option.image} size={22} decorative />
  if (option.color) return <span className={styles.dot} style={{ background: adapt(option.color) }} aria-hidden="true" />
  return null
}

/** Multi-select as chips. `ordered` adds positions, "primary" and reorder controls. */
export function ChipMultiSelect<K extends Key = number>({
  label,
  options,
  value,
  onChange,
  ordered = false,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  className,
}: ChipMultiSelectProps<K>) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const id = useId()
  const labelId = `${id}-label`
  const hintId = ordered ? `${id}-hint` : undefined
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = errorMessage ? `${id}-error` : undefined
  const rootRef = useRef<HTMLDivElement>(null)
  const focusAfterRender = useRef<string | null>(null)

  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options])
  const selected = useMemo(
    () => value.flatMap((key) => (byId.has(key) ? [byId.get(key) as ChipOption<K>] : [])),
    [value, byId],
  )
  const selectedSet = useMemo(() => new Set(value), [value])
  const available = options.filter((option) => !selectedSet.has(option.id))

  // Keep keyboard focus on a sensible control after chips move between lists.
  useEffect(() => {
    const selector = focusAfterRender.current
    if (!selector) return
    focusAfterRender.current = null
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus()
  })

  const keyAttr = (key: K) => CSS.escape(String(key))

  function add(key: K) {
    const index = available.findIndex((option) => option.id === key)
    const next = available[index + 1] ?? available[index - 1]
    focusAfterRender.current = next ? `[data-chip-add="${keyAttr(next.id)}"]` : `[data-chip-remove="${keyAttr(key)}"]`
    onChange([...value, key])
  }

  function remove(key: K) {
    focusAfterRender.current = `[data-chip-add="${keyAttr(key)}"]`
    onChange(value.filter((item) => item !== key))
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target], next[index]]
    const key = value[index]
    const edge = target === 0 || target === value.length - 1
    const direction = edge ? (delta === -1 ? 'later' : 'earlier') : delta === -1 ? 'earlier' : 'later'
    focusAfterRender.current = `[data-chip-move="${keyAttr(key)}-${direction}"]`
    onChange(next)
  }

  function toggle(key: K, isSelected: boolean) {
    onChange(isSelected ? [...value, key] : value.filter((item) => item !== key))
  }

  const describedBy = [hintId, descriptionId, errorId].filter(Boolean).join(' ') || undefined
  const spring = reduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 500, damping: 38 }

  return (
    <div
      ref={rootRef}
      className={cx(fieldStyles.field, styles.root, className)}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      data-invalid={errorMessage ? true : undefined}
      data-disabled={isDisabled || undefined}
    >
      <StaticFieldLabel id={labelId} isRequired={isRequired}>
        {label}
      </StaticFieldLabel>

      {ordered ? (
        <LayoutGroup id={id}>
          <p className={styles.hint} id={hintId}>
            {t('components.chipMultiSelect.orderHint')}
          </p>
          <ol className={styles.selectedList} aria-label={t('components.chipMultiSelect.selected')}>
            {selected.length === 0 && <li className={styles.empty}>{t('components.chipMultiSelect.noneSelected')}</li>}
            {selected.map((option, index) => (
              <motion.li
                key={String(option.id)}
                layout="position"
                layoutId={`${id}-${String(option.id)}`}
                transition={spring}
                className={cx(styles.chip, styles.selectedChip, index === 0 && styles.primary)}
              >
                <span className={styles.position} aria-hidden="true">
                  {index + 1}
                </span>
                <OptionVisual option={option} />
                <span className={styles.labelStack}>
                  <span className={styles.chipLabel}>{option.label}</span>
                  {index === 0 && selected.length > 1 && (
                    <span className={styles.primaryTag}>{t('components.chipMultiSelect.primary')}</span>
                  )}
                </span>
                <span className={styles.actions}>
                  {selected.length > 1 && (
                    <>
                      <AriaButton
                        className={styles.mini}
                        aria-label={t('components.chipMultiSelect.moveEarlier', { label: option.label })}
                        isDisabled={isDisabled || index === 0}
                        onPress={() => move(index, -1)}
                        data-chip-move={`${String(option.id)}-earlier`}
                      >
                        <IconChevronUp size={16} stroke={2.4} aria-hidden="true" />
                      </AriaButton>
                      <AriaButton
                        className={styles.mini}
                        aria-label={t('components.chipMultiSelect.moveLater', { label: option.label })}
                        isDisabled={isDisabled || index === selected.length - 1}
                        onPress={() => move(index, 1)}
                        data-chip-move={`${String(option.id)}-later`}
                      >
                        <IconChevronDown size={16} stroke={2.4} aria-hidden="true" />
                      </AriaButton>
                    </>
                  )}
                  <AriaButton
                    className={styles.mini}
                    aria-label={t('components.chipMultiSelect.remove', { label: option.label })}
                    isDisabled={isDisabled}
                    onPress={() => remove(option.id)}
                    data-chip-remove={String(option.id)}
                  >
                    <IconX size={16} stroke={2.4} aria-hidden="true" />
                  </AriaButton>
                </span>
              </motion.li>
            ))}
          </ol>
          {available.length > 0 && (
            <div className={styles.availableList} role="group" aria-label={t('components.chipMultiSelect.available')}>
              {available.map((option) => (
                <motion.div key={String(option.id)} layout="position" layoutId={`${id}-${String(option.id)}`} transition={spring}>
                  <AriaButton
                    className={cx(styles.chip, styles.addChip)}
                    aria-label={t('components.chipMultiSelect.add', { label: option.label })}
                    isDisabled={isDisabled}
                    onPress={() => add(option.id)}
                    data-chip-add={String(option.id)}
                  >
                    <IconPlus size={15} stroke={2.4} aria-hidden="true" className={styles.plus} />
                    <OptionVisual option={option} />
                    <span className={styles.chipLabel}>{option.label}</span>
                  </AriaButton>
                </motion.div>
              ))}
            </div>
          )}
        </LayoutGroup>
      ) : (
        <div className={styles.toggleList}>
          {options.map((option) => (
            <ToggleButton
              key={String(option.id)}
              isSelected={selectedSet.has(option.id)}
              onChange={(isSelected) => toggle(option.id, isSelected)}
              isDisabled={isDisabled}
              className={cx(styles.chip, styles.toggleChip)}
            >
              {({ isSelected }) => (
                <>
                  <OptionVisual option={option} />
                  <span className={styles.chipLabel}>{option.label}</span>
                  {isSelected && <IconCheck size={15} stroke={2.6} aria-hidden="true" className={styles.check} />}
                </>
              )}
            </ToggleButton>
          ))}
        </div>
      )}

      <StaticFieldDescription id={descriptionId}>{description}</StaticFieldDescription>
      <StaticFieldError id={errorId}>{errorMessage}</StaticFieldError>
    </div>
  )
}
