import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import { useEffect } from 'react'
import { useRouteError } from 'react-router'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useI18n } from '../i18n'
import { Logo } from '../shell/Logo'
import styles from './StatusPage.module.css'

/** A lazy chunk that no longer exists on the server (the app was redeployed). */
export function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(error.message)
  )
}

/** Route `errorElement`: friendly crash screen with a reload button (`inline` keeps the layout). */
export function RouteErrorPage({ inline = false }: { inline?: boolean }) {
  const { t } = useI18n()
  const error = useRouteError()
  const outdated = isChunkLoadError(error)

  useEffect(() => {
    if (!outdated) console.error('Timelife: unexpected rendering error', error)
  }, [error, outdated])

  const content = (
    <EmptyState
      size={inline ? 'md' : 'lg'}
      headingLevel={inline ? 2 : 1}
      tone={outdated ? 'neutral' : 'error'}
      icon={outdated ? IconRefresh : IconAlertTriangle}
      title={outdated ? t('common.outdated.title') : t('common.crash.title')}
      description={outdated ? t('common.outdated.description') : t('common.crash.description')}
      actions={
        <Button variant="primary" size="lg" icon={IconRefresh} onPress={() => window.location.reload()}>
          {t('common.reload')}
        </Button>
      }
    />
  )
  if (inline) return content
  return (
    <main className={styles.page}>
      <Logo size={40} withName className={styles.logo} />
      {content}
    </main>
  )
}
