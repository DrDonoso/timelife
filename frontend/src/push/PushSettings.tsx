import { IconBellCog, IconBellOff } from '@tabler/icons-react'
import { isApiError } from '../api/client'
import { Button } from '../components/Button'
import { Switch } from '../components/Switch'
import { useToast } from '../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../i18n'
import { usePush } from './PushContext'
import styles from './PushSettings.module.css'

export interface PushSettingsProps {
  /** «Elegir notificaciones»: opens the choice of which ones reach the person's devices. */
  onChoose: () => void
}

/**
 * The account panel's section about notifications on this device: their switch and, once they
 * are on, the button to choose which ones arrive, or why they cannot be turned on here (an iPhone
 * in Safari, blocked notifications). Nothing where browsers have no notifications, nor in the demo.
 */
export function PushSettings({ onChoose }: PushSettingsProps) {
  const { t } = useI18n()
  const push = usePush()
  const toast = useToast()
  const errorMessage = useErrorMessage()
  if (!push || push.status === 'unsupported') return null
  const { status, busy } = push

  function failed(error: unknown) {
    toast.show({ tone: 'error', message: isApiError(error) ? errorMessage(error) : t('push.error') })
  }

  function toggle(on: boolean) {
    if (!push) return
    const change = on
      ? push.enable().then((enabled) => {
          if (enabled) toast.show({ tone: 'success', message: t('push.enabled') })
        })
      : push.disable()
    change.catch(failed)
  }

  return (
    <div role="group" aria-label={t('push.title')} className={styles.settings}>
      {status === 'install' || status === 'denied' ? (
        <p className={styles.notice}>
          <IconBellOff size={18} stroke={2} aria-hidden="true" className={styles.noticeIcon} />
          <span>{t(`push.${status}`)}</span>
        </p>
      ) : (
        <>
          <Switch className={styles.switch} isSelected={status === 'on'} isDisabled={busy} onChange={toggle}>
            {t('push.switch')}
          </Switch>
          {status === 'on' && (
            <Button variant="ghost" size="sm" icon={IconBellCog} isDisabled={busy} className={styles.choose} onPress={onChoose}>
              {t('push.choose')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
