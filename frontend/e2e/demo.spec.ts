import AxeBuilder from '@axe-core/playwright'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { escapeRegExp, expect, expectInstallable, fixture, setPressed, test as base, waitForAnimations } from './support'

// The public demo (playwright.demo.config.ts): the static build with its in-browser API. Besides
// each test's own checks, nothing may go wrong unnoticed: no uncaught error, no console error (the
// demo logs one for any /api request it does not serve) and no HTTP error response.
const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, provide) => {
      const problems: string[] = []
      page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`)
      })
      page.on('response', (response) => {
        if (response.status() >= 400) problems.push(`HTTP ${response.status()} ${response.request().method()} ${response.url()}`)
      })
      await provide(problems)
      expect(problems).toEqual([])
    },
    { auto: true },
  ],
})

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

function timeline(page: Page, childName: string): Locator {
  return page.getByRole('region', { name: `${childName}'s timeline` })
}

function eventLink(page: Page, childName: string, title: string): Locator {
  return timeline(page, childName).getByRole('link', { name: new RegExp(`^${escapeRegExp(title)} · `) })
}

function notifications(page: Page): Locator {
  return page.getByRole('region', { name: 'Notifications' })
}

/** Waits until an <img> has decoded a picture (the demo draws them in the service worker). */
async function expectLoaded(image: Locator): Promise<void> {
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => (element.complete ? element.naturalWidth : 0))).toBeGreaterThan(0)
}

async function expectAccessible(page: Page, testInfo: TestInfo, exclude?: string): Promise<void> {
  await waitForAnimations(page)
  const axe = new AxeBuilder({ page }).withTags(AXE_TAGS)
  const results = await (exclude ? axe.exclude(exclude) : axe).analyze()
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  if (blocking.length > 0) {
    await testInfo.attach('axe-violations.json', { body: JSON.stringify(blocking, null, 2), contentType: 'application/json' })
  }
  expect(blocking.map((violation) => `[${violation.impact}] ${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([])
}

test('opens straight on the first timeline, in English, without signing in @mobile', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/c\/emma$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(notifications(page).getByText(/^Welcome to the Timelife demo/)).toBeVisible()
  // The newest milestone depends on the day: the scenario moves forward with the calendar.
  const newest = timeline(page, 'Emma').getByRole('link').first()
  await expect(newest).toBeVisible()
  await expectLoaded(newest.locator('img'))
  await expectAccessible(page, testInfo)

  // Once per tab: moving around does not welcome the visitor again.
  await page.reload()
  await expect(timeline(page, 'Emma').getByRole('link').first()).toBeVisible()
  await expect(notifications(page).getByText(/^Welcome to the Timelife demo/)).toHaveCount(0)
})

test('can be installed as an app, with its icons @mobile', async ({ page }) => {
  await page.goto('/')
  await expect(timeline(page, 'Emma').getByRole('link').first()).toBeVisible()
  await expectInstallable(page)
})

test('a milestone opens with its photos, also from a deep link @mobile', async ({ page }) => {
  await page.goto('/c/leo?q=first+steps')
  await eventLink(page, 'Leo', 'First steps').click()
  const dialog = page.getByRole('dialog', { name: 'First steps' })
  await expect(dialog.getByText('Four steps to his sister, who celebrated more than anyone.')).toBeVisible()
  await expect(dialog.getByText('Victoria Park')).toBeVisible()
  await expectLoaded(dialog.getByRole('region', { name: /^Photos of/ }).locator('img').first())

  // A reload asks the static host for /c/leo/e/<id>: the SPA fallback serves the app again.
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'First steps' })).toBeVisible()
})

test('shows everyone together, each child on their own line @mobile', async ({ page }, testInfo) => {
  await page.goto('/c/emma')
  await page.getByRole('button', { name: 'Switch child: Emma' }).click()
  await page.getByRole('menuitemradio', { name: /^All together/ }).click()
  await expect(page).toHaveURL(/\/all$/)
  const family = page.getByRole('region', { name: 'Everyone’s timeline' })
  await expect(family.getByRole('link').first()).toBeVisible()
  // Emma's line and Leo's, merging at the milestones they share.
  await expect(family.locator('path[data-lane]')).toHaveCount(2)
  await expectAccessible(page, testInfo)

  await page.goto('/all?q=brother+and+sister')
  await family.getByRole('link', { name: /^Brother and sister meet · .* · Emma and Leo$/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Brother and sister meet' })
  await expect(dialog.getByRole('list', { name: 'Children in this milestone' }).getByRole('img')).toHaveCount(2)
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Brother and sister meet' })).toBeVisible()

  // The next visit opens the family timeline again.
  await page.goto('/')
  await expect(page).toHaveURL(/\/all$/)
})

test('an administrator adds a milestone with a photo, and a reset brings back the sample data', async ({ page }, testInfo) => {
  const title = 'Picnic in the garden'
  await page.goto('/admin/events/new')
  const details = page.getByRole('region', { name: 'Event details' })
  await details.getByRole('textbox', { name: 'Title' }).fill(title)
  // A place the sample milestones already use: it is suggested after a few letters.
  const location = details.getByRole('combobox', { name: 'Location' })
  await location.fill('victoria')
  const suggestions = page.getByRole('listbox', { name: /^Places of other milestones/ })
  await expect(suggestions.getByRole('option').first()).toHaveAccessibleName(/^Victoria Park/)
  await location.press('ArrowDown')
  await location.press('Enter')
  await expect(location).toHaveValue('Victoria Park')
  const children = details.getByRole('group', { name: 'Children' })
  await setPressed(children.getByRole('button', { name: 'Emma', exact: true }), true)
  await setPressed(children.getByRole('button', { name: 'Leo', exact: true }), true)
  await details.getByRole('group', { name: 'Categories' }).getByRole('button', { name: 'Add General' }).click()

  // The photo and the video are processed in the browser (thumbnail, size, colour) and kept in memory.
  const images = page.getByRole('region', { name: 'Photos and videos' })
  const chooser = page.waitForEvent('filechooser')
  await images.getByRole('button', { name: 'Choose photos and videos' }).click()
  await (await chooser).setFiles([fixture('merienda.jpg'), fixture('paseo.webm')])
  const grid = images.getByRole('grid', { name: 'Event photos and videos' })
  await expect(grid.getByRole('row')).toHaveCount(2)
  await expect(images.getByRole('progressbar')).toHaveCount(0)
  await expect(grid.getByRole('row', { name: 'paseo' }).getByText('0:02')).toBeVisible()
  await expectAccessible(page, testInfo)

  await page.getByRole('button', { name: 'Create event' }).click()
  const toast = notifications(page).getByRole('status').filter({ hasText: `“${title}” was created.` })
  await expect(toast).toBeVisible()
  await toast.getByRole('link', { name: 'View on the timeline' }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog.getByText('Victoria Park')).toBeVisible()
  await expectLoaded(dialog.locator('img[alt="merienda"]'))
  await expect(dialog.locator('video[controls][aria-label="paseo"]')).toHaveAttribute('src', /^\/api\/media\/[0-9a-f-]{36}\/video$/)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expectLoaded(eventLink(page, 'Emma', title).locator('img'))

  await page.getByRole('button', { name: /^User menu: / }).click()
  await page.getByRole('button', { name: 'Reset the demo' }).click()
  await expect(page).toHaveURL(/\/c\/emma$/)
  await expect(timeline(page, 'Emma').getByRole('link').first()).toBeVisible()
  await expect(eventLink(page, 'Emma', title)).toHaveCount(0)
})

for (const [path, heading, content] of [
  ['/admin/events', 'Events', /^\d+ events/],
  ['/admin/categories', 'Categories', 'Language & communication'],
  ['/admin/children', 'Children', '2 children'],
  ['/admin/appearance', 'Colours & appearance', 'Year colours'],
  ['/admin/users', 'Users', 'Grandma Rose'],
  ['/admin/trash', 'Trash', 'The trash is empty'],
  ['/admin/backup', 'Import & export', /^\d+ milestones/],
] as const) {
  test(`${path} works with the sample data`, async ({ page }, testInfo) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expect(page.getByText(content).first()).toBeVisible()
    // The users page dims disabled accounts below the contrast minimum (the demo has one); the
    // real-server a11y suite has no disabled account, so this is checked here for the others only.
    await expectAccessible(page, testInfo, path === '/admin/users' ? '[data-disabled="true"]' : undefined)
  })
}
