import { IconArrowBackUp, IconTrash, IconUpload } from '@tabler/icons-react'
import { useId, useState, type CSSProperties } from 'react'
import { FileTrigger } from 'react-aria-components'
import type { ImageOut } from '../../api/schema.gen'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { StaticFieldDescription, StaticFieldError, StaticFieldLabel } from '../../components/Field'
import { useI18n } from '../../i18n'
import styles from './AvatarField.module.css'
import { IMAGE_ACCEPT, type ImageUploader } from './useImageUpload'
import { UploadStatus } from './UploadStatus'

export interface AvatarFieldProps {
  /** Child's name (initials while there is no photo). */
  name: string
  /** Photo to save: the current one, a new upload or null. */
  value: ImageOut | null
  /** Photo the child had when the form opened (to undo a removal). */
  original: ImageOut | null
  onChange: (image: ImageOut | null) => void
  /** Upload controller owned by the form (it blocks saving while busy). */
  uploader: ImageUploader
  errorMessage?: string | null
}

const RING_RADIUS = 53
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/** Child photo: preview, upload with progress (purpose `avatar`), replace and remove. */
export function AvatarField({ name, value, original, onChange, uploader, errorMessage }: AvatarFieldProps) {
  const { t } = useI18n()
  const labelId = useId()
  const errorId = useId()
  // Browsers can't preview every format (HEIC): fall back to the current avatar then.
  const [brokenPreview, setBrokenPreview] = useState<string | null>(null)
  const { state, upload, cancel, retry } = uploader
  const busy = state.status === 'uploading'
  const localPreview = busy && state.previewUrl !== brokenPreview ? state.previewUrl : null

  return (
    <div
      className={styles.field}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={errorMessage ? errorId : undefined}
    >
      <StaticFieldLabel id={labelId}>{t('adminChildren.avatar.label')}</StaticFieldLabel>
      <div className={styles.body}>
        <div
          className={styles.preview}
          data-busy={busy || undefined}
          style={{ '--ring-length': RING_LENGTH, '--ring-progress': state.progress } as CSSProperties}
        >
          {localPreview ? (
            <img
              className={styles.localImage}
              src={localPreview}
              alt=""
              onError={() => setBrokenPreview(localPreview)}
            />
          ) : (
            <Avatar name={name.trim() || '?'} image={value} size={104} decorative />
          )}
          {busy && (
            <svg className={styles.ring} viewBox="0 0 112 112" aria-hidden="true">
              <circle className={styles.ringTrack} cx="56" cy="56" r={RING_RADIUS} />
              <circle className={styles.ringValue} cx="56" cy="56" r={RING_RADIUS} />
            </svg>
          )}
        </div>
        <div className={styles.side}>
          <div className={styles.actions}>
            <FileTrigger
              acceptedFileTypes={IMAGE_ACCEPT}
              onSelect={(files) => {
                const file = files?.[0]
                if (file) void upload(file)
              }}
            >
              <Button size="sm" icon={IconUpload} isDisabled={busy}>
                {t(value ? 'adminChildren.avatar.change' : 'adminChildren.avatar.upload')}
              </Button>
            </FileTrigger>
            {value && !busy && (
              <Button size="sm" variant="ghost" icon={IconTrash} onPress={() => onChange(null)}>
                {t('adminChildren.avatar.remove')}
              </Button>
            )}
            {!value && original && !busy && (
              <Button size="sm" variant="ghost" icon={IconArrowBackUp} onPress={() => onChange(original)}>
                {t('adminChildren.avatar.restore')}
              </Button>
            )}
          </div>
          <StaticFieldDescription>
            {!value && original ? t('adminChildren.avatar.removed') : t('adminChildren.avatar.hint')}
          </StaticFieldDescription>
          <StaticFieldError id={errorId}>{errorMessage}</StaticFieldError>
        </div>
      </div>
      <UploadStatus state={state} onCancel={cancel} onRetry={retry} />
    </div>
  )
}
