import { useState, type FormEvent } from 'react'
import { Form } from 'react-aria-components'
import { Navigate } from 'react-router'
import { api, isApiError } from '../api/client'
import type { PasswordResetIn, SessionOut } from '../api/schema.gen'
import { AuthAlert, AuthCard } from '../auth/AuthCard'
import styles from '../auth/AuthCard.module.css'
import { useLinkToken } from '../auth/linkToken'
import { NewPasswordFields, NO_PASSWORD_ERRORS, useNewPasswordCheck, type NewPasswordErrors } from '../auth/NewPasswordFields'
import { Button, LinkButton } from '../components/Button'
import { useAuth } from '../contexts/AuthContext'
import { useErrorMessage, useFieldErrors, useI18n } from '../i18n'
import { useDocumentTitle } from '../utils/useDocumentTitle'

/** `/reset-password#<code>`: the "forgot password" e-mail's link chooses a new password and signs in. */
export function ResetPasswordPage() {
  const { t } = useI18n()
  const auth = useAuth()
  const errorMessage = useErrorMessage()
  const fieldErrors = useFieldErrors()
  const check = useNewPasswordCheck()
  const token = useLinkToken()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [errors, setErrors] = useState<NewPasswordErrors>(NO_PASSWORD_ERRORS)
  const [failure, setFailure] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  useDocumentTitle(t('auth.reset.title'))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !token) return
    const problems = check(password, repeat)
    setErrors(problems)
    if (problems.password || problems.repeat) return
    setSaving(true)
    setFailure(null)
    try {
      const body: PasswordResetIn = { token, new_password: password }
      auth.setSession(await api.post<SessionOut>('/api/auth/password/reset', body))
      setDone(true)
    } catch (error) {
      setSaving(false)
      if (isApiError(error, 'invalid_request') && error.fields?.new_password) {
        setErrors({ password: fieldErrors(error).new_password, repeat: null })
      } else setFailure(error)
    }
  }

  if (done) return <Navigate to="/" replace />
  if (!token || isApiError(failure, 'password_reset_invalid')) {
    return (
      <AuthCard>
        <AuthAlert>{token ? t('auth.reset.expired') : t('auth.reset.invalidLink')}</AuthAlert>
        <LinkButton href="/login" variant="primary" size="lg" fullWidth>
          {t('auth.reset.toLogin')}
        </LinkButton>
      </AuthCard>
    )
  }
  return (
    <AuthCard>
      {failure ? <AuthAlert>{errorMessage(failure)}</AuthAlert> : null}
      <Form className={styles.form} validationBehavior="aria" onSubmit={(event) => void submit(event)} aria-labelledby="reset-title">
        <div className={styles.formHeader}>
          <h2 id="reset-title" className={styles.formTitle}>
            {t('auth.reset.title')}
          </h2>
          <p className={styles.formDescription}>{t('auth.reset.description')}</p>
        </div>
        <NewPasswordFields
          password={password}
          onPasswordChange={(value) => {
            setPassword(value)
            setErrors(NO_PASSWORD_ERRORS)
          }}
          repeat={repeat}
          onRepeatChange={(value) => {
            setRepeat(value)
            setErrors(NO_PASSWORD_ERRORS)
          }}
          errors={errors}
          autoFocus
        />
        <Button type="submit" variant="primary" size="lg" fullWidth isLoading={saving}>
          {t('auth.reset.submit')}
        </Button>
      </Form>
    </AuthCard>
  )
}
