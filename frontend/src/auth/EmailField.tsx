import { IconMail } from '@tabler/icons-react'
import { useCallback } from 'react'
import { TextField } from '../components/TextField'
import { useI18n } from '../i18n'
import { EMAIL_PATTERN } from './passwordRules'

/** `(email) => [normalised address | null, error message | null]`. */
export function useEmailCheck(): (email: string) => [string | null, string | null] {
  const { t } = useI18n()
  return useCallback(
    (email: string) => {
      const value = email.trim().toLowerCase()
      if (!value) return [null, t('auth.rules.emailRequired')]
      if (!EMAIL_PATTERN.test(value) || value.length > 254) return [null, t('auth.rules.emailInvalid')]
      return [value, null]
    },
    [t],
  )
}

export interface EmailFieldProps {
  value: string
  onChange: (value: string) => void
  error: string | null
  autoFocus?: boolean
}

/** The e-mail of an account (the username password managers save). */
export function EmailField({ value, onChange, error, autoFocus }: EmailFieldProps) {
  const { t } = useI18n()
  return (
    <TextField
      label={t('auth.signIn.email')}
      type="email"
      name="email"
      autoComplete="username"
      placeholder={t('auth.signIn.emailPlaceholder')}
      icon={IconMail}
      value={value}
      onChange={onChange}
      errorMessage={error}
      isRequired
      autoFocus={autoFocus}
    />
  )
}
