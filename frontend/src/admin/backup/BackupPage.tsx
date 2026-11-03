import { IconAlertTriangle, IconDatabaseExport, IconDownload } from '@tabler/icons-react'
import { Button, LinkButton } from '../../components/Button'
import { PageHeader } from '../../components/PageHeader'
import { LoadingState } from '../../components/Spinner'
import { useToast } from '../../contexts/ToastContext'
import { IS_DEMO } from '../../demo/config'
import { useErrorMessage, useI18n } from '../../i18n'
import { useDocumentTitle } from '../../utils/useDocumentTitle'
import { BackupContents } from './BackupContents'
import { EXPORT_URL, useBackupSummary } from './backupApi'
import styles from './BackupPage.module.css'
import { ImportSection } from './ImportSection'

function ExportSection() {
  const { t } = useI18n()
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const summary = useBackupSummary()

  let contents
  if (summary.isPending) {
    contents = <LoadingState message={t('common.loading')} />
  } else if (summary.isError) {
    contents = (
      <div className={styles.notice} data-tone="error" role="alert">
        <IconAlertTriangle size={18} aria-hidden="true" />
        <p>
          {t('adminBackup.export.loadError')} {errorMessage(summary.error)}
        </p>
        <Button size="sm" onPress={() => void summary.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  } else {
    contents = <BackupContents summary={summary.data} label={t('adminBackup.export.contents')} />
  }

  return (
    <section className={styles.card} aria-labelledby="backup-export-title">
      <header className={styles.cardHeader}>
        <h2 id="backup-export-title" className={styles.cardTitle}>
          {t('adminBackup.export.title')}
        </h2>
        <p className={styles.cardDescription}>{t('adminBackup.export.description')}</p>
      </header>
      <div className={styles.cardBody}>
        {contents}
        <div className={styles.actions}>
          {IS_DEMO ? (
            <Button
              variant="primary"
              icon={IconDownload}
              onPress={() => toast.show({ tone: 'info', message: t('errors.demo_unavailable') })}
            >
              {t('adminBackup.export.action')}
            </Button>
          ) : (
            <LinkButton href={EXPORT_URL} download variant="primary" icon={IconDownload}>
              {t('adminBackup.export.action')}
            </LinkButton>
          )}
        </div>
        <p className={styles.note}>{t('adminBackup.export.note')}</p>
      </div>
    </section>
  )
}

/** `/admin/backup`: download everything as one ZIP, or import such a file (merge or replace). */
export function BackupPage() {
  const { t } = useI18n()
  useDocumentTitle(t('admin.nav.backup'), t('admin.title'))
  return (
    <>
      <PageHeader icon={IconDatabaseExport} title={t('admin.nav.backup')} description={t('adminBackup.description')} />
      <div className={styles.sections}>
        <ExportSection />
        <ImportSection />
      </div>
    </>
  )
}
