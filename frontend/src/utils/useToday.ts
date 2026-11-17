import { useEffect, useState } from 'react'
import { todayISO } from './dates'

/**
 * Today on the device's calendar (`YYYY-MM-DD`), which changes at midnight while the page stays
 * open. Also checked again when the page comes back to the foreground: a sleeping tab may miss
 * its timer.
 */
export function useToday(): string {
  const [today, setToday] = useState(todayISO)

  useEffect(() => {
    const update = () => setToday(todayISO())
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const timer = window.setTimeout(update, midnight.getTime() - now.getTime() + 500)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }, [today])

  return today
}
