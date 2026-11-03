import type { ReactNode, Ref } from 'react'
import { TextArea, TextField as AriaTextField, type TextFieldProps as AriaTextFieldProps } from 'react-aria-components'
import { useI18n } from '../i18n'
import { FieldDescription, FieldErrorMessage, FieldLabel } from './Field'
import fieldStyles from './Field.module.css'
import styles from './TextAreaField.module.css'
import { cx } from './utils'

export interface TextAreaFieldProps extends Omit<AriaTextFieldProps, 'className' | 'children'> {
  label?: ReactNode
  description?: ReactNode
  /** Error text; also marks the field invalid. */
  errorMessage?: ReactNode
  placeholder?: string
  /** Visible rows before growing (default 4). */
  rows?: number
  /** Show "n / maxLength" under the field (needs a controlled `value` and `maxLength`). */
  showCount?: boolean
  className?: string
  textAreaRef?: Ref<HTMLTextAreaElement>
}

/** Multi-line text input; grows with its content where the browser supports `field-sizing`. */
export function TextAreaField({
  label,
  description,
  errorMessage,
  placeholder,
  rows = 4,
  showCount = false,
  className,
  textAreaRef,
  isInvalid,
  ...props
}: TextAreaFieldProps) {
  const { t } = useI18n()
  const count = typeof props.value === 'string' ? props.value.length : null
  const counter = showCount && count !== null && props.maxLength ? { count, max: props.maxLength } : null
  return (
    <AriaTextField {...props} isInvalid={isInvalid ?? Boolean(errorMessage)} className={cx(fieldStyles.field, className)}>
      {label && <FieldLabel isRequired={props.isRequired}>{label}</FieldLabel>}
      <div className={cx(fieldStyles.control, styles.control)}>
        <TextArea
          ref={textAreaRef}
          className={styles.textarea}
          rows={rows}
          placeholder={placeholder}
          style={{ minHeight: `calc(${rows} * 1.5em + 20px)` }}
        />
      </div>
      {(description || counter) && (
        <div className={styles.meta}>
          <FieldDescription>{description}</FieldDescription>
          {counter && (
            <span className={styles.counter} aria-hidden="true">
              {t('components.textArea.counter', counter)}
            </span>
          )}
        </div>
      )}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </AriaTextField>
  )
}
