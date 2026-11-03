// Renders the screenshots of README.md and docs/ from the static demo, so they only ever show its
// made-up sample data: `npm run gen:screenshots` builds the demo, serves dist-demo/ with Vite's
// preview server and captures each view with Playwright's Chromium into ../docs/images/ (plus
// themes.png, the family timeline on a phone in every colour theme).
//
// Run it after visible interface changes and commit the PNGs. Uses Playwright's Chromium
// (`npx playwright install chromium` once).

import { chromium } from '@playwright/test'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = resolve(FRONTEND, '../docs/images')

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Id of a milestone, found through the timeline's search (`?q=`) and its detail card. */
async function milestoneId(page, timeline, title) {
  await page.goto(`${timeline}?q=${encodeURIComponent(title)}`)
  await page.getByRole('link', { name: new RegExp(`^${escapeRegExp(title)} · `) }).first().click()
  await page.getByRole('dialog', { name: title }).waitFor()
  return /\/e\/(\d+)/.exec(new URL(page.url()).pathname)[1]
}

/** A milestone's card over its whole (unfiltered) timeline. */
async function openMilestone(page, timeline, title) {
  const id = await milestoneId(page, timeline, title)
  await page.goto(`${timeline}/e/${id}`)
  await page.getByRole('dialog', { name: title }).waitFor()
}

const SHOTS = [
  { file: 'timeline.png', device: DESKTOP, mode: 'light', show: (page) => page.goto('/c/emma?zoom=events') },
  { file: 'family.png', device: DESKTOP, mode: 'dark', show: (page) => page.goto('/all?zoom=events') },
  { file: 'months.png', device: DESKTOP, mode: 'light', show: (page) => page.goto('/all?zoom=months') },
  { file: 'event.png', device: DESKTOP, mode: 'light', show: (page) => openMilestone(page, '/all', 'Christmas together') },
  {
    file: 'editor.png',
    device: DESKTOP,
    mode: 'light',
    show: async (page) => page.goto(`/admin/events/${await milestoneId(page, '/c/emma', 'First birthday!')}`),
  },
  { file: 'phone-timeline.png', device: PHONE, mode: 'light', show: (page) => page.goto('/c/emma?zoom=events') },
  { file: 'phone-event.png', device: PHONE, mode: 'dark', show: (page) => openMilestone(page, '/all', 'Christmas together') },
]

/** The family timeline on a phone in each colour theme, side by side (themes.png). */
const PALETTES = [
  ['sunset', 'Sunset'],
  ['ocean', 'Ocean'],
  ['forest', 'Forest'],
  ['lavender', 'Lavender'],
  ['graphite', 'Graphite'],
]
const THEME_PHONE = { ...PHONE, deviceScaleFactor: 1 }

/** Waits until the visible pictures are decoded and nothing moves any more. */
async function settle(page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() =>
    [...document.images]
      .filter((image) => {
        const box = image.getBoundingClientRect()
        return box.width > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth
      })
      .every((image) => image.complete && image.naturalWidth > 0),
  )
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity),
  )
}

const server = await preview({ root: FRONTEND, mode: 'demo', logLevel: 'warn', preview: { port: 4190, open: false } })
const baseURL = server.resolvedUrls.local[0]
const browser = await chromium.launch()

/** A page of the demo in a fresh browser context: English, `palette` in `mode`, no welcome toast and no opening sweep. */
async function demoPage(device, mode, palette = 'sunset') {
  const context = await browser.newContext({
    ...device,
    baseURL,
    colorScheme: mode,
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  // Runs before any page script.
  await context.addInitScript(
    ([theme, chosenPalette]) => {
      localStorage.setItem('timelife.lang', 'en')
      localStorage.setItem('timelife.theme', theme)
      localStorage.setItem('timelife.palette', chosenPalette)
      sessionStorage.setItem('timelife.demo.welcomed', '1')
      sessionStorage.setItem('timelife.intro', '1')
    },
    [mode, palette],
  )
  return context.newPage()
}

async function report(file) {
  console.log(`docs/images/${file}  ${Math.round((await stat(resolve(OUTPUT, file))).size / 1024)} KB`)
}

try {
  await mkdir(OUTPUT, { recursive: true })
  for (const { file, device, mode, show } of SHOTS) {
    const page = await demoPage(device, mode)
    await show(page)
    await settle(page)
    await page.screenshot({ path: resolve(OUTPUT, file) })
    await page.context().close()
    await report(file)
  }

  const phones = []
  for (const [palette, name] of PALETTES) {
    const page = await demoPage(THEME_PHONE, 'light', palette)
    await page.goto('/all?zoom=events')
    await settle(page)
    phones.push({ name, png: (await page.screenshot()).toString('base64') })
    await page.context().close()
  }
  const { width, height } = THEME_PHONE.viewport
  const [padding, gap] = [32, 28]
  const strip = await browser.newPage({
    viewport: { width: 2 * padding + phones.length * width + (phones.length - 1) * gap, height: 100 },
    deviceScaleFactor: 1,
  })
  await strip.setContent(
    `<body style="margin: 0; padding: ${padding}px; display: flex; gap: ${gap}px">` +
      phones
        .map(
          ({ name, png }) =>
            `<figure style="margin: 0; display: flex; flex-direction: column; align-items: center; gap: 14px">` +
            `<img src="data:image/png;base64,${png}" alt="" style="width: ${width}px; height: ${height}px; ` +
            `border-radius: 28px; box-shadow: 0 6px 24px rgb(0 0 0 / 0.22)">` +
            `<figcaption style="font: 600 24px system-ui, sans-serif; color: #8a8a8a">${name}</figcaption></figure>`,
        )
        .join('') +
      `</body>`,
  )
  await strip.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
  await strip.screenshot({ path: resolve(OUTPUT, 'themes.png'), fullPage: true, omitBackground: true })
  await strip.close()
  await report('themes.png')
} finally {
  await browser.close()
  await server.close()
}
