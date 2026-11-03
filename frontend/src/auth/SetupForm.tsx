import { useQueryClient } from '@tanstack/react-query'
import { IconUser } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Form } from 'react-aria-components'
import { api, isApiError } from '../api/client'
import { qk } from '../api/queries'
import type { AuthConfigOut, SessionOut, SetupIn } from '../api/schema.gen'
import { Button } from '../components/Button'
import { TextField } from '../components/TextField'
import { useAuth } from '../contexts/AuthContext'
import { useFieldErrors, useI18n } from '../i18n'
import styles from './AuthCard.module.css'
import { EmailField, useEmailCheck } from './EmailField'
import { NewPasswordFields, NO_PASSWORD_ERRORS, useNewPasswordCheck, type NewPasswordErrors } from './NewPasswordFields'

export interface SetupFormProps {
  /** Code of a recovery link (`python -m timelife.setup`); none while there is no administrator. */
  token?: string | null
  /** Shows (or, with null, clears) the error of the last attempt. */
  onError: (error: unknown) => void
  /** After the administrator signed in. */
  onDone?: () => void
}

/**
 * Creates the first administrator (a new installation) or, with a recovery link, an administrator
 * account or a new password for an existing one, and signs them in.
 */
export function SetupForm({ token = null, onError, onDone }: SetupFormProps) {
  const { t } = useI18n()
  const auth = useAuth()
  const queryClient = useQueryClient()
  const checkEmail = useEmailCheck()
  const checkPassword = useNewPasswordCheck()
  const fieldErrors = useFieldErrors()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [errors, setErrors] = useState<NewPasswordErrors>(NO_PASSWORD_ERRORS)
  const [saving, setSaving] = useState(false)
  const recovery = token !== null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const [address, emailProblem] = checkEmail(email)
    const problems = checkPassword(password, repeat)
    setEmailError(emailProblem)
    setErrors(problems)
    if (!address || problems.password || problems.repeat) return
    setSaving(true)
    onError(null)
    try {
      const body: SetupIn = { email: address, password, name: name.trim() || null, token }
      const session = await api.post<SessionOut>('/api/auth/setup', body)
      queryClient.setQueryData<AuthConfigOut>(qk.authConfig, (config) => config && { ...config, setup_required: false })
      auth.setSession(session)
      onDone?.()
    } catch (error) {
      setSaving(false)
      const fields = isApiError(error, 'invalid_request') ? fieldErrors(error) : {}
      if (fields.email || fields.name || fields.password) {
        setEmailError(fields.email ?? null)
        setNameError(fields.name ?? null)
        setErrors({ password: fields.password ?? null, repeat: null })
        return
      }
      // Somebody else created the first administrator meanwhile: the login page shows the sign-in.
      if (!recovery && isApiError(error, 'setup_closed')) void queryClient.invalidateQueries({ queryKey: qk.authConfig })
      onError(error)
    }
  }

  return (
    <Form className={styles.form} validationBehavior="aria" onSubmit={(event) => void submit(event)} aria-labelledby="setup-title">
      <div className={styles.formHeader}>
        <h2 id="setup-title" className={styles.formTitle}>
          {recovery ? t('auth.setup.recoveryTitle') : t('auth.setup.title')}
        </h2>
        <p className={styles.formDescription}>{recovery ? t('auth.setup.recoveryDescription') : t('auth.setup.description')}</p>
      </div>
      <EmailField
        value={email}
        onChange={(value) => {
          setEmail(value)
          setEmailError(null)
        }}
        error={emailError}
        autoFocus
      />
      <TextField
        label={t('auth.setup.name')}
        description={t('auth.setup.nameDescription')}
        name="name"
        autoComplete="name"
        icon={IconUser}
        value={name}
        onChange={(value) => {
          setName(value)
          setNameError(null)
        }}
        errorMessage={nameError}
        maxLength={120}
      />
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
      />
      <Button type="submit" variant="primary" size="lg" fullWidth isLoading={saving}>
        {recovery ? t('auth.setup.recoverySubmit') : t('auth.setup.submit')}
      </Button>
    </Form>
  )
}
