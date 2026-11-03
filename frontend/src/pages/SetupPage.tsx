import { useState } from 'react'
import { Navigate } from 'react-router'
import { isApiError } from '../api/client'
import { AuthAlert, AuthCard } from '../auth/AuthCard'
import { useLinkToken } from '../auth/linkToken'
import { SetupForm } from '../auth/SetupForm'
import { LinkButton } from '../components/Button'
import { useErrorMessage, useI18n } from '../i18n'
import { useDocumentTitle } from '../utils/useDocumentTitle'

/**
 * `/setup#<code>`: the recovery link printed by `python -m timelife.setup` (an administrator
 * account, or a new password and administrator rights for an existing one). A new installation
 * creates its first administrator from the login page instead.
 */
export function SetupPage() {
  const { t } = useI18n()
  const errorMessage = useErrorMessage()
  const token = useLinkToken()
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState(false)
  useDocumentTitle(t('auth.setup.recoveryTitle'))

  if (done) return <Navigate to="/" replace />
  if (!token || isApiError(error, 'setup_closed')) {
    return (
      <AuthCard>
        <AuthAlert>{token ? t('auth.setup.closed') : t('auth.setup.invalidLink')}</AuthAlert>
        <LinkButton href="/login" variant="primary" size="lg" fullWidth>
          {t('auth.setup.toLogin')}
        </LinkButton>
      </AuthCard>
    )
  }
  return (
    <AuthCard>
      {error ? <AuthAlert>{errorMessage(error)}</AuthAlert> : null}
      <SetupForm token={token} onError={setError} onDone={() => setDone(true)} />
    </AuthCard>
  )
}
