import { IconAlertTriangle, IconPalette } from '@tabler/icons-react'
import { useAppearance } from '../../api/queries'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { LoadingState } from '../../components/Spinner'
import { useErrorMessage, useI18n } from '../../i18n'
import { useDocumentTitle } from '../../utils/useDocumentTitle'
import styles from './AppearancePage.module.css'
import { LaneColorsSection } from './LaneColors'
import { TimelineSettingsSection } from './TimelineSettings'
import { YearColorsSection } from './YearColors'

export function AppearancePage() {
  const { t } = useI18n()
  useDocumentTitle(t('admin.nav.appearance'), t('admin.title'))
  const errorMessage = useErrorMessage()
  const appearance = useAppearance()

  let content
  if (appearance.isPending) {
    content = <LoadingState message={t('common.loading')} />
  } else if (appearance.isError) {
    content = (
      <EmptyState
        tone="error"
        icon={IconAlertTriangle}
        title={t('adminAppearance.loadError')}
        description={errorMessage(appearance.error)}
        actions={<Button onPress={() => void appearance.refetch()}>{t('common.retry')}</Button>}
      />
    )
  } else {
    content = (
      <div className={styles.sections}>
        <YearColorsSection appearance={appearance.data} />
        <LaneColorsSection />
        <TimelineSettingsSection appearance={appearance.data} />
      </div>
    )
  }

  return (
    <>
      <PageHeader icon={IconPalette} title={t('admin.nav.appearance')} description={t('adminAppearance.description')} />
      {content}
    </>
  )
}
