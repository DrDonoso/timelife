import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, isApiError } from '../api/client'
import type { PushConfigOut, PushSubscriptionIn } from '../api/schema.gen'
import { useAuth } from '../contexts/AuthContext'
import { IS_DEMO } from '../demo/config'
import { useI18n, type Lang } from '../i18n'
import { STORAGE_KEYS, readStorage, writeStorage } from '../utils/storage'
import { base64UrlBytes, isAppleMobile, isStandalone, pushSupported, subscribedWith } from './support'

/**
 * Notifications on this device: `unsupported` (not in this browser) · `install` (an iPhone or
 * iPad in Safari: only the app added to the Home Screen gets them) · `denied` (blocked in the
 * settings) · `off` · `on`.
 */
export type PushStatus = 'unsupported' | 'install' | 'denied' | 'off' | 'on'

export interface PushValue {
  status: PushStatus
  /** Never asked on this device: the app may invite its person to turn them on. */
  canAsk: boolean
  /** Turning them on or off. */
  busy: boolean
  /** Asks for permission (call it from a tap: Safari only asks then) and registers this device; whether they are on. */
  enable: () => Promise<boolean>
  disable: () => Promise<void>
}

export const SERVICE_WORKER = '/sw.js'

const PushContext = createContext<PushValue | null>(null)

function timeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

function subscriptionBody(subscription: PushSubscription, lang: Lang): PushSubscriptionIn {
  const keys = subscription.toJSON().keys ?? {}
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' },
    locale: lang,
    time_zone: timeZone(),
  }
}

/** Whether `userId` turned them on in this browser (the browser keeps the subscription itself). */
function enabledFor(userId: number | null): boolean {
  return userId !== null && readStorage(STORAGE_KEYS.push) === String(userId)
}

function initialStatus(userId: number | null): PushStatus {
  if (!pushSupported()) return !IS_DEMO && isAppleMobile() && !isStandalone() ? 'install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.permission === 'granted' && enabledFor(userId) ? 'on' : 'off'
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) ?? null
}

type ServerKey = () => Promise<Uint8Array<ArrayBuffer>>

/** Drops a subscription made with an older key of the server, there and in the browser. */
async function forget(subscription: PushSubscription): Promise<void> {
  await api.post('/api/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => undefined)
  await subscription.unsubscribe()
}

/** Asks for permission and subscribes this browser with the server's key; the permission when not granted. */
async function subscribeDevice(serverKey: ServerKey): Promise<PushSubscription | NotificationPermission> {
  // First, while the tap is being handled: Safari only asks for permission then.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission
  await navigator.serviceWorker.register(SERVICE_WORKER)
  const [registration, key] = await Promise.all([navigator.serviceWorker.ready, serverKey()])
  const existing = await registration.pushManager.getSubscription()
  if (existing && subscribedWith(existing, key)) return existing
  if (existing) await forget(existing)
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

async function unsubscribeDevice(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  await api.post('/api/push/unsubscribe', { endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}

/**
 * The notifications of the signed-in person on this device (src/timelife/push.py): turned on
 * from the account panel or the first-run invite, and registered again each time the app opens
 * (and when the language changes), so the server keeps the device's language and time zone, its
 * session, and a subscription made with its current key.
 */
export function PushProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { lang } = useI18n()
  const userId = user?.id ?? null
  const [status, setStatus] = useState<PushStatus>(() => initialStatus(userId))
  const [busy, setBusy] = useState(false)
  const key = useRef<Promise<Uint8Array<ArrayBuffer>> | null>(null)

  const serverKey = useCallback(() => {
    if (!key.current) {
      const request = api.get<PushConfigOut>('/api/push').then(({ public_key }) => base64UrlBytes(public_key))
      // A failed request is tried again the next time.
      request.catch(() => {
        if (key.current === request) key.current = null
      })
      key.current = request
    }
    return key.current
  }, [])

  useEffect(() => {
    if (userId === null || !pushSupported()) return
    let cancelled = false
    const settle = (next: PushStatus) => {
      if (!cancelled) setStatus(next)
    }
    async function refresh() {
      if (Notification.permission !== 'granted' || !enabledFor(userId)) {
        settle(Notification.permission === 'denied' ? 'denied' : 'off')
        return
      }
      const registration = await navigator.serviceWorker.register(SERVICE_WORKER)
      let subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const current = await serverKey()
        if (!subscribedWith(subscription, current)) {
          // The server's key changed (a new AUTH_SECRET): the old subscription no longer works.
          await forget(subscription)
          const ready = await navigator.serviceWorker.ready
          subscription = await ready.pushManager
            .subscribe({ userVisibleOnly: true, applicationServerKey: current })
            .catch(() => null)
        }
      }
      if (!subscription) {
        writeStorage(STORAGE_KEYS.push, null)
        settle('off')
        return
      }
      settle('on')
      await api.put('/api/push/subscription', subscriptionBody(subscription, lang))
    }
    refresh().catch((error: unknown) => {
      // Offline, or the server is unreachable: nothing changes, the next opening tries again.
      if (isApiError(error, 'push_service_unsupported')) {
        writeStorage(STORAGE_KEYS.push, null)
        settle('off')
      }
    })
    return () => {
      cancelled = true
    }
  }, [userId, lang, serverKey])

  const enable = useCallback((): Promise<boolean> => {
    if (userId === null || !pushSupported()) return Promise.resolve(false)
    setBusy(true)
    return subscribeDevice(serverKey)
      .then(async (subscription) => {
        if (typeof subscription === 'string') {
          setStatus(subscription === 'denied' ? 'denied' : 'off')
          return false
        }
        await api.put('/api/push/subscription', subscriptionBody(subscription, lang))
        writeStorage(STORAGE_KEYS.push, String(userId))
        setStatus('on')
        return true
      })
      .finally(() => setBusy(false))
  }, [userId, lang, serverKey])

  const disable = useCallback((): Promise<void> => {
    if (!pushSupported()) return Promise.resolve()
    setBusy(true)
    return unsubscribeDevice()
      .then(() => {
        writeStorage(STORAGE_KEYS.push, null)
        setStatus('off')
      })
      .finally(() => setBusy(false))
  }, [])

  const canAsk = status === 'off' && pushSupported() && Notification.permission === 'default'
  const value = useMemo<PushValue>(
    () => ({ status, canAsk, busy, enable, disable }),
    [status, canAsk, busy, enable, disable],
  )
  return <PushContext value={value}>{children}</PushContext>
}

/** The notifications of this device; null outside {@link PushProvider} (signed out). */
export function usePush(): PushValue | null {
  return use(PushContext)
}
