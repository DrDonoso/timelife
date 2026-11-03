import { useState, type FormEvent, type ReactNode } from 'react'
import { Button as AriaButton, Form } from 'react-aria-components'
import { api, isApiError } from '../api/client'
import type { PasswordForgotIn, PasswordLoginIn, SessionOut } from '../api/schema.gen'
import { Button } from '../components/Button'
import { PasswordField } from '../components/PasswordField'
import { useAuth } from '../contexts/AuthContext'
import { useFieldErrors, useI18n } from '../i18n'
import { AuthAlert } from './AuthCard'
import styles from './AuthCard.module.css'
import { EmailField, useEmailCheck } from './EmailField'
import { NewPasswordFields, NO_PASSWORD_ERRORS, useNewPasswordCheck, type NewPasswordErrors } from './NewPasswordFields'

type OnError = (error: unknown) => void

interface FirstPasswordFormProps {
  email: string
  password: string
  onBack: () => void
  onError: OnError
}

/** A temporary password (set by an administrator) is replaced before the first sign-in. */
function FirstPasswordForm({ email, password, onBack, onError }: FirstPasswordFormProps) {
  const { t } = useI18n()
  const auth = useAuth()
  const check = useNewPasswordCheck()
  const fieldErrors = useFieldErrors()
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [errors, setErrors] = useState<NewPasswordErrors>(NO_PASSWORD_ERRORS)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const problems = check(next, repeat, password)
    setErrors(problems)
    if (problems.password || problems.repeat) return
    setSaving(true)
    onError(null)
    try {
      const body: PasswordLoginIn = { email, password, new_password: next }
      auth.setSession(await api.post<SessionOut>('/api/auth/login', body))
    } catch (error) {
      setSaving(false)
      if (isApiError(error, 'password_unchanged')) setErrors({ password: t('auth.rules.unchanged'), repeat: null })
      else if (isApiError(error, 'invalid_request') && error.fields?.new_password) {
        setErrors({ password: fieldErrors(error).new_password, repeat: null })
      } else onError(error)
    }
  }

  return (
    <Form className={styles.form} validationBehavior="aria" onSubmit={(event) => void submit(event)} aria-labelledby="first-password-title">
      <div className={styles.formHeader}>
        <h2 id="first-password-title" className={styles.formTitle}>
          {t('auth.firstPassword.title')}
        </h2>
        <p className={styles.formDescription}>{t('auth.firstPassword.description')}</p>
      </div>
      <p className={styles.account}>
        <span className={styles.accountLabel}>{t('auth.firstPassword.account')}</span>
        <span>{email}</span>
      </p>
      {/* The account the new password belongs to, for password managers. */}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
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
        autoFocus
      />
      <Button type="submit" variant="primary" size="lg" fullWidth isLoading={saving}>
        {t('auth.firstPassword.submit')}
      </Button>
      <AriaButton className={styles.textLink} onPress={onBack}>
        {t('auth.firstPassword.back')}
      </AriaButton>
    </Form>
  )
}

/** Asks for an e-mail with a link to choose a new password (SMTP configured). */
function ForgotPasswordForm({ initialEmail, onBack, onError }: { initialEmail: string; onBack: () => void; onError: OnError }) {
  const { t, lang } = useI18n()
  const checkEmail = useEmailCheck()
  const [email, setEmail] = useState(initialEmail)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    const [address, problem] = checkEmail(email)
    setEmailError(problem)
    if (!address) return
    setSending(true)
    onError(null)
    try {
      const body: PasswordForgotIn = { email: address, locale: lang }
      await api.post('/api/auth/password/forgot', body)
      setSentTo(address)
    } catch (error) {
      onError(error)
    } finally {
      setSending(false)
    }
  }

  if (sentTo) {
    return (
      <div className={styles.form}>
        <AuthAlert tone="success">{t('auth.forgot.sent', { email: sentTo })}</AuthAlert>
        <AriaButton className={styles.textLink} onPress={onBack} autoFocus>
          {t('auth.forgot.back')}
        </AriaButton>
      </div>
    )
  }
  return (
    <Form className={styles.form} validationBehavior="aria" onSubmit={(event) => void submit(event)} aria-labelledby="forgot-title">
      <div className={styles.formHeader}>
        <h2 id="forgot-title" className={styles.formTitle}>
          {t('auth.forgot.title')}
        </h2>
        <p className={styles.formDescription}>{t('auth.forgot.description')}</p>
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
      <Button type="submit" variant="primary" size="lg" fullWidth isLoading={sending}>
        {t('auth.forgot.submit')}
      </Button>
      <AriaButton className={styles.textLink} onPress={onBack}>
        {t('auth.forgot.back')}
      </AriaButton>
    </Form>
  )
}

export interface PasswordSignInProps {
  /** Offer "Forgot your password?" (the server can send e-mails). */
  resetEnabled: boolean
  /** Shows (or, with null, clears) the error of the last attempt. */
  onError: OnError
  /** Shown around the sign-in form only (not while choosing or recovering a password). */
  before?: ReactNode
  after?: ReactNode
}

/**
 * Sign in with e-mail and password. A temporary password is replaced first (the server answers
 * `password_change_required`); "Forgot your password?" asks for an e-mail with a link.
 */
export function PasswordSignIn({ resetEnabled, onError, before, after }: PasswordSignInProps) {
  const { t } = useI18n()
  const auth = useAuth()
  const checkEmail = useEmailCheck()
  const [view, setView] = useState<'signIn' | 'firstPassword' | 'forgot'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function show(next: typeof view) {
    onError(null)
    setView(next)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const [address, problem] = checkEmail(email)
    setEmailError(problem)
    setPasswordError(password ? null : t('auth.rules.required'))
    if (!address || !password) return
    setSubmitting(true)
    onError(null)
    try {
      const body: PasswordLoginIn = { email: address, password }
      auth.setSession(await api.post<SessionOut>('/api/auth/login', body))
    } catch (error) {
      setSubmitting(false)
      if (isApiError(error, 'password_change_required')) {
        setEmail(address)
        setView('firstPassword')
      } else onError(error)
    }
  }

  if (view === 'firstPassword') {
    return (
      <FirstPasswordForm
        email={email}
        password={password}
        onBack={() => {
          setPassword('')
          show('signIn')
        }}
        onError={onError}
      />
    )
  }
  if (view === 'forgot') return <ForgotPasswordForm initialEmail={email.trim()} onBack={() => show('signIn')} onError={onError} />
  return (
    <>
      {before}
      <Form className={styles.form} validationBehavior="aria" onSubmit={(event) => void submit(event)} aria-label={t('auth.signIn.title')}>
        <EmailField
          value={email}
          onChange={(value) => {
            setEmail(value)
            setEmailError(null)
          }}
          error={emailError}
        />
        <PasswordField
          label={t('auth.signIn.password')}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(value) => {
            setPassword(value)
            setPasswordError(null)
          }}
          errorMessage={passwordError}
          isRequired
        />
        <Button type="submit" variant="primary" size="lg" fullWidth isLoading={submitting}>
          {t('auth.signIn.submit')}
        </Button>
        {resetEnabled && (
          <AriaButton className={styles.textLink} onPress={() => show('forgot')}>
            {t('auth.signIn.forgot')}
          </AriaButton>
        )}
      </Form>
      {after}
    </>
  )
}
