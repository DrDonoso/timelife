import { IconEye, IconEyeOff, IconLock } from '@tabler/icons-react'
import { useState, type ReactNode, type Ref } from 'react'
import { Input, TextField as AriaTextField, type TextFieldProps as AriaTextFieldProps } from 'react-aria-components'
import { useI18n } from '../i18n'
import { FieldDescription, FieldErrorMessage, FieldLabel } from './Field'
import fieldStyles from './Field.module.css'
import { IconButton } from './IconButton'
import styles from './PasswordField.module.css'
import { cx } from './utils'

export interface PasswordFieldProps extends Omit<AriaTextFieldProps, 'className' | 'children' | 'type' | 'autoComplete'> {
  label?: ReactNode
  description?: ReactNode
  /** Error text; also marks the field invalid. */
  errorMessage?: ReactNode
  /** `current-password` to sign in, `new-password` while choosing one (password managers). */
  autoComplete: 'current-password' | 'new-password'
  /** Shown in clear text. Uncontrolled (the eye button) unless given. */
  isRevealed?: boolean
  onRevealChange?: (isRevealed: boolean) => void
  size?: 'sm' | 'md'
  className?: string
  inputRef?: Ref<HTMLInputElement>
}

/** Password input with a lock icon and a button that shows or hides what was typed. */
export function PasswordField({
  label,
  description,
  errorMessage,
  isRevealed,
  onRevealChange,
  size = 'md',
  className,
  inputRef,
  isInvalid,
  ...props
}: PasswordFieldProps) {
  const { t } = useI18n()
  const [revealedState, setRevealedState] = useState(false)
  const revealed = isRevealed ?? revealedState

  function toggle() {
    setRevealedState(!revealed)
    onRevealChange?.(!revealed)
  }

  return (
    <AriaTextField
      {...props}
      type={revealed ? 'text' : 'password'}
      isInvalid={isInvalid ?? Boolean(errorMessage)}
      className={cx(fieldStyles.field, size === 'sm' && fieldStyles.sm, className)}
    >
      {label && <FieldLabel isRequired={props.isRequired}>{label}</FieldLabel>}
      <div className={cx(fieldStyles.control, styles.control)}>
        <span className={fieldStyles.leadingIcon}>
          <IconLock size={18} aria-hidden="true" />
        </span>
        <Input ref={inputRef} className={fieldStyles.input} spellCheck={false} autoCapitalize="none" autoCorrect="off" />
        <IconButton
          size="sm"
          icon={revealed ? IconEyeOff : IconEye}
          label={revealed ? t('components.passwordField.hide') : t('components.passwordField.show')}
          tooltipPlacement="top"
          isDisabled={props.isDisabled}
          onPress={toggle}
          className={styles.reveal}
        />
      </div>
      <FieldDescription>{description}</FieldDescription>
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </AriaTextField>
  )
}
