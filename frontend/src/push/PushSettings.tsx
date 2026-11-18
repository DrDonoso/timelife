import { IconBellOff, IconSend } from '@tabler/icons-react'
import { useId } from 'react'
import { isApiError } from '../api/client'
import { Button } from '../components/Button'
import { Switch } from '../components/Switch'
import { useToast } from '../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../i18n'
import { usePush } from './PushContext'
import styles from './PushSettings.module.css'

/**
 * The account panel's section about notifications on this device: the switch of the memories'
 * notification and a test, or why they cannot be turned on here (an iPhone in Safari, blocked
 * notifications). Nothing where browsers have no notifications, nor in the demo.
 */
export function PushSettings() {
  const { t } = useI18n()
  const push = usePush()
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const descriptionId = useId()
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
          <Switch
            className={styles.switch}
            isSelected={status === 'on'}
            isDisabled={busy}
            aria-describedby={descriptionId}
            onChange={toggle}
          >
            {t('push.switch')}
          </Switch>
          <p id={descriptionId} className={styles.description}>
            {t('push.description')}
          </p>
          {status === 'on' && (
            <Button
              variant="ghost"
              size="sm"
              icon={IconSend}
              isDisabled={busy}
              className={styles.test}
              onPress={() => {
                push.test().then(() => toast.show({ tone: 'success', message: t('push.tested') }), failed)
              }}
            >
              {t('push.test')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
