import { IconAlertTriangle, IconMoodKid, IconMoodSad } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Button, LinkButton } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { LoadingState } from '../components/Spinner'
import { useAuth } from '../contexts/AuthContext'
import { defaultTimelinePath, useCurrentChild } from '../contexts/CurrentChildContext'
import { useErrorMessage, useI18n } from '../i18n'

/** `/login?next=<current path>` (no `next` for the home page). */
export function loginPath(pathname: string, search = ''): string {
  const next = `${pathname}${search}`
  return next === '/' || next === '' ? '/login' : `/login?next=${encodeURIComponent(next)}`
}

/** Signed-in users only; others go to the login page and come back afterwards. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { t } = useI18n()
  const auth = useAuth()
  const errorMessage = useErrorMessage()
  const location = useLocation()

  if (auth.status === 'loading') return <LoadingState fill message={t('auth.checkingSession')} />
  if (auth.status === 'anonymous') {
    if (auth.error) {
      return (
        <EmptyState
          icon={IconAlertTriangle}
          tone="error"
          title={t('auth.sessionError')}
          description={errorMessage(auth.error)}
          actions={
            <Button variant="primary" onPress={auth.retry}>
              {t('common.retry')}
            </Button>
          }
        />
      )
    }
    const target = auth.signedOut ? '/login' : loginPath(location.pathname, location.search)
    return <Navigate to={target} replace />
  }
  return children ?? <Outlet />
}

/** Administrators only; signed-in viewers are sent home. */
export function RequireAdmin({ children }: { children?: ReactNode }) {
  const auth = useAuth()
  if (!auth.isAdmin) return <Navigate to="/" replace />
  return children ?? <Outlet />
}

function ChildrenError({ error }: { error: unknown }) {
  const { t } = useI18n()
  const errorMessage = useErrorMessage()
  return (
    <EmptyState
      icon={IconAlertTriangle}
      tone="error"
      title={t('shell.childrenError')}
      description={errorMessage(error)}
      actions={
        <Button variant="primary" onPress={() => window.location.reload()}>
          {t('common.reload')}
        </Button>
      }
    />
  )
}

/** `/`: open the remembered (or first) child's timeline, or the family one; friendly empty state without children. */
export function RootRedirect() {
  const { t } = useI18n()
  const auth = useAuth()
  const { children, isLoading, error } = useCurrentChild()
  if (isLoading) return <LoadingState fill />
  if (error) return <ChildrenError error={error} />
  const path = defaultTimelinePath(children)
  if (path) return <Navigate to={path} replace />
  return (
    <EmptyState
      size="lg"
      icon={IconMoodKid}
      title={t('shell.noChildren.title')}
      description={auth.isAdmin ? t('shell.noChildren.descriptionAdmin') : t('shell.noChildren.descriptionViewer')}
      actions={
        auth.isAdmin && (
          <LinkButton href="/admin/children" variant="primary" size="lg">
            {t('shell.noChildren.action')}
          </LinkButton>
        )
      }
    />
  )
}

/** `/c/:childSlug`: renders its children only for an existing child slug. */
export function RequireChild({ children }: { children?: ReactNode }) {
  const { t } = useI18n()
  const current = useCurrentChild()
  if (current.isLoading) return <LoadingState fill />
  if (current.error) return <ChildrenError error={current.error} />
  if (!current.child) {
    return (
      <EmptyState
        icon={IconMoodSad}
        title={t('shell.childNotFound.title')}
        description={t('shell.childNotFound.description')}
        actions={
          <LinkButton href="/" variant="primary">
            {t('shell.childNotFound.action')}
          </LinkButton>
        }
      />
    )
  }
  return children ?? <Outlet />
}

/** `/all`: the family timeline needs at least one child (without any, home explains how to add them). */
export function RequireFamily({ children }: { children?: ReactNode }) {
  const current = useCurrentChild()
  if (current.isLoading) return <LoadingState fill />
  if (current.error) return <ChildrenError error={current.error} />
  if (current.children.length === 0) return <Navigate to="/" replace />
  return children ?? <Outlet />
}
