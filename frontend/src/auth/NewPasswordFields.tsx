import { useCallback, type Ref } from 'react'
import { PasswordField } from '../components/PasswordField'
import { useI18n } from '../i18n'
import { passwordProblem, samePassword } from './passwordRules'

export interface NewPasswordErrors {
  password: string | null
  repeat: string | null
}

export const NO_PASSWORD_ERRORS: NewPasswordErrors = { password: null, repeat: null }

/**
 * `(password, repeat, current?) => errors` with the rules of the API, the repetition and, given
 * the `current` password, that the new one differs from it.
 */
export function useNewPasswordCheck(): (password: string, repeat: string, current?: string) => NewPasswordErrors {
  const { t } = useI18n()
  return useCallback(
    (password: string, repeat: string, current?: string) => {
      const problem = passwordProblem(password)
      let message: string | null = problem ? t(`auth.rules.${problem}`) : null
      if (!message && current !== undefined && samePassword(password, current)) message = t('auth.rules.unchanged')
      return { password: message, repeat: !message && repeat !== password ? t('auth.rules.mismatch') : null }
    },
    [t],
  )
}

export interface NewPasswordFieldsProps {
  password: string
  onPasswordChange: (value: string) => void
  repeat: string
  onRepeatChange: (value: string) => void
  errors: NewPasswordErrors
  inputRef?: Ref<HTMLInputElement>
  autoFocus?: boolean
}

/** A new password and its repetition (password managers offer to generate and save it). */
export function NewPasswordFields({ password, onPasswordChange, repeat, onRepeatChange, errors, inputRef, autoFocus }: NewPasswordFieldsProps) {
  const { t } = useI18n()
  return (
    <>
      <PasswordField
        label={t('auth.newPassword.label')}
        description={t('auth.newPassword.description')}
        name="new-password"
        autoComplete="new-password"
        value={password}
        onChange={onPasswordChange}
        errorMessage={errors.password}
        isRequired
        inputRef={inputRef}
        autoFocus={autoFocus}
      />
      <PasswordField
        label={t('auth.newPassword.repeat')}
        name="repeat-password"
        autoComplete="new-password"
        value={repeat}
        onChange={onRepeatChange}
        errorMessage={errors.repeat}
        isRequired
      />
    </>
  )
}
