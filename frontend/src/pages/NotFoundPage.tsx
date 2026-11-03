import { IconMapQuestion } from '@tabler/icons-react'
import { LinkButton } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useI18n } from '../i18n'
import { Logo } from '../shell/Logo'
import { useDocumentTitle } from '../utils/useDocumentTitle'
import styles from './StatusPage.module.css'

/** Standalone 404 page (outside the app shell). */
export function NotFoundPage() {
  const { t } = useI18n()
  useDocumentTitle(t('common.notFound.title'))
  return (
    <main className={styles.page}>
      <Logo size={40} withName className={styles.logo} />
      <EmptyState
        size="lg"
        headingLevel={1}
        icon={IconMapQuestion}
        title={t('common.notFound.title')}
        description={t('common.notFound.description')}
        actions={
          <LinkButton href="/" variant="primary" size="lg">
            {t('common.goHome')}
          </LinkButton>
        }
      />
    </main>
  )
}
