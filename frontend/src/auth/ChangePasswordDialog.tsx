import { useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Form } from 'react-aria-components'
import { api, isApiError } from '../api/client'
import { qk } from '../api/queries'
import type { PasswordChangeIn, SessionOut } from '../api/schema.gen'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { PasswordField } from '../components/PasswordField'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useErrorMessage, useFieldErrors, useI18n } from '../i18n'
import styles from './ChangePasswordDialog.module.css'
import { NewPasswordFields, NO_PASSWORD_ERRORS, useNewPasswordCheck, type NewPasswordErrors } from './NewPasswordFields'

function ChangePasswordForm({ close }: { close: () => void }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const fieldErrors = useFieldErrors()
  const check = useNewPasswordCheck()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [currentError, setCurrentError] = useState<string | null>(null)
  const [errors, setErrors] = useState<NewPasswordErrors>(NO_PASSWORD_ERRORS)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const problems = check(next, repeat, current || undefined)
    setCurrentError(current ? null : t('auth.rules.required'))
    setErrors(problems)
    setFormError(null)
    if (!current || problems.password || problems.repeat) return
    setSaving(true)
    try {
      const body: PasswordChangeIn = { current_password: current, new_password: next }
      // A new session for this browser: the others were signed out.
      queryClient.setQueryData<SessionOut>(qk.session, await api.post<SessionOut>('/api/auth/password', body))
      show({ tone: 'success', message: t('auth.change.done') })
      close()
    } catch (error) {
      setSaving(false)
      if (isApiError(error, 'current_password_invalid')) setCurrentError(errorMessage(error))
      else if (isApiError(error, 'password_unchanged')) setErrors({ password: t('auth.rules.unchanged'), repeat: null })
      else if (isApiError(error, 'invalid_request') && error.fields?.new_password) {
        setErrors({ password: fieldErrors(error).new_password, repeat: null })
      } else setFormError(errorMessage(error))
    }
  }

  return (
    <Form className={styles.form} validationBehavior="aria" onSubmit={(event) => void submit(event)}>
      <p className={styles.description}>{t('auth.change.description')}</p>
      {formError && (
        <p className={styles.error} role="alert">
          <IconAlertTriangle size={18} aria-hidden="true" />
          {formError}
        </p>
      )}
      {/* The account whose password changes, for password managers. */}
      <input type="email" name="email" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
      <PasswordField
        label={t('auth.change.current')}
        name="current-password"
        autoComplete="current-password"
        value={current}
        onChange={(value) => {
          setCurrent(value)
          setCurrentError(null)
        }}
        errorMessage={currentError}
        isRequired
        autoFocus
      />
      <NewPasswordFields
        password={next}
        onPasswordChange={(value) => {
          setNext(value)
          setErrors(NO_PASSWORD_ERRORS)
        }}
        repeat={repeat}
        onRepeatChange={(value) => {
          setRepeat(value)
          setErrors(NO_PASSWORD_ERRORS)
        }}
        errors={errors}
      />
      <div className={styles.buttons}>
        <Button onPress={close}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" isLoading={saving}>
          {t('auth.change.submit')}
        </Button>
      </div>
    </Form>
  )
}

export interface ChangePasswordDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

/** The signed-in user changes their password (the current one first); other sessions end. */
export function ChangePasswordDialog({ isOpen, onOpenChange }: ChangePasswordDialogProps) {
  const { t } = useI18n()
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('auth.change.title')} size="sm" fullScreenOnMobile>
      {(close) => <ChangePasswordForm close={close} />}
    </Modal>
  )
}
