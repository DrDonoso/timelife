import { IconAlertTriangle, IconRefresh, IconX } from '@tabler/icons-react'
import { Label, ProgressBar } from 'react-aria-components'
import { Button } from '../../components/Button'
import { cx } from '../../components/utils'
import { useErrorMessage, useI18n } from '../../i18n'
import type { ImageUploadState } from './useImageUpload'
import styles from './UploadStatus.module.css'

export interface UploadStatusProps {
  state: ImageUploadState
  onCancel: () => void
  onRetry: () => void
  className?: string
}

/** Progress bar (with cancel) while an image uploads; translated error with retry when it fails. */
export function UploadStatus({ state, onCancel, onRetry, className }: UploadStatusProps) {
  const { t } = useI18n()
  const errorMessage = useErrorMessage()

  if (state.status === 'uploading') {
    return (
      <div className={cx(styles.status, className)}>
        <ProgressBar
          className={styles.progress}
          value={Math.round(state.progress * 100)}
          minValue={0}
          maxValue={100}
        >
          {({ percentage, valueText }) => (
            <>
              <div className={styles.progressHeader}>
                <Label className={styles.progressLabel}>
                  {t('adminChildren.upload.uploading', { name: state.fileName ?? '' })}
                </Label>
                <span className={styles.progressValue}>{valueText}</span>
              </div>
              <div className={styles.track}>
                <div className={styles.fill} style={{ width: `${percentage ?? 0}%` }} />
              </div>
            </>
          )}
        </ProgressBar>
        <Button size="sm" variant="ghost" icon={IconX} onPress={onCancel}>
          {t('adminChildren.upload.cancel')}
        </Button>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className={cx(styles.status, styles.error, className)} role="alert">
        <p className={styles.errorText}>
          <IconAlertTriangle size={18} aria-hidden="true" className={styles.errorIcon} />
          <span>{t('adminChildren.upload.failed', { error: errorMessage(state.error) })}</span>
        </p>
        <span className={styles.errorActions}>
          <Button size="sm" icon={IconRefresh} onPress={onRetry}>
            {t('common.retry')}
          </Button>
          <Button size="sm" variant="ghost" onPress={onCancel}>
            {t('adminChildren.upload.dismiss')}
          </Button>
        </span>
      </div>
    )
  }

  return null
}
