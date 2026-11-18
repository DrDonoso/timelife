import { PUSH_KEYS, expect, openUserMenu, standInPush, storageStateOf, test, toasts, uniqueSuffix } from './support'

// The notifications of a device, through the real server: service worker, account panel,
// registration and the choice of which ones arrive. Chromium in tests has neither notifications
// nor a push service, so the permission and the browser's subscription are stand-ins (see
// standInPush); the server never sends anything (it answers in place of the push services).
test.use({ storageState: storageStateOf('viewer') })

const SWITCH = 'Activar notificaciones'
const CHOOSE = 'Elegir notificaciones'
const MILESTONES = 'Hitos nuevos'

test('turns the notifications of this device on, chooses which ones arrive and turns them off', async ({ page }, testInfo) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${uniqueSuffix(testInfo)}`
  await standInPush(page, endpoint)
  const registration = () =>
    page.waitForResponse((response) => response.url().endsWith('/api/push/subscription') && response.request().method() === 'PUT')
  const choice = () =>
    page.waitForResponse((response) => response.url().endsWith('/api/push/preferences') && response.request().method() === 'PATCH')

  await page.goto('/')
  let panel = await openUserMenu(page)
  await expect(panel.getByRole('button', { name: CHOOSE })).toHaveCount(0)
  const registered = registration()
  // Its label, as a finger does (the switch's own checkbox is visually hidden).
  await panel.getByText(SWITCH, { exact: true }).click()
  const response = await registered
  expect(response.status()).toBe(204)
  expect(response.request().postDataJSON()).toEqual({ endpoint, keys: PUSH_KEYS, locale: 'es', time_zone: 'Europe/Madrid' })
  await expect(toasts(page).getByText('Listo: las notificaciones están activadas en este dispositivo.')).toBeVisible()
  await expect(panel.getByRole('switch', { name: SWITCH })).toBeChecked()
  const worker = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)
  expect(worker).toMatch(/\/sw\.js$/)

  // Which ones arrive, for every device of Vera's: the account panel gives way to the window.
  await panel.getByRole('button', { name: CHOOSE }).click()
  let choices = page.getByRole('dialog', { name: CHOOSE })
  await expect(panel).toBeHidden()
  await expect(choices.getByRole('switch', { name: 'Recuerdos del día' })).toBeChecked()
  await expect(choices.getByRole('switch', { name: MILESTONES })).toBeChecked()
  let saved = choice()
  await choices.getByText(MILESTONES, { exact: true }).click()
  expect((await saved).request().postDataJSON()).toEqual({ milestones: false })
  expect(await (await saved).json()).toEqual({ memories: true, milestones: false })
  await expect(choices.getByRole('switch', { name: MILESTONES })).not.toBeChecked()
  await choices.getByRole('button', { name: 'Listo' }).click()
  await expect(choices).toBeHidden()

  // Each opening registers the device again (its language, time zone and session stay current),
  // and the choice is kept.
  const again = registration()
  await page.reload()
  expect((await again).status()).toBe(204)
  panel = await openUserMenu(page)
  await expect(panel.getByRole('switch', { name: SWITCH })).toBeChecked()
  await panel.getByRole('button', { name: CHOOSE }).click()
  choices = page.getByRole('dialog', { name: CHOOSE })
  await expect(choices.getByRole('switch', { name: MILESTONES })).not.toBeChecked()
  saved = choice()
  await choices.getByText(MILESTONES, { exact: true }).click()
  expect((await saved).request().postDataJSON()).toEqual({ milestones: true })
  await expect(choices.getByRole('switch', { name: MILESTONES })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(choices).toBeHidden()

  panel = await openUserMenu(page)
  const removed = page.waitForResponse((response) => response.url().endsWith('/api/push/unsubscribe'))
  await panel.getByText(SWITCH, { exact: true }).click()
  expect((await removed).status()).toBe(204)
  await expect(panel.getByRole('switch', { name: SWITCH })).not.toBeChecked()
  await expect(panel.getByRole('button', { name: CHOOSE })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('e2e.pushSubscription'))).toBeNull()
})
