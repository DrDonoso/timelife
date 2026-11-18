import { IconBell } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { isApiError } from '../api/client'
import { MILESTONE_PATH } from '../contexts/CurrentChildContext'
import { useToast } from '../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../i18n'
import { useMemories } from '../memories/MemoriesContext'
import { STORAGE_KEYS, readStorage, writeStorage } from '../utils/storage'
import { useWhatsNewQuiet } from '../whatsNew/WhatsNewLayout'
import { usePush } from './PushContext'
import styles from './PushInvite.module.css'
import { isStandalone } from './support'

/** Pause before the invite, so that it does not arrive together with the page. */
export const INVITE_DELAY_MS = 1500
/** How long the invite stays (it waits while pointed at or focused). */
const INVITE_DURATION_MS = 15_000

/**
 * Once per device, the first time the installed app opens on a timeline without notifications
 * ever asked for: a notice offering to turn the memories' one on («Activar» asks for permission,
 * which Safari only does from a tap). It waits until what's new has nothing more to show and no
 * milestone is open, and gives way to today's memories: when they are being told, it comes another
 * time.
 */
export function PushInvite() {
  const { t } = useI18n()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const { pathname } = useLocation()
  const quiet = useWhatsNewQuiet()
  const push = usePush()
  const { settled, announce } = useMemories()
  // Today's memories were told on this page: the invite waits for another time.
  const [memoriesTold, setMemoriesTold] = useState(false)
  if (announce && !memoriesTold) setMemoriesTold(true)
  const offer = push?.canAsk ? push : null
  const ready =
    offer !== null &&
    quiet &&
    settled &&
    !announce &&
    !memoriesTold &&
    !MILESTONE_PATH.test(pathname) &&
    isStandalone() &&
    readStorage(STORAGE_KEYS.pushInvite) === null

  useEffect(() => {
    if (!ready || !offer) return
    const timer = window.setTimeout(() => {
      writeStorage(STORAGE_KEYS.pushInvite, '1')
      show({
        message: t('push.invite.message'),
        media: (
          <span className={styles.bell}>
            <IconBell size={20} stroke={2} />
          </span>
        ),
        action: {
          label: t('push.invite.action'),
          onPress: () => {
            offer.enable().then(
              (enabled) => {
                if (enabled) show({ tone: 'success', message: t('push.enabled') })
              },
              (error: unknown) => show({ tone: 'error', message: isApiError(error) ? errorMessage(error) : t('push.error') }),
            )
          },
        },
        duration: INVITE_DURATION_MS,
      })
    }, INVITE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [ready, offer, show, t, errorMessage])

  return null
}
