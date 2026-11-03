import { IconAlertTriangle } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { useErrorMessage, useI18n } from '../i18n'
import { Button } from './Button'
import styles from './ConfirmDialog.module.css'
import { Modal } from './Modal'

export interface ConfirmDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  title: ReactNode
  /** Explanation under the title. */
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` (default) for destructive actions. */
  tone?: 'danger' | 'primary'
  /**
   * Runs on confirm. A returned promise keeps the dialog open with a spinner; it closes on success
   * and shows the translated error on failure.
   */
  onConfirm: () => unknown
  /** Externally controlled pending state (e.g. a mutation's `isPending`). */
  isPending?: boolean
}

function ConfirmBody({
  children,
  tone,
  confirmLabel,
  cancelLabel,
  onConfirm,
  isPending,
  close,
}: Omit<ConfirmDialogProps, 'isOpen' | 'onOpenChange' | 'title'> & { close: () => void }) {
  const { t } = useI18n()
  const errorMessage = useErrorMessage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = busy || Boolean(isPending)

  async function confirm() {
    setError(null)
    const result = onConfirm()
    if (!(result instanceof Promise)) {
      close()
      return
    }
    setBusy(true)
    try {
      await result
      close()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <div className={styles.body}>
      {children && <div className={styles.message}>{children}</div>}
      {error && (
        <p className={styles.error} role="alert">
          <IconAlertTriangle size={16} aria-hidden="true" />
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="ghost" onPress={close} isDisabled={pending}>
          {cancelLabel ?? t('common.cancel')}
        </Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} isLoading={pending} onPress={() => void confirm()}>
          {confirmLabel ?? t('common.confirm')}
        </Button>
      </div>
    </div>
  )
}

/** Small alert dialog asking to confirm an action. */
export function ConfirmDialog({ isOpen, onOpenChange, title, tone = 'danger', ...rest }: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={title} size="sm" role="alertdialog" hideCloseButton>
      {(close) => <ConfirmBody {...rest} tone={tone} close={close} />}
    </Modal>
  )
}
