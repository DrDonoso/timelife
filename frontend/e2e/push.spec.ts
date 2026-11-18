import { expect, openUserMenu, storageStateOf, test, toasts, uniqueSuffix } from './support'

// The notifications of a device, through the real server: service worker, account panel and
// registration. Chromium in tests has neither notifications nor a push service, so the permission
// (not asked yet, granted when asked) and the browser's subscription (an address of a known push
// service and real keys) are stand-ins, kept across reloads; the server never sends it anything
// here (the development users start with today's memories seen).
test.use({ storageState: storageStateOf('viewer') })

// RFC 8291's example keys of a browser.
const P256DH = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg'
const SWITCH = 'Avisarme de los recuerdos'

test('turns the notifications of this device on, keeps them registered and turns them off', async ({ page }, testInfo) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${uniqueSuffix(testInfo)}`
  await page.addInitScript(
    ({ endpoint, p256dh, auth }) => {
      const PERMISSION = 'e2e.notificationPermission'
      const STORE = 'e2e.pushSubscription'
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => localStorage.getItem(PERMISSION) ?? 'default',
      })
      Notification.requestPermission = async () => {
        localStorage.setItem(PERMISSION, 'granted')
        return 'granted'
      }
      const subscriptionOf = (key: ArrayBuffer) =>
        ({
          endpoint,
          expirationTime: null,
          options: { applicationServerKey: key, userVisibleOnly: true },
          toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
          unsubscribe: async () => {
            localStorage.removeItem(STORE)
            return true
          },
        }) as unknown as PushSubscription
      const stored = () => {
        const key = localStorage.getItem(STORE)
        return key ? subscriptionOf(Uint8Array.from(atob(key), (character) => character.charCodeAt(0)).buffer) : null
      }
      PushManager.prototype.getSubscription = async () => stored()
      PushManager.prototype.subscribe = async (options?: PushSubscriptionOptionsInit) => {
        const key = new Uint8Array(options?.applicationServerKey as ArrayBuffer)
        localStorage.setItem(STORE, btoa(String.fromCharCode(...key)))
        return stored() as PushSubscription
      }
    },
    { endpoint, p256dh: P256DH, auth: AUTH },
  )
  const registration = () =>
    page.waitForResponse((response) => response.url().endsWith('/api/push/subscription') && response.request().method() === 'PUT')

  await page.goto('/')
  let panel = await openUserMenu(page)
  const registered = registration()
  // Its label, as a finger does (the switch's own checkbox is visually hidden).
  await panel.getByText(SWITCH, { exact: true }).click()
  const response = await registered
  expect(response.status()).toBe(204)
  expect(response.request().postDataJSON()).toEqual({
    endpoint,
    keys: { p256dh: P256DH, auth: AUTH },
    locale: 'es',
    time_zone: 'Europe/Madrid',
  })
  await expect(toasts(page).getByText('Listo: te avisaremos a las 9:00 los días con recuerdos.')).toBeVisible()
  await expect(panel.getByRole('switch', { name: SWITCH })).toBeChecked()
  const worker = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)
  expect(worker).toMatch(/\/sw\.js$/)

  // Each opening registers the device again (its language, time zone and session stay current).
  const again = registration()
  await page.reload()
  expect((await again).status()).toBe(204)
  panel = await openUserMenu(page)
  await expect(panel.getByRole('switch', { name: SWITCH })).toBeChecked()

  const removed = page.waitForResponse((response) => response.url().endsWith('/api/push/unsubscribe'))
  await panel.getByText(SWITCH, { exact: true }).click()
  expect((await removed).status()).toBe(204)
  await expect(panel.getByRole('switch', { name: SWITCH })).not.toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('e2e.pushSubscription'))).toBeNull()
})
