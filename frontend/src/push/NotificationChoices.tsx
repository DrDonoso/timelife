import { useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useId, useRef } from 'react'
import { api } from '../api/client'
import { qk, usePushPreferences } from '../api/queries'
import type { PushPreferencesIn, PushPreferencesOut } from '../api/schema.gen'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { LoadingState } from '../components/Spinner'
import { Switch } from '../components/Switch'
import { useToast } from '../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../i18n'
import styles from './NotificationChoices.module.css'

/** The notifications each person can choose (src/timelife/push.py), in the order shown. */
const KINDS = ['memories', 'milestones'] as const
type Kind = (typeof KINDS)[number]

function Choices() {
  const { t } = useI18n()
  const id = useId()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const preferences = usePushPreferences()
  // Only the answer to the latest change is shown: an earlier one may arrive after it.
  const latest = useRef(0)

  function choose(kind: Kind, on: boolean) {
    const set = (value: boolean) =>
      queryClient.setQueryData<PushPreferencesOut>(qk.pushPreferences, (current) => current && { ...current, [kind]: value })
    set(on)
    const change = ++latest.current
    const body: PushPreferencesIn = { [kind]: on }
    api.patch<PushPreferencesOut>('/api/push/preferences', body).then(
      (saved) => {
        if (change === latest.current) queryClient.setQueryData(qk.pushPreferences, saved)
      },
      (error: unknown) => {
        set(!on)
        show({ tone: 'error', message: errorMessage(error) })
        void queryClient.invalidateQueries({ queryKey: qk.pushPreferences })
      },
    )
  }

  if (preferences.isPending) return <LoadingState className={styles.loading} />
  if (preferences.isError) {
    return (
      <div className={styles.error}>
        <p role="alert">
          <IconAlertTriangle size={18} aria-hidden="true" />
          {t('push.choices.error')}
        </p>
        <Button size="sm" onPress={() => void preferences.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  return (
    <>
      <p className={styles.intro}>{t('push.choices.intro')}</p>
      <ul role="list" className={styles.choices}>
        {KINDS.map((kind) => (
          <li key={kind} className={styles.choice}>
            <Switch
              className={styles.switch}
              isSelected={preferences.data[kind]}
              aria-describedby={`${id}-${kind}`}
              onChange={(on) => choose(kind, on)}
            >
              {t(`push.choices.${kind}.label`)}
            </Switch>
            <p id={`${id}-${kind}`} className={styles.description}>
              {t(`push.choices.${kind}.description`)}
            </p>
          </li>
        ))}
      </ul>
    </>
  )
}

export interface NotificationChoicesProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

/**
 * «Elegir notificaciones»: which notifications reach the person's devices (all of those with them
 * on), each saved as soon as it is switched.
 */
export function NotificationChoices({ isOpen, onOpenChange }: NotificationChoicesProps) {
  const { t } = useI18n()
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={t('push.choose')}
      size="sm"
      footer={
        <Button variant="primary" onPress={() => onOpenChange(false)}>
          {t('push.choices.done')}
        </Button>
      }
    >
      <Choices />
    </Modal>
  )
}
