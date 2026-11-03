import type { ReactNode, Ref } from 'react'
import { Input, TextField as AriaTextField, type TextFieldProps as AriaTextFieldProps } from 'react-aria-components'
import { FieldDescription, FieldErrorMessage, FieldLabel } from './Field'
import fieldStyles from './Field.module.css'
import { cx, renderIcon, type IconSource } from './utils'

export interface TextFieldProps extends Omit<AriaTextFieldProps, 'className' | 'children'> {
  label?: ReactNode
  description?: ReactNode
  /** Error text; also marks the field invalid. */
  errorMessage?: ReactNode
  placeholder?: string
  /** Leading icon inside the input. */
  icon?: IconSource
  size?: 'sm' | 'md'
  className?: string
  inputRef?: Ref<HTMLInputElement>
}

/** Single-line text input with label, description and error (react-aria TextField). */
export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  icon,
  size = 'md',
  className,
  inputRef,
  isInvalid,
  ...props
}: TextFieldProps) {
  return (
    <AriaTextField
      {...props}
      isInvalid={isInvalid ?? Boolean(errorMessage)}
      className={cx(fieldStyles.field, size === 'sm' && fieldStyles.sm, className)}
    >
      {label && <FieldLabel isRequired={props.isRequired}>{label}</FieldLabel>}
      <div className={fieldStyles.control}>
        {icon && <span className={fieldStyles.leadingIcon}>{renderIcon(icon, 18)}</span>}
        <Input ref={inputRef} className={fieldStyles.input} placeholder={placeholder} />
      </div>
      <FieldDescription>{description}</FieldDescription>
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </AriaTextField>
  )
}
