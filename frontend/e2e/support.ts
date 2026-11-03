import { expect, test as base, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import path from 'node:path'
import type { CategoryOut, ChildOut, TimelineEventOut, TimelineOut } from '../src/api/schema.gen'
import { BASE_URL } from './server'

/**
 * Playwright `test` of the specs: pages start as if the timeline's opening sweep (played once per
 * browser session) had been seen, so timelines open at rest. A test of the sweep itself opts in
 * with `test.use({ openingSweep: true })`.
 */
export const test = base.extend<{ openingSweep: boolean }>({
  openingSweep: [false, { option: true }],
  page: async ({ page, openingSweep }, use) => {
    if (!openingSweep) {
      await page.addInitScript(() => {
        try {
          window.sessionStorage.setItem('timelife.intro', '1')
        } catch {
          // Storage blocked: the app never plays the sweep then.
        }
      })
    }
    await use(page)
  },
})

export { expect }

export type Role = 'admin' | 'viewer'

/** Password of the development sign-in (`LOCAL_LOGIN_PASSWORD` set by scripts/e2e_server.py). */
export const DEV_PASSWORD = 'admin'

/** Sessions saved by auth.setup.ts (git-ignored). */
export function storageStateOf(role: Role): string {
  return path.join(import.meta.dirname, '.auth', `${role}.json`)
}

/** Storage state of a signed-out browser. */
export const ANONYMOUS = { cookies: [], origins: [] }

export function fixture(name: string): string {
  return path.join(import.meta.dirname, 'fixtures', name)
}

/** Short suffix keeping names created by a test unique across retries and reused servers. */
export function uniqueSuffix(testInfo: TestInfo): string {
  return `${Date.now().toString(36).slice(-5)}${testInfo.workerIndex}${testInfo.retry}`
}

/** "1 hito" / "29 hitos" (es `{count} hito(s)` messages). */
export function hitos(count: number): string {
  return `${count} ${count === 1 ? 'hito' : 'hitos'}`
}

export const SPANISH_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

/** `2026-03` → "marzo de 2026" (es `monthYearLong`). */
export function monthPeriod(month: string): string {
  const [year, number] = month.split('-')
  return `${SPANISH_MONTHS[Number(number) - 1]} de ${year}`
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Ordered counts by key (insertion order = first appearance, i.e. newest first for events). */
export function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return counts
}

// ── API ────────────────────────────────────────────────────────────────────────────────────

export async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url)
  expect(response.ok(), `GET ${url} answered ${response.status()}`).toBe(true)
  return (await response.json()) as T
}

/** Headers the API requires on mutations (same-origin check). */
export const MUTATION_HEADERS = { Origin: BASE_URL, 'X-Timelife-Request': '1' }

/** API mutation; retries `503 request_busy` after `Retry-After` like the app does. */
export async function send<T = unknown>(
  request: APIRequestContext,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  data?: unknown,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await request.fetch(url, { method, data, headers: MUTATION_HEADERS })
    if (response.status() === 503 && attempt < 5) {
      const seconds = Number(response.headers()['retry-after'] ?? '1')
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, seconds) * 1000))
      continue
    }
    expect(response.ok(), `${method} ${url} answered ${response.status()}: ${await response.text()}`).toBe(true)
    return (response.status() === 204 ? null : await response.json()) as T
  }
}

export interface TimelineSubject {
  child: ChildOut
  /** The child's live events, newest first. */
  events: TimelineEventOut[]
  categories: CategoryOut[]
}

/** The first child (the one `/` opens) with its events and the categories. */
export async function firstChildTimeline(request: APIRequestContext): Promise<TimelineSubject> {
  const children = await getJson<ChildOut[]>(request, '/api/children')
  expect(children.length, 'demo children').toBeGreaterThan(0)
  return childTimeline(request, children[0])
}

export async function childTimeline(request: APIRequestContext, child: ChildOut): Promise<TimelineSubject> {
  const [timeline, categories] = await Promise.all([
    getJson<TimelineOut>(request, `/api/children/${child.id}/timeline`),
    getJson<CategoryOut[]>(request, '/api/categories'),
  ])
  return { child, events: timeline.events, categories }
}

// ── UI ─────────────────────────────────────────────────────────────────────────────────────

export function timelineRegion(page: Page, childName: string): Locator {
  return page.getByRole('region', { name: `Línea de tiempo de ${childName}` })
}

/** The notifications region (toasts stay reachable while a modal is open). */
export function toasts(page: Page): Locator {
  return page.getByRole('region', { name: 'Notificaciones' })
}

export async function chooseFiles(page: Page, trigger: Locator, files: readonly string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await trigger.click()
  await (await chooser).setFiles(files.map(fixture))
}

/** Toggle button (`aria-pressed`) to the wanted state. */
export async function setPressed(button: Locator, pressed: boolean): Promise<void> {
  if ((await button.getAttribute('aria-pressed')) !== String(pressed)) await button.click()
  await expect(button).toHaveAttribute('aria-pressed', String(pressed))
}

/** Waits until no finite CSS/Web animation is running (Motion uses the Web Animations API). */
export async function waitForAnimations(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity),
  )
}

type Point = readonly [x: number, y: number]

/**
 * One finger on a touch screen (Chromium, through CDP), so that the browser's own scrolling takes
 * part as on a phone: `drag` moves it in ten steps and lifts it unless `lift` is false.
 */
export async function touchscreen(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', [x, y]: Point = [0, 0]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  return {
    async drag([fromX, fromY]: Point, [toX, toY]: Point, { lift = true } = {}): Promise<void> {
      await send('touchStart', [fromX, fromY])
      for (let step = 1; step <= 10; step += 1) {
        await send('touchMove', [fromX + ((toX - fromX) * step) / 10, fromY + ((toY - fromY) * step) / 10])
      }
      if (lift) await send('touchEnd')
    },
    lift: () => send('touchEnd'),
    detach: () => cdp.detach(),
  }
}

/** Language from the header menu (desktop) or the account panel (mobile); each language is named in itself. */
export async function chooseLanguage(page: Page, isMobile: boolean, name: 'Español' | 'English' | 'Português'): Promise<void> {
  if (isMobile) {
    const panel = await openUserMenu(page)
    const option = panel.getByRole('radiogroup', { name: /^(Idioma|Language)$/ }).getByRole('radio', { name })
    await option.click()
    await expect(option).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  } else {
    // The menu is named after its button: "Idioma: Español".
    await page.getByRole('button', { name: /^(Idioma|Language): / }).click()
    await page.getByRole('menu', { name: /^(Idioma|Language): / }).getByRole('menuitemradio', { name }).click()
    await expect(page.getByRole('menu')).toBeHidden()
  }
}

/** Mode («Modo»: light / dark) from the header's theme menu (desktop) or the account panel (mobile). */
export async function chooseTheme(page: Page, isMobile: boolean, label: 'Automático' | 'Claro' | 'Oscuro'): Promise<void> {
  if (isMobile) await chooseInUserMenu(page, 'Modo', label)
  else await chooseInThemeMenu(page, 'Modo', label)
}

/** The colour themes («Tema») by their Spanish names (src/theme/themes.ts ids: sunset … graphite). */
export type PaletteName = 'Atardecer' | 'Océano' | 'Bosque' | 'Lavanda' | 'Grafito'

/** Theme («Tema», a colour palette) from the header's theme menu (desktop) or the account panel's swatches (mobile). */
export async function choosePalette(page: Page, isMobile: boolean, name: PaletteName): Promise<void> {
  if (isMobile) await chooseInUserMenu(page, 'Tema', name)
  else await chooseInThemeMenu(page, 'Tema', name)
}

/** The header's theme menu, open; it is named after its button («Tema: Atardecer · Modo: Automático»). */
export async function openThemeMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^Tema: / }).click()
  const menu = page.getByRole('menu', { name: /^Tema: / })
  await expect(menu).toBeVisible()
  return menu
}

async function chooseInThemeMenu(page: Page, section: 'Tema' | 'Modo', name: string): Promise<void> {
  const menu = await openThemeMenu(page)
  await menu.getByRole('group', { name: section, exact: true }).getByRole('menuitemradio', { name, exact: true }).click()
  await expect(page.getByRole('menu')).toBeHidden()
}

/** A radio of the account panel's «Tema» swatches or «Modo» buttons; the panel is closed again. */
async function chooseInUserMenu(page: Page, group: 'Tema' | 'Modo', name: string): Promise<void> {
  const panel = await openUserMenu(page)
  const option = panel.getByRole('radiogroup', { name: group, exact: true }).getByRole('radio', { name, exact: true })
  await option.click()
  await expect(option).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
}

export async function openUserMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^(Menú de usuario|User menu|Menu do utilizador): / }).click()
  const panel = page.getByRole('dialog', { name: /^(Menú de usuario|User menu|Menu do utilizador)$/ })
  await expect(panel).toBeVisible()
  return panel
}

/**
 * The home-screen app as phones get it: Chromium finds the manifest it reads for Android's
 * "Install app" and parses it without complaints, and the manifest's icons and the one iOS takes
 * for "Add to Home Screen" are served and decode at their declared size.
 */
export async function expectInstallable(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  const manifest = await cdp.send('Page.getAppManifest')
  await cdp.detach()
  expect(manifest.url).toMatch(/\/manifest\.webmanifest$/)
  expect(manifest.errors).toEqual([])
  const appleIcon = page.locator('link[rel="apple-touch-icon"]')
  const icons: { src: string; sizes: string }[] = [
    ...(JSON.parse(manifest.data ?? '{}') as { icons: { src: string; sizes: string }[] }).icons,
    { src: (await appleIcon.getAttribute('href')) ?? '', sizes: (await appleIcon.getAttribute('sizes')) ?? '' },
  ]
  expect(icons).toHaveLength(4)
  for (const { src, sizes } of icons) {
    const decoded = await page.evaluate(async (url) => {
      const image = new Image()
      image.src = url
      await image.decode()
      return `${image.naturalWidth}x${image.naturalHeight}`
    }, src)
    expect(decoded, src).toBe(sizes)
  }
}
