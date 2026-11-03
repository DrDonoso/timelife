import { useEffect } from 'react'
import { useToast } from '../contexts/ToastContext'
import { useI18n } from '../i18n'

const WELCOMED_KEY = 'timelife.demo.welcomed'

function welcomed(): boolean {
  try {
    if (window.sessionStorage.getItem(WELCOMED_KEY)) return true
    window.sessionStorage.setItem(WELCOMED_KEY, '1')
  } catch {
    // Storage blocked: welcome every time.
  }
  return false
}

/**
 * Demo only: a single welcome toast per browser tab, saying the data is made up and changes do
 * not last. The demo has no sign-in screen to say it, and a permanent banner would cover the app.
 */
export function DemoWelcome() {
  const { t } = useI18n()
  const toast = useToast()
  useEffect(() => {
    if (!welcomed()) toast.show({ tone: 'info', message: t('demo.welcome'), duration: 15_000 })
  }, [toast, t])
  return null
}
