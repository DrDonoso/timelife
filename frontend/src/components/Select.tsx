import { IconCheck, IconChevronDown } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  type Key,
} from 'react-aria-components'
import { useI18n } from '../i18n'
import { FieldDescription, FieldErrorMessage, FieldLabel } from './Field'
import fieldStyles from './Field.module.css'
import overlay from './Overlay.module.css'
import styles from './Select.module.css'
import { cx, renderIcon, type IconSource } from './utils'

export interface SelectOption<V extends Key> {
  value: V
  label: string
  icon?: IconSource
  description?: string
  isDisabled?: boolean
}

export interface SelectProps<V extends Key> {
  label?: ReactNode
  /** Accessible name when there is no visible label. */
  'aria-label'?: string
  options: readonly SelectOption<V>[]
  value: V | null
  onChange: (value: V) => void
  placeholder?: string
  description?: ReactNode
  errorMessage?: ReactNode
  isRequired?: boolean
  isDisabled?: boolean
  name?: string
  size?: 'sm' | 'md'
  className?: string
}

/** Single-choice dropdown (react-aria Select + ListBox). */
export function Select<V extends Key>({
  label,
  'aria-label': ariaLabel,
  options,
  value,
  onChange,
  placeholder,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  name,
  size = 'md',
  className,
}: SelectProps<V>) {
  const { t } = useI18n()
  return (
    <AriaSelect
      aria-label={ariaLabel}
      value={value}
      onChange={(key) => {
        if (key !== null) onChange(key as V)
      }}
      placeholder={placeholder ?? t('components.select.placeholder')}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={errorMessage ? true : undefined}
      name={name}
      className={cx(fieldStyles.field, size === 'sm' && fieldStyles.sm, className)}
    >
      {label && <FieldLabel isRequired={isRequired}>{label}</FieldLabel>}
      <AriaButton className={cx(fieldStyles.control, styles.trigger)}>
        <SelectValue className={styles.value}>
          {({ selectedText, isPlaceholder, defaultChildren }) => {
            if (isPlaceholder) return defaultChildren
            const selected = options.find((option) => option.value === value)
            return (
              <>
                {selected?.icon && <span className={styles.valueIcon}>{renderIcon(selected.icon, 18)}</span>}
                <span className={styles.valueText}>{selected?.label ?? selectedText}</span>
              </>
            )
          }}
        </SelectValue>
        <IconChevronDown size={18} aria-hidden="true" className={styles.chevron} />
      </AriaButton>
      <FieldDescription>{description}</FieldDescription>
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
      <Popover className={overlay.popover} offset={6}>
        <ListBox className={overlay.list} items={options.map((option) => ({ ...option, id: option.value }))}>
          {(option) => (
            <ListBoxItem id={option.value} textValue={option.label} isDisabled={option.isDisabled} className={overlay.option}>
              {({ isSelected }) => (
                <>
                  {option.icon && <span className={overlay.optionIcon}>{renderIcon(option.icon, 18)}</span>}
                  <span className={overlay.optionText}>
                    <span>{option.label}</span>
                    {option.description && <span className={overlay.optionDescription}>{option.description}</span>}
                  </span>
                  <span className={overlay.optionCheck}>{isSelected && <IconCheck size={16} stroke={2.4} aria-hidden="true" />}</span>
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  )
}
