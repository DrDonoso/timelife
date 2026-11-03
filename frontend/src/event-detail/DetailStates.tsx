import { IconAlertTriangle, IconMoodSad } from '@tabler/icons-react'
import { Heading } from 'react-aria-components'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useErrorMessage, useI18n } from '../i18n'
import styles from './DetailStates.module.css'
import { DetailToolbar } from './EventCard'
import cardStyles from './EventCard.module.css'

/** Placeholder with the card's shape (keeps the modal size steady while the event loads). */
export function DetailSkeleton({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  return (
    <div className={cardStyles.card} aria-busy="true">
      <Heading slot="title" className="visually-hidden">
        {t('detail.loading')}
      </Heading>
      <DetailToolbar onClose={onClose} />
      <div className={styles.media} />
      <div className={cardStyles.content} aria-hidden="true">
        <span className={styles.line} style={{ width: '36%' }} />
        <span className={styles.titleLine} style={{ width: '58%' }} />
        <span className={styles.line} style={{ width: '88%' }} />
        <span className={styles.line} style={{ width: '70%' }} />
      </div>
    </div>
  )
}

/** Unknown id, deleted event or malformed link. */
export function DetailNotFound({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  return (
    <div className={styles.state}>
      <Heading slot="title" className="visually-hidden">
        {t('detail.dialogLabel')}
      </Heading>
      <DetailToolbar onClose={onClose} tone="surface" />
      <div className={styles.message}>
        <EmptyState
          icon={IconMoodSad}
          headingLevel={3}
          title={t('detail.notFound.title')}
          description={t('detail.notFound.description')}
          actions={
            <Button variant="primary" onPress={onClose}>
              {t('detail.notFound.action')}
            </Button>
          }
        />
      </div>
    </div>
  )
}

export interface DetailErrorProps {
  error: unknown
  onRetry: () => void
  isRetrying: boolean
  onClose: () => void
}

/** Network / server error while loading the event. */
export function DetailError({ error, onRetry, isRetrying, onClose }: DetailErrorProps) {
  const { t } = useI18n()
  const errorMessage = useErrorMessage()
  return (
    <div className={styles.state}>
      <Heading slot="title" className="visually-hidden">
        {t('detail.dialogLabel')}
      </Heading>
      <DetailToolbar onClose={onClose} tone="surface" />
      <div className={styles.message}>
        <EmptyState
          icon={IconAlertTriangle}
          tone="error"
          headingLevel={3}
          title={t('detail.loadError.title')}
          description={errorMessage(error)}
          actions={
            <>
              <Button variant="primary" onPress={onRetry} isLoading={isRetrying}>
                {t('common.retry')}
              </Button>
              <Button onPress={onClose}>{t('common.close')}</Button>
            </>
          }
        />
      </div>
    </div>
  )
}
