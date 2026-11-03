import { useState, type FormEvent } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { Navigate, useSearchParams } from 'react-router'
import { api } from '../api/client'
import { useAuthConfig } from '../api/queries'
import type { GoogleStartOut, SessionOut } from '../api/schema.gen'
import { AuthAlert, AuthCard } from '../auth/AuthCard'
import styles from '../auth/AuthCard.module.css'
import { PasswordSignIn } from '../auth/PasswordSignIn'
import { SetupForm } from '../auth/SetupForm'
import { Button } from '../components/Button'
import { SegmentedControl } from '../components/SegmentedControl'
import { LoadingState, Spinner } from '../components/Spinner'
import { TextField } from '../components/TextField'
import { useAuth } from '../contexts/AuthContext'
import { GoogleMark } from '../icons/GoogleMark'
import { useErrorMessage, useI18n } from '../i18n'
import { browserNavigation } from '../utils/navigation'
import { useDocumentTitle } from '../utils/useDocumentTitle'

/** Same-origin path to return to after signing in (`next`), never the login page itself. */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/')) return '/'
  return raw.length > 512 ? '/' : raw
}

function Divider() {
  const { t } = useI18n()
  return (
    <div className={styles.divider} role="separator">
      <span>{t('auth.or')}</span>
    </div>
  )
}

function GoogleButton({ next, onError }: { next: string; onError: (error: unknown) => void }) {
  const { t } = useI18n()
  const [redirecting, setRedirecting] = useState(false)

  async function start() {
    setRedirecting(true)
    onError(null)
    try {
      const { authorization_url: url } = await api.post<GoogleStartOut>('/api/auth/google/start', { return_path: next })
      browserNavigation.assign(url)
    } catch (error) {
      setRedirecting(false)
      onError(error)
    }
  }

  return (
    <AriaButton className={styles.google} isPending={redirecting} onPress={() => void start()}>
      {redirecting ? <Spinner size={20} decorative /> : <GoogleMark size={20} />}
      <span>{redirecting ? t('auth.redirecting') : t('auth.continueWithGoogle')}</span>
    </AriaButton>
  )
}

function DevLoginForm({ onError }: { onError: (error: unknown) => void }) {
  const { t } = useI18n()
  const auth = useAuth()
  const [username, setUsername] = useState<'admin' | 'viewer'>('admin')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password) return
    setSubmitting(true)
    onError(null)
    try {
      const session = await api.post<SessionOut>('/api/auth/dev-login', { username, password })
      auth.setSession(session)
    } catch (error) {
      setSubmitting(false)
      onError(error)
    }
  }

  return (
    <form className={styles.devForm} onSubmit={(event) => void submit(event)} aria-labelledby="dev-login-title">
      <div className={styles.devHeader}>
        <h2 id="dev-login-title" className={styles.devTitle}>
          {t('auth.devLogin.title')}
        </h2>
        <p className={styles.devDescription}>{t('auth.devLogin.description')}</p>
      </div>
      <SegmentedControl<'admin' | 'viewer'>
        aria-label={t('auth.devLogin.user')}
        value={username}
        onChange={setUsername}
        fullWidth
        options={[
          { value: 'admin', label: t('auth.devLogin.admin') },
          { value: 'viewer', label: t('auth.devLogin.viewer') },
        ]}
      />
      <TextField
        label={t('auth.devLogin.password')}
        type="password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        isRequired
      />
      <Button type="submit" variant="primary" size="lg" fullWidth isLoading={submitting} isDisabled={!password}>
        {t('auth.devLogin.submit')}
      </Button>
    </form>
  )
}

/**
 * `/login`: e-mail and password (always), Google (when configured) and, on a local stack, the
 * development sign-in. A new installation (no administrator yet) shows the form that creates the
 * first administrator instead.
 */
export function LoginPage() {
  const { t, hasMessage } = useI18n()
  const errorMessage = useErrorMessage()
  const auth = useAuth()
  const config = useAuthConfig()
  const [params] = useSearchParams()
  const [actionError, setActionError] = useState<unknown>(null)
  useDocumentTitle()

  const next = safeNextPath(params.get('next'))
  const errorParam = params.get('error')
  const errorKey = `errors.${errorParam}`
  const callbackError = errorParam ? (hasMessage(errorKey) ? t(errorKey) : t('errors.unknown')) : null

  if (auth.status === 'authenticated') return <Navigate to={next} replace />
  if (auth.status === 'loading') return <LoadingState fill message={t('auth.checkingSession')} />

  const google = config.data?.google_enabled ?? false
  const devLogin = config.data?.dev_login_enabled ?? false
  const setupRequired = config.data?.setup_required ?? false
  const development = devLogin && (
    <>
      <Divider />
      <DevLoginForm onError={setActionError} />
    </>
  )

  let content
  if (config.isPending) content = <Spinner size="md" className={styles.configSpinner} />
  else if (config.isError) {
    content = (
      <div className={styles.configError}>
        <p>{t('auth.configError')}</p>
        <Button size="sm" onPress={() => void config.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  } else if (setupRequired) {
    content = (
      <>
        <SetupForm onError={setActionError} />
        {development}
      </>
    )
  } else {
    content = (
      <PasswordSignIn
        resetEnabled={config.data.password_reset_enabled}
        onError={setActionError}
        before={
          google && (
            <>
              <GoogleButton next={next} onError={setActionError} />
              <Divider />
            </>
          )
        }
        after={development}
      />
    )
  }

  return (
    <AuthCard footnote={setupRequired ? t('auth.setup.footnote') : t('auth.inviteOnly')}>
      {callbackError && <AuthAlert>{callbackError}</AuthAlert>}
      {actionError ? <AuthAlert>{errorMessage(actionError)}</AuthAlert> : null}
      {content}
    </AuthCard>
  )
}
