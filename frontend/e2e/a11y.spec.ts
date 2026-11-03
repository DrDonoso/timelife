import AxeBuilder from '@axe-core/playwright'
import { devices, type Page, type TestInfo } from '@playwright/test'
import type { ChildOut, EventOut, TimelineEventOut, UserOut } from '../src/api/schema.gen'
import { DEFAULT_PALETTE, THEME_PALETTES } from '../src/theme/themes'
import { BASE_URL } from './server'
import {
  ANONYMOUS,
  firstChildTimeline,
  getJson,
  openThemeMenu,
  openUserMenu,
  send,
  storageStateOf,
  timelineRegion,
  uniqueSuffix,
  waitForAnimations,
  type TimelineSubject,
  expect,
  test,
} from './support'

// axe-core on every screen, in both modes of the default theme (sunset), and on the key screens
// of the other themes: no serious or critical violation of WCAG 2.2 A/AA (or of axe's best
// practices).
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

// The phone layout (vertical timeline, compact header, filter drawer) in the desktop project's
// Chromium: every Pixel 7 option except the browser type, which can't change inside a file.
const { defaultBrowserType: _browser, ...PHONE } = devices['Pixel 7']

async function expectAccessible(page: Page, testInfo: TestInfo): Promise<void> {
  await waitForAnimations(page)
  // react-aria's off-screen live region is left out: the announcement of a pending button that has
  // just left the page (e.g. "Entrar" while the next form opens) points at it for a few seconds.
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude('[data-live-announcer]').analyze()
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  if (blocking.length > 0) {
    await testInfo.attach('axe-violations.json', { body: JSON.stringify(blocking, null, 2), contentType: 'application/json' })
  }
  const summary = blocking.map(
    (violation) =>
      `[${violation.impact}] ${violation.id}: ${violation.help}\n` +
      violation.nodes
        .slice(0, 5)
        .map((node) => `    ${node.target.join(' ')} — ${node.failureSummary?.replaceAll('\n', ' ')}`)
        .join('\n'),
  )
  expect(summary, `${page.url()}\n${summary.join('\n')}`).toEqual([])
}

/**
 * The timeline with the theme controls open: the header's theme menu, or the account panel on a
 * phone (theme swatches, mode, language).
 */
async function openThemeControls(page: Page, subject: TimelineSubject, phone: boolean): Promise<void> {
  await page.goto(`/c/${subject.child.slug}?zoom=events`)
  await expect(timelineRegion(page, subject.child.name).getByRole('link').first()).toBeVisible()
  if (phone) {
    const panel = await openUserMenu(page)
    await expect(panel.getByRole('radiogroup', { name: 'Tema', exact: true })).toBeVisible()
  } else {
    await openThemeMenu(page)
  }
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    // Stable screens: reduced motion (150 ms cross-fades); the theme follows the system setting.
    test.use({ colorScheme: theme, contextOptions: { reducedMotion: 'reduce' } })

    async function expectTheme(page: Page): Promise<void> {
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    }

    test.describe('signed out', () => {
      test.use({ storageState: ANONYMOUS })

      test('login page', async ({ page }, testInfo) => {
        await page.goto('/login')
        await expect(page.getByRole('form', { name: 'Entrar con tu correo' })).toBeVisible()
        await expectTheme(page)
        await expectAccessible(page, testInfo)
      })

      test('choosing your password at the first sign-in', async ({ page, playwright }, testInfo) => {
        const email = `a11y.${uniqueSuffix(testInfo)}@example.com`
        const admin = await playwright.request.newContext({ baseURL: BASE_URL, storageState: storageStateOf('admin') })
        const created = await send<UserOut>(admin, 'POST', '/api/admin/users', { email, password: 'temporal-a11y' })
        try {
          await page.goto('/login')
          const form = page.getByRole('form', { name: 'Entrar con tu correo' })
          await form.getByRole('textbox', { name: 'Correo electrónico' }).fill(email)
          await form.getByLabel(/^Contraseña\*?$/).fill('temporal-a11y')
          await form.getByRole('button', { name: 'Entrar' }).click()
          await expect(page.getByRole('form', { name: 'Elige tu contraseña' })).toBeVisible()
          await expectTheme(page)
          await expectAccessible(page, testInfo)
        } finally {
          await send(admin, 'DELETE', `/api/admin/users/${created.id}`)
          await admin.dispose()
        }
      })

      for (const [path, form] of [
        ['/reset-password', 'Elige una contraseña nueva'],
        ['/setup', 'Recupera la administración'],
      ] as const) {
        test(`${path} with a link`, async ({ page }, testInfo) => {
          await page.goto(`${path}#${'a'.repeat(64)}`)
          await expect(page.getByRole('form', { name: form })).toBeVisible()
          await expectTheme(page)
          await expectAccessible(page, testInfo)
        })
      }
    })

    for (const phone of [false, true]) {
      test.describe(phone ? 'timeline on a phone' : 'timeline', () => {
        test.use({ storageState: storageStateOf('viewer'), ...(phone ? PHONE : {}) })
        let subject: TimelineSubject

        test.beforeEach(async ({ page }) => {
          subject = await firstChildTimeline(page.request)
        })

        test('events level', async ({ page }, testInfo) => {
          await page.goto(`/c/${subject.child.slug}?zoom=events`)
          await expect(timelineRegion(page, subject.child.name).getByRole('link').first()).toBeVisible()
          await expectTheme(page)
          await expectAccessible(page, testInfo)
        })

        test('years level', async ({ page }, testInfo) => {
          await page.goto(`/c/${subject.child.slug}?zoom=years`)
          await expect(timelineRegion(page, subject.child.name).getByRole('list').getByRole('button').first()).toBeVisible()
          await expectTheme(page)
          await expectAccessible(page, testInfo)
        })

        test('everyone together', async ({ page }, testInfo) => {
          await page.goto('/all?zoom=events')
          await expect(page.getByRole('region', { name: 'Línea de tiempo de todos juntos' }).getByRole('link').first()).toBeVisible()
          await expectTheme(page)
          await expectAccessible(page, testInfo)
        })

        test('filter panel', async ({ page }, testInfo) => {
          const [category] = subject.categories
          await page.goto(`/c/${subject.child.slug}?cat=${category.id}`)
          await page.getByRole('button', { name: /^Filtros/ }).click()
          const panel = page.getByRole('dialog', { name: 'Filtros' })
          await expect(panel.getByRole('button', { name: category.name_es, exact: true })).toHaveAttribute('aria-pressed', 'true')
          await expectTheme(page)
          await expectAccessible(page, testInfo)
        })

        test('event detail', async ({ page }, testInfo) => {
          // The newest event with several photos (carousel arrows, dots and pills).
          const event = subject.events.find((item: TimelineEventOut) => item.image_count > 1) ?? subject.events[0]
          await page.goto(`/c/${subject.child.slug}/e/${event.id}`)
          const dialog = page.getByRole('dialog', { name: event.title })
          await expect(dialog.getByRole('heading', { name: event.title })).toBeVisible()
          await expect(dialog.getByRole('img').first()).toBeVisible()
          await expectTheme(page)
          await expectAccessible(page, testInfo)
        })

        test(phone ? 'account panel with the theme swatches' : 'theme menu', async ({ page }, testInfo) => {
          await openThemeControls(page, subject, phone)
          await expectTheme(page)
          await expectAccessible(page, testInfo)
        })
      })
    }

    test.describe('admin', () => {
      test.use({ storageState: storageStateOf('admin') })

      for (const [name, path, heading] of [
        ['events', '/admin/events', 'Eventos'],
        ['new event editor', '/admin/events/new', 'Nuevo evento'],
        ['categories', '/admin/categories', 'Categorías'],
        ['children', '/admin/children', 'Niños'],
        ['appearance', '/admin/appearance', 'Colores y apariencia'],
        ['users', '/admin/users', 'Usuarios'],
        ['import & export', '/admin/backup', 'Importar y exportar'],
      ] as const) {
        test(`${name} page`, async ({ page }, testInfo) => {
          await page.goto(path)
          await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
          await expect(page.getByText('Cargando', { exact: false })).toHaveCount(0)
          await expectTheme(page)
          await expectAccessible(page, testInfo)
        })
      }

      test('event editor with photos', async ({ page }, testInfo) => {
        const { events } = await firstChildTimeline(page.request)
        const event = events.find((item) => item.image_count > 1) ?? events[0]
        await page.goto(`/admin/events/${event.id}`)
        await expect(page.getByRole('heading', { name: 'Editar evento', level: 1 })).toBeVisible()
        await expect(page.getByRole('grid', { name: 'Fotos y vídeos del evento' }).getByRole('row')).toHaveCount(event.image_count)
        await expectTheme(page)
        await expectAccessible(page, testInfo)
      })

      test('trash page', async ({ page }, testInfo) => {
        // Something in the trash: an event of a demo child other than the first one (whose
        // timeline other suites check), deleted for this test only.
        const children = await getJson<ChildOut[]>(page.request, '/api/children')
        const { categories } = await firstChildTimeline(page.request)
        const title = `Papelera a11y ${uniqueSuffix(testInfo)}`
        const event = await send<EventOut>(page.request, 'POST', '/api/admin/events', {
          title,
          date: '2024-01-15',
          child_ids: [(children[1] ?? children[0]).id],
          category_ids: [categories[0].id],
        })
        await send(page.request, 'DELETE', `/api/admin/events/${event.id}`)
        try {
          await page.goto('/admin/trash')
          await expect(page.getByRole('list', { name: 'Eventos en la papelera' }).getByText(title)).toBeVisible()
          await expectTheme(page)
          await expectAccessible(page, testInfo)
        } finally {
          await send(page.request, 'DELETE', `/api/admin/trash/${event.id}`)
        }
      })
    })
  })
}

// The other themes (colour palettes), in both modes, on the screens where their colours show most:
// the theme is stored on the device before the app starts, as if chosen in an earlier visit.
for (const palette of THEME_PALETTES.filter((id) => id !== DEFAULT_PALETTE)) {
  for (const mode of ['light', 'dark'] as const) {
    test.describe(`${palette} theme, ${mode} mode`, () => {
      test.use({ colorScheme: mode, contextOptions: { reducedMotion: 'reduce' } })

      test.beforeEach(async ({ page }) => {
        await page.addInitScript((id) => {
          try {
            window.localStorage.setItem('timelife.palette', id)
          } catch {
            // Documents without storage (about:blank) have nothing to theme.
          }
        }, palette)
      })

      async function expectPalette(page: Page): Promise<void> {
        await expect(page.locator('html')).toHaveAttribute('data-palette', palette)
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
      }

      test.describe('signed out', () => {
        test.use({ storageState: ANONYMOUS })

        test('login page', async ({ page }, testInfo) => {
          await page.goto('/login')
          await expect(page.getByRole('form', { name: 'Entrar con tu correo' })).toBeVisible()
          await expectPalette(page)
          await expectAccessible(page, testInfo)
        })
      })

      test.describe('timeline', () => {
        test.use({ storageState: storageStateOf('viewer') })
        let subject: TimelineSubject

        test.beforeEach(async ({ page }) => {
          subject = await firstChildTimeline(page.request)
        })

        test('events level', async ({ page }, testInfo) => {
          await page.goto(`/c/${subject.child.slug}?zoom=events`)
          await expect(timelineRegion(page, subject.child.name).getByRole('link').first()).toBeVisible()
          await expectPalette(page)
          await expectAccessible(page, testInfo)
        })

        test('years level', async ({ page }, testInfo) => {
          await page.goto(`/c/${subject.child.slug}?zoom=years`)
          await expect(timelineRegion(page, subject.child.name).getByRole('list').getByRole('button').first()).toBeVisible()
          await expectPalette(page)
          await expectAccessible(page, testInfo)
        })

        test('everyone together', async ({ page }, testInfo) => {
          await page.goto('/all?zoom=events')
          await expect(page.getByRole('region', { name: 'Línea de tiempo de todos juntos' }).getByRole('link').first()).toBeVisible()
          await expectPalette(page)
          await expectAccessible(page, testInfo)
        })

        test('theme menu', async ({ page }, testInfo) => {
          await openThemeControls(page, subject, false)
          await expectPalette(page)
          await expectAccessible(page, testInfo)
        })

        test.describe('on a phone', () => {
          test.use(PHONE)

          test('account panel with the theme swatches', async ({ page }, testInfo) => {
            await openThemeControls(page, subject, true)
            await expectPalette(page)
            await expectAccessible(page, testInfo)
          })
        })
      })

      test.describe('admin', () => {
        test.use({ storageState: storageStateOf('admin') })

        for (const [name, path, heading] of [
          ['appearance', '/admin/appearance', 'Colores y apariencia'],
          ['categories', '/admin/categories', 'Categorías'],
        ] as const) {
          test(`${name} page`, async ({ page }, testInfo) => {
            await page.goto(path)
            await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
            await expect(page.getByText('Cargando', { exact: false })).toHaveCount(0)
            await expectPalette(page)
            await expectAccessible(page, testInfo)
          })
        }
      })
    })
  }
}
