import type { Locator, Page } from '@playwright/test'
import type { ChildOut, TimelineEventOut, TimelineOut } from '../src/api/schema.gen'
import { THEMES } from '../src/theme/themes'
import {
  SPANISH_MONTHS,
  chooseLanguage,
  choosePalette,
  chooseTheme,
  countBy,
  escapeRegExp,
  firstChildTimeline,
  getJson,
  hitos,
  monthPeriod,
  storageStateOf,
  timelineRegion,
  touchscreen,
  waitForAnimations,
  type TimelineSubject,
  expect,
  test,
} from './support'

// Read-only checks of the first child's timeline (demo data), on desktop (horizontal line) and on
// a phone (vertical line). Expected values come from the API, not from hard-coded demo content.
test.use({ storageState: storageStateOf('viewer') })

const yearOf = (event: TimelineEventOut) => event.date.slice(0, 4)
const monthOf = (event: TimelineEventOut) => event.date.slice(0, 7)

function searchParam(page: Page, name: string): string | null {
  return new URL(page.url()).searchParams.get(name)
}

async function expectView(page: Page, zoom: string, focus?: string): Promise<void> {
  await expect.poll(() => searchParam(page, 'zoom')).toBe(zoom)
  if (focus !== undefined) await expect.poll(() => searchParam(page, 'focus')).toBe(focus)
}

/** Year (`2026`) or month (`2026-03`) of a hub from its accessible name, with its count. */
function parseHub(label: string): [string, number] {
  const match = /^(?:(\p{L}+) de )?(\d{4}) · (\d+) hitos?$/u.exec(label)
  if (!match) throw new Error(`Unexpected hub label: ${label}`)
  const [, monthName, year, count] = match
  const key = monthName
    ? `${year}-${String(SPANISH_MONTHS.indexOf(monthName as (typeof SPANISH_MONTHS)[number]) + 1).padStart(2, '0')}`
    : year
  return [key, Number(count)]
}

/** Every rendered hub shows the number of (filtered) events of its period, also in its badge. */
async function expectHubCounts(region: Locator, expected: Map<string, number>): Promise<void> {
  const hubs = region.getByRole('list').getByRole('button')
  await expect(hubs.first()).toBeVisible()
  await expect(async () => {
    const labels = await hubs.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''))
    expect(labels.length).toBeGreaterThan(0)
    const shown = new Map(labels.map(parseHub))
    for (const [key, count] of shown) expect(count, `hub ${key}`).toBe(expected.get(key))
  }).toPass()
  const [key, count] = parseHub((await hubs.first().getAttribute('aria-label')) ?? '')
  expect(count).toBe(expected.get(key))
  // The count badge next to the number (the last match: the badge follows the number).
  await expect(hubs.first().getByText(String(count), { exact: true }).last()).toBeVisible()
}

async function openFilters(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^Filtros/ }).click()
  const panel = page.getByRole('dialog', { name: 'Filtros' })
  await expect(panel).toBeVisible()
  return panel
}

let subject: TimelineSubject

test.beforeEach(async ({ page }) => {
  subject = await firstChildTimeline(page.request)
  expect(subject.events.length, 'demo events of the first child').toBeGreaterThan(5)
})

test('events go newest first along the line', async ({ page, isMobile }) => {
  const { child, events } = subject
  await page.goto(`/c/${child.slug}?zoom=events`)
  const region = timelineRegion(page, child.name)
  await expect(region).toHaveAttribute('data-orientation', isMobile ? 'vertical' : 'horizontal')
  await expect(region.getByRole('list', { name: hitos(events.length) })).toBeVisible()

  const order = new Map(events.map((event, index) => [`e${event.id}`, index]))
  await expect(async () => {
    const nodes = await region.locator('a[data-node-key]').evaluateAll((links) =>
      links.map((link) => {
        const box = (link.querySelector('[data-circle]') ?? link).getBoundingClientRect()
        return { key: link.getAttribute('data-node-key') ?? '', x: box.x + box.width / 2, y: box.y + box.height / 2 }
      }),
    )
    expect(nodes.length).toBeGreaterThanOrEqual(3)
    const placed = nodes
      .map((node) => ({ ...node, index: order.get(node.key) ?? -1 }))
      .toSorted((a, b) => a.index - b.index)
    expect(placed[0].index, 'the newest event is rendered').toBe(0)
    for (const [position, node] of placed.entries()) {
      expect(node.index, `${node.key} belongs to the timeline`).toBeGreaterThanOrEqual(0)
      if (position === 0) continue
      const previous = placed[position - 1]
      // Older events further right (desktop) or further down (phone), on the same straight line
      // (once the entrance animation has settled).
      if (isMobile) {
        expect(node.y).toBeGreaterThan(previous.y + 40)
        expect(Math.abs(node.x - previous.x)).toBeLessThan(3)
      } else {
        expect(node.x).toBeGreaterThan(previous.x + 40)
        expect(Math.abs(node.y - previous.y)).toBeLessThan(3)
      }
    }
  }).toPass()

  const newest = events[0]
  const link = region.getByRole('link', { name: new RegExp(`^${escapeRegExp(newest.title)} · `) })
  await expect(link).toBeInViewport()
  await expect(link).toHaveAttribute('href', new RegExp(`^/c/${child.slug}/e/${newest.id}(\\?|$)`))
  // The title pill sits above the circle.
  const label = link.getByTitle(newest.title)
  await expect(label).toBeVisible()
  const [labelBox, circleBox] = await Promise.all([label.boundingBox(), link.locator('[data-circle]').boundingBox()])
  expect(labelBox && circleBox && labelBox.y + labelBox.height <= circleBox.y + 4).toBe(true)

  // Clicking a circle opens its detail card; the browser's Back button closes it.
  await link.click()
  const dialog = page.getByRole('dialog', { name: newest.title })
  await expect(dialog.getByRole('heading', { name: newest.title })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/c/${child.slug}/e/${newest.id}(\\?|$)`))
  await page.goBack()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/c/${child.slug}(\\?|$)`))
})

test.describe('opening sweep', () => {
  test.use({ openingSweep: true })

  test('runs once per session from the oldest milestone to the newest, where it rests', async ({ page }) => {
    const { child, events } = subject
    await page.goto(`/c/${child.slug}?zoom=events`)
    const region = timelineRegion(page, child.name)
    await expect(region).toHaveAttribute('data-sweeping', '')
    // It starts at the oldest end…
    await expect(region.locator(`a[data-node-key="e${events.at(-1)?.id}"]`)).toBeInViewport()
    // …and ends on the newest milestone, which takes the keyboard focus stop.
    await expect(region).not.toHaveAttribute('data-sweeping', { timeout: 15_000 })
    const newest = region.locator(`a[data-node-key="e${events[0].id}"]`)
    await expect(newest).toBeInViewport()
    await expect(newest).toHaveAttribute('tabindex', '0')

    // Once per session: a reload (or another child) opens at rest.
    await page.reload()
    await expect(region.locator(`a[data-node-key="e${events[0].id}"]`)).toBeInViewport()
    await expect(region).not.toHaveAttribute('data-sweeping')
  })
})

test('the keyboard moves along the line and opens an event', async ({ page, isMobile }) => {
  const { child, events } = subject
  await page.goto(`/c/${child.slug}?zoom=events`)
  const region = timelineRegion(page, child.name)
  const newest = region.locator(`a[data-node-key="e${events[0].id}"]`)
  // Roving tabindex: only one node of the line is in the tab order.
  await expect(newest).toHaveAttribute('tabindex', '0')
  await expect(region.locator('a[data-node-key][tabindex="0"]')).toHaveCount(1)
  await newest.focus()

  const focused = page.locator(':focus')
  await page.keyboard.press(isMobile ? 'ArrowDown' : 'ArrowRight')
  await expect(focused).toHaveAttribute('data-node-key', `e${events[1].id}`)
  await page.keyboard.press(isMobile ? 'ArrowDown' : 'ArrowRight')
  await expect(focused).toHaveAttribute('data-node-key', `e${events[2].id}`)
  await page.keyboard.press(isMobile ? 'ArrowUp' : 'ArrowLeft')
  await expect(focused).toHaveAttribute('data-node-key', `e${events[1].id}`)
  await expect(focused).toHaveAttribute('tabindex', '0')

  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: events[1].title })
  await expect(dialog.getByRole('heading', { name: events[1].title })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/c/${child.slug}(\\?|$)`))
})

test('zooms out and in with the controls and the keyboard', async ({ page }) => {
  const { child, events } = subject
  const months = countBy(events, monthOf)
  const years = countBy(events, yearOf)
  await page.goto(`/c/${child.slug}?zoom=events`)
  const region = timelineRegion(page, child.name)
  const zoom = region.getByRole('group', { name: 'Zoom de la línea de tiempo' })
  const level = zoom.getByRole('radiogroup', { name: 'Nivel de detalle' })
  await expect(level.getByRole('radio', { name: 'Días' })).toBeChecked()
  await expect(zoom.getByRole('button', { name: 'Acercar' })).toBeDisabled()

  await zoom.getByRole('button', { name: 'Alejar' }).click()
  await expectView(page, 'months')
  await expect(level.getByRole('radio', { name: 'Meses' })).toBeChecked()
  await expect(region.getByRole('list', { name: `Meses con hitos: ${months.size} meses` })).toBeVisible()
  await expectHubCounts(region, months)

  await page.keyboard.press('-')
  await expectView(page, 'years')
  await expect(level.getByRole('radio', { name: 'Años' })).toBeChecked()
  await expect(region.getByRole('list', { name: `Años con hitos: ${years.size} años` })).toBeVisible()
  await expect(region.getByRole('list').getByRole('button')).toHaveCount(years.size)
  await expectHubCounts(region, years)
  await expect(zoom.getByRole('button', { name: 'Alejar' })).toBeDisabled()

  await page.keyboard.press('+')
  await expectView(page, 'months')
  await page.keyboard.press('=')
  await expectView(page, 'events')
  await expect(region.getByRole('list', { name: hitos(events.length) })).toBeVisible()

  await level.getByRole('radio', { name: 'Años' }).click()
  await expectView(page, 'years')
  await zoom.getByRole('button', { name: 'Acercar' }).click()
  await expectView(page, 'months')
  await expect(level.getByRole('radio', { name: 'Meses' })).toBeChecked()
})

test('a year hub drills into its months, a month hub into its events', async ({ page }) => {
  const { child, events } = subject
  const years = [...countBy(events, yearOf)]
  // An older year than the one in view, so the line has to move to it.
  const [year, yearCount] = years[1] ?? years[0]
  const inYear = events.filter((event) => yearOf(event) === year)
  const month = monthOf(inYear[0])
  const monthCount = inYear.filter((event) => monthOf(event) === month).length

  await page.goto(`/c/${child.slug}?zoom=years`)
  const region = timelineRegion(page, child.name)
  await region.getByRole('button', { name: `${year} · ${hitos(yearCount)}`, exact: true }).click()
  await expectView(page, 'months', `m${month}`)
  const monthHub = region.getByRole('button', { name: `${monthPeriod(month)} · ${hitos(monthCount)}`, exact: true })
  await expect(monthHub).toBeInViewport()
  await expectHubCounts(region, countBy(events, monthOf))

  await monthHub.click()
  await expectView(page, 'events', `e${inYear[0].id}`)
  const newestOfMonth = region.getByRole('link', { name: new RegExp(`^${escapeRegExp(inYear[0].title)} · `) })
  await expect(newestOfMonth).toBeInViewport()
})

test('search suggestions open the chosen event', async ({ page, isMobile }) => {
  const { child, events } = subject
  // An event in the middle of the line (not on screen at first) with a title no other one contains.
  const titles = events.map((event) => event.title.toLowerCase())
  const target = events
    .slice(Math.floor(events.length / 2))
    .find((event) => titles.filter((title) => title.includes(event.title.toLowerCase())).length === 1)
  expect(target, 'an event with a distinctive title').toBeDefined()
  if (!target) return

  await page.goto(`/c/${child.slug}`)
  if (isMobile) await page.getByRole('button', { name: 'Buscar', exact: true }).click()
  const search = page.getByRole('combobox', { name: 'Buscar hitos' })
  await search.pressSequentially(target.title, { delay: 20 })
  const results = page.getByRole('listbox', { name: 'Hitos encontrados' })
  const option = results.getByRole('option', { name: target.title, exact: true })
  await expect(option).toBeVisible()
  await option.click()

  await expect(page).toHaveURL(new RegExp(`/c/${child.slug}/e/${target.id}\\?`))
  await expectView(page, 'events', `e${target.id}`)
  const dialog = page.getByRole('dialog', { name: target.title })
  await expect(dialog.getByRole('heading', { name: target.title })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cerrar' }).click()
  await expect(dialog).toBeHidden()
  // Back on the timeline (filtered by the search), with the event on screen.
  const link = timelineRegion(page, child.name).getByRole('link', { name: new RegExp(`^${escapeRegExp(target.title)} · `) })
  await expect(link).toBeInViewport()
})

test('phones show the photos full screen, swiping between them', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'full-screen photos are a phone feature')
  const { child, events } = subject
  const event = events.find((item) => item.image_count >= 2)
  expect(event, 'a milestone with several photos').toBeDefined()
  if (!event) return
  const total = event.image_count

  await page.goto(`/c/${child.slug}/e/${event.id}?zoom=events`)
  const card = page.getByRole('dialog', { name: event.title })
  await expect(card.getByRole('heading', { name: event.title })).toBeVisible()
  await card.getByRole('region', { name: `Fotos de «${event.title}»` }).locator('img').first().tap()

  const viewer = page.getByRole('dialog', { name: `Fotos de «${event.title}» a pantalla completa` })
  await expect(viewer).toBeVisible()
  const [box, viewport] = [await viewer.boundingBox(), page.viewportSize()]
  expect(box && viewport && Math.round(box.width) === viewport.width && Math.round(box.height) === viewport.height).toBe(true)
  await expect(viewer.getByRole('button', { name: `Ver la foto 1 de ${total}` })).toHaveAttribute('aria-current', 'true')
  // A swipe (the strip scrolls one photo) moves to the next one.
  await viewer
    .getByRole('region', { name: `Fotos de «${event.title}»` })
    .evaluate((strip) => strip.scrollBy({ left: strip.clientWidth, behavior: 'instant' }))
  await expect(viewer.getByRole('button', { name: `Ver la foto 2 de ${total}` })).toHaveAttribute('aria-current', 'true')

  // The phone's Back button leaves full screen, not the card, which follows the photo seen last.
  await page.goBack()
  await expect(viewer).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/c/${child.slug}/e/${event.id}\\?`))
  await expect(card.getByRole('button', { name: `Ver la foto 2 de ${total}` })).toHaveAttribute('aria-current', 'true')
  await card.getByRole('button', { name: 'Ver la foto a pantalla completa' }).click()
  await expect(viewer.getByRole('button', { name: `Ver la foto 2 de ${total}` })).toHaveAttribute('aria-current', 'true')
  await viewer.getByRole('button', { name: 'Salir de la pantalla completa' }).click()
  await expect(viewer).toBeHidden()
  await expect(card.getByRole('heading', { name: event.title })).toBeVisible()
})

test('phones close the full-screen photos with a swipe down, like ✕', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'full-screen photos are a phone feature')
  const { child, events } = subject
  const event = events.find((item) => item.image_count >= 2)
  expect(event, 'a milestone with several photos').toBeDefined()
  const viewport = page.viewportSize()
  if (!event || !viewport) return
  const total = event.image_count

  await page.goto(`/c/${child.slug}/e/${event.id}?zoom=events`)
  const card = page.getByRole('dialog', { name: event.title })
  await expect(card.getByRole('heading', { name: event.title })).toBeVisible()
  await card.getByRole('button', { name: 'Ver la foto a pantalla completa' }).click()
  const viewer = page.getByRole('dialog', { name: `Fotos de «${event.title}» a pantalla completa` })
  await expect(viewer).toBeVisible()

  // Real touches, so the browser's own panning takes part: sideways swipes still scroll the photos,
  // while a swipe down drags the photo after the finger.
  const finger = await touchscreen(page)
  const { width, height } = viewport
  await finger.drag([width * 0.8, height / 2], [width * 0.2, height / 2])
  await expect(viewer.getByRole('button', { name: `Ver la foto 2 de ${total}` })).toHaveAttribute('aria-current', 'true')

  await finger.drag([width / 2, height * 0.3], [width / 2, height * 0.6], { lift: false })
  await expect(viewer).toHaveAttribute('data-swipe', 'drag')
  await finger.lift()
  await expect(viewer).toBeHidden()
  // As with ✕: back on the card (same address), at the photo seen last.
  await expect(page).toHaveURL(new RegExp(`/c/${child.slug}/e/${event.id}\\?`))
  await expect(card.getByRole('button', { name: `Ver la foto 2 de ${total}` })).toHaveAttribute('aria-current', 'true')
  await finger.detach()
})

test('phones close a milestone by pulling its card down from the top, like ✕', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the full-screen card is the phone layout')
  const { child, events } = subject
  const event = events.find((item) => item.image_count >= 2)
  expect(event, 'a milestone with several photos').toBeDefined()
  if (!event) return
  const total = event.image_count

  // A short screen, so that the card scrolls.
  await page.setViewportSize({ width: 412, height: 420 })
  await page.goto(`/c/${child.slug}/e/${event.id}?zoom=events`)
  const card = page.getByRole('dialog', { name: event.title, exact: true })
  await expect(card.getByRole('heading', { name: event.title })).toBeVisible()
  await waitForAnimations(page)
  // The card's content scrolls inside it (its only child).
  const scrolled = () => card.evaluate((dialog) => Math.max(0, ...Array.from(dialog.children, (child) => child.scrollTop)))
  const cardTop = async () => (await card.boundingBox())?.y ?? Number.NaN
  const finger = await touchscreen(page)

  // Sideways on the photos: the next photo, and the card stays.
  await finger.drag([340, 150], [70, 155])
  await expect(card.getByRole('button', { name: `Ver la foto 2 de ${total}` })).toHaveAttribute('aria-current', 'true')

  // Scrolled down, a pull scrolls the card back up rather than closing it.
  await finger.drag([206, 380], [206, 180])
  await expect.poll(scrolled).toBeGreaterThan(20)
  await finger.drag([206, 120], [206, 380])
  await expect.poll(scrolled).toBe(0)
  expect(await cardTop()).toBe(0)
  await expect(page).toHaveURL(new RegExp(`/c/${child.slug}/e/${event.id}\\?`))

  // From the top, the card follows the finger down; short of the line it glides back. A pull that
  // starts on a button (the full-screen one here) is no press of that button.
  const viewer = page.getByRole('dialog', { name: `Fotos de «${event.title}» a pantalla completa` })
  const expand = await card.getByRole('button', { name: 'Ver la foto a pantalla completa' }).boundingBox()
  expect(expand, 'the full-screen button').not.toBeNull()
  if (!expand) return
  // Near its top: the card follows the finger a few pixels behind, so it is still over the button at the end.
  const onButton = [expand.x + expand.width / 2, expand.y + 8] as const
  const entries = await page.evaluate(() => history.length)
  await finger.drag(onButton, [onButton[0], onButton[1] + 50], { lift: false })
  await expect.poll(cardTop).toBeGreaterThan(20)
  // Held still before letting go: no speed to carry it on.
  await page.waitForTimeout(150)
  await finger.lift()
  await expect.poll(cardTop).toBe(0)
  // A press would open the photos full screen (react-aria presses 80 ms after the release).
  await page.waitForTimeout(300)
  await expect(viewer).toHaveCount(0)

  // Pulled far enough, it closes on release as ✕ does: back on the timeline, no history entry added.
  await finger.drag(onButton, [onButton[0], 410], { lift: false })
  await expect.poll(cardTop).toBeGreaterThan(80)
  await finger.lift()
  await expect(card).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/c/${child.slug}\\?zoom=events`))
  await expect(timelineRegion(page, child.name)).toBeVisible()
  await page.waitForTimeout(300)
  await expect(viewer).toHaveCount(0)
  expect(await page.evaluate(() => history.length)).toBe(entries)
  await finger.detach()
})

test('everyone together: a line per child, merging at the milestones they share', async ({ page, isMobile }) => {
  const [children, family] = await Promise.all([
    getJson<ChildOut[]>(page.request, '/api/children'),
    getJson<TimelineOut>(page.request, '/api/timeline'),
  ])
  test.skip(children.length < 2, 'the family timeline needs two children')
  const withMilestones = children.filter((child) => family.events.some((event) => event.child_ids.includes(child.id)))
  const shared = family.events.find((event) => event.child_ids.length > 1)
  expect(shared, 'a milestone of several children').toBeDefined()
  if (!shared) return

  // From the child switcher, which remembers the choice for the next visit.
  await page.goto(`/c/${children[0].slug}`)
  await page.getByRole('button', { name: `Cambiar de niño: ${children[0].name}` }).click()
  await page.getByRole('menuitemradio', { name: /^Todos juntos/ }).click()
  await expect(page).toHaveURL(/\/all(\?|$)/)
  const region = page.getByRole('region', { name: 'Línea de tiempo de todos juntos' })
  await expect(region.locator('path[data-lane]')).toHaveCount(withMilestones.length)

  // Shared milestones say whose they are, sit between the lanes and open over the family timeline.
  const names = new Intl.ListFormat('es', { type: 'conjunction' }).format(
    children.filter((child) => shared.child_ids.includes(child.id)).map((child) => child.name),
  )
  /** Distance across the line between a milestone's circle and the middle of the timeline. */
  async function offAxis(key: string): Promise<number> {
    const [circle, area] = await Promise.all([region.locator(`a[data-node-key="${key}"] [data-circle]`).boundingBox(), region.boundingBox()])
    if (!circle || !area) return Number.NaN
    return isMobile ? circle.x + circle.width / 2 - (area.x + area.width / 2) : circle.y + circle.height / 2 - (area.y + area.height / 2)
  }
  const own = family.events.find((event) => event.child_ids.length === 1)
  if (own && withMilestones.length === 2) {
    await page.goto(`/all?zoom=events&focus=e${own.id}`)
    await expect(region.locator(`a[data-node-key="e${own.id}"]`)).toBeInViewport()
    await expect(async () => expect(Math.abs(await offAxis(`e${own.id}`))).toBeGreaterThan(40)).toPass()
  }
  await page.goto(`/all?zoom=events&focus=e${shared.id}`)
  const link = region.locator(`a[data-node-key="e${shared.id}"]`)
  await expect(link).toBeInViewport()
  await expect(link).toHaveAccessibleName(new RegExp(` · ${escapeRegExp(names)}$`))
  if (withMilestones.length === 2) await expect(async () => expect(Math.abs(await offAxis(`e${shared.id}`))).toBeLessThan(4)).toPass()
  await link.click()
  const dialog = page.getByRole('dialog', { name: shared.title })
  await expect(dialog.getByRole('list', { name: 'Niños de este hito' }).getByRole('img')).toHaveCount(shared.child_ids.length)
  await expect(page).toHaveURL(new RegExp(`/all/e/${shared.id}\\?`))
  await page.goBack()
  await expect(dialog).toBeHidden()

  await page.goto('/')
  await expect(page).toHaveURL(/\/all$/)
})

test('category filters narrow the timeline and count as active filters', async ({ page, isMobile }) => {
  const { child, events, categories } = subject
  // Two categories used by some (not all) of the child's events.
  const used = categories
    .map((category) => ({ category, count: events.filter((event) => event.category_ids.includes(category.id)).length }))
    .filter(({ count }) => count > 0 && count < events.length)
    .toSorted((a, b) => b.count - a.count)
  expect(used.length).toBeGreaterThanOrEqual(2)
  const [first, second] = [used[0].category, used[1].category]
  const matching = (ids: number[]) => events.filter((event) => event.category_ids.some((id) => ids.includes(id)))

  await page.goto(`/c/${child.slug}?zoom=years`)
  const region = timelineRegion(page, child.name)
  await expect(page.getByRole('button', { name: 'Filtros', exact: true })).toBeVisible()
  let panel = await openFilters(page)
  const chips = panel.getByRole('toolbar', { name: 'Categorías' })

  await chips.getByRole('button', { name: first.name_es, exact: true }).click()
  await expect(chips.getByRole('button', { name: first.name_es, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByText(`${matching([first.id]).length} de ${hitos(events.length)}`)).toBeVisible()
  await expect.poll(() => searchParam(page, 'cat')).toBe(String(first.id))

  await chips.getByRole('button', { name: second.name_es, exact: true }).click()
  const both = matching([first.id, second.id])
  await expect(panel.getByText(`${both.length} de ${hitos(events.length)}`)).toBeVisible()

  if (isMobile) {
    await panel.getByRole('button', { name: `Ver ${hitos(both.length)}` }).click()
  } else {
    // The desktop panel floats over the timeline without hiding the header.
    await expect(page.getByRole('button', { name: 'Filtros (2 activos)' })).toBeVisible()
    await panel.getByRole('button', { name: 'Cerrar filtros' }).click()
  }
  await expect(panel).toBeHidden()
  const toggle = page.getByRole('button', { name: 'Filtros (2 activos)' })
  await expect(toggle).toBeVisible()
  await expect(toggle.getByText('2', { exact: true })).toBeVisible()

  // Hubs only for years with matching events, counting only those.
  const filteredYears = countBy(both, yearOf)
  await expect(region.getByRole('list', { name: `Años con hitos: ${filteredYears.size} ${filteredYears.size === 1 ? 'año' : 'años'}` })).toBeVisible()
  await expectHubCounts(region, filteredYears)

  panel = await openFilters(page)
  await panel.getByRole('button', { name: 'Limpiar filtros' }).click()
  await expect(panel.getByText(hitos(events.length), { exact: true })).toBeVisible()
  await expect.poll(() => searchParam(page, 'cat')).toBeNull()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: 'Filtros', exact: true })).toBeVisible()
  await expectHubCounts(region, countBy(events, yearOf))
})

test('a typed date range narrows the timeline to that period', async ({ page, isMobile }) => {
  const { child, events } = subject
  const years = [...countBy(events, yearOf).keys()]
  const year = years[1] ?? years[0]
  const inYear = events.filter((event) => yearOf(event) === year)

  await page.goto(`/c/${child.slug}?zoom=months`)
  const panel = await openFilters(page)
  await panel.getByRole('spinbutton', { name: 'día, Desde' }).click()
  await page.keyboard.type(`0101${year}`)
  await panel.getByRole('spinbutton', { name: 'día, Hasta' }).click()
  await page.keyboard.type(`3112${year}`)
  await expect.poll(() => [searchParam(page, 'from'), searchParam(page, 'to')]).toEqual([`${year}-01-01`, `${year}-12-31`])
  await expect(panel.getByText(`${inYear.length} de ${hitos(events.length)}`)).toBeVisible()

  if (isMobile) await panel.getByRole('button', { name: `Ver ${hitos(inYear.length)}` }).click()
  else await panel.getByRole('button', { name: 'Cerrar filtros' }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: 'Filtros (1 activo)' })).toBeVisible()
  // Only that year's months remain, with their counts.
  const months = countBy(inYear, monthOf)
  const region = timelineRegion(page, child.name)
  await expect(region.getByRole('list', { name: `Meses con hitos: ${months.size} ${months.size === 1 ? 'mes' : 'meses'}` })).toBeVisible()
  await expectHubCounts(region, months)
})

test('the theme can be switched to dark and back', async ({ page, isMobile }) => {
  await page.goto(`/c/${subject.child.slug}`)
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'light')
  await chooseTheme(page, isMobile, 'Oscuro')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(timelineRegion(page, subject.child.name)).toBeVisible()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await chooseTheme(page, isMobile, 'Claro')
  await expect(html).toHaveAttribute('data-theme', 'light')
})

/** `#f2f7fa` → `rgb(242, 247, 250)`, as computed styles give colours. */
function rgb(hex: string): string {
  const [red, green, blue] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
  return `rgb(${red}, ${green}, ${blue})`
}

test('another colour theme can be chosen and stays after a reload', async ({ page, isMobile }) => {
  await page.goto(`/c/${subject.child.slug}`)
  await expect(timelineRegion(page, subject.child.name)).toBeVisible()
  const html = page.locator('html')
  const pageBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await expect(html).toHaveAttribute('data-palette', 'sunset')
  expect(await pageBackground()).toBe(rgb(THEMES.sunset.background.light))

  await choosePalette(page, isMobile, 'Océano')
  await expect(html).toHaveAttribute('data-palette', 'ocean')
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect.poll(pageBackground).toBe(rgb(THEMES.ocean.background.light))
  // The browser's own colours follow (automatic mode: one per colour scheme).
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', THEMES.ocean.background.light)

  await page.reload()
  await expect(timelineRegion(page, subject.child.name)).toBeVisible()
  await expect(html).toHaveAttribute('data-palette', 'ocean')
  expect(await pageBackground()).toBe(rgb(THEMES.ocean.background.light))
  // Dark mode keeps the chosen theme.
  await chooseTheme(page, isMobile, 'Oscuro')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(html).toHaveAttribute('data-palette', 'ocean')
  await expect.poll(pageBackground).toBe(rgb(THEMES.ocean.background.dark))
})

test('the interface can be switched to English and to Portuguese', async ({ page, isMobile }) => {
  const { child, events, categories } = subject
  await page.goto(`/c/${child.slug}?zoom=events`)
  const html = page.locator('html')
  await expect(html).toHaveAttribute('lang', 'es')

  await chooseLanguage(page, isMobile, 'English')
  await expect(html).toHaveAttribute('lang', 'en')

  const region = page.getByRole('region', { name: `${child.name}'s timeline` })
  const zoom = region.getByRole('group', { name: 'Timeline zoom' })
  await expect(zoom.getByRole('button', { name: 'Zoom out' })).toBeVisible()
  await expect(zoom.getByRole('radio', { name: 'Days' })).toBeChecked()
  await expect(region.getByRole('list', { name: `${events.length} milestones` })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible()
  if (!isMobile) await expect(page.getByRole('combobox', { name: 'Search milestones' })).toBeVisible()
  // Category names follow the language too.
  const newest = events[0]
  const newestCategories = newest.category_ids.map((id) => categories.find((category) => category.id === id))
  const names = newestCategories.map((category) => category?.name_en)
  await expect(region.getByRole('link', { name: `${newest.title} · ` }).first()).toHaveAttribute(
    'aria-label',
    new RegExp(` · ${escapeRegExp(names.join(', '))}$`),
  )

  await page.reload()
  await expect(html).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('region', { name: `${child.name}'s timeline` })).toBeVisible()

  // European Portuguese, chosen from the English interface.
  await chooseLanguage(page, isMobile, 'Português')
  await expect(html).toHaveAttribute('lang', 'pt')
  const portuguese = page.getByRole('region', { name: `Linha do tempo de ${child.name}` })
  const zoomPt = portuguese.getByRole('group', { name: 'Zoom da linha do tempo' })
  await expect(zoomPt.getByRole('button', { name: 'Reduzir' })).toBeVisible()
  await expect(zoomPt.getByRole('radio', { name: 'Dias' })).toBeChecked()
  await expect(portuguese.getByRole('list', { name: `${events.length} marcos` })).toBeVisible()
  if (!isMobile) await expect(page.getByRole('combobox', { name: 'Pesquisar marcos' })).toBeVisible()
  // A category without a Portuguese name shows its Spanish one.
  const namesPt = newestCategories.map((category) => category?.name_pt.trim() || category?.name_es)
  await expect(portuguese.getByRole('link', { name: `${newest.title} · ` }).first()).toHaveAttribute(
    'aria-label',
    new RegExp(` · ${escapeRegExp(namesPt.join(', '))}$`),
  )

  await page.reload()
  await expect(html).toHaveAttribute('lang', 'pt')
  await expect(portuguese).toBeVisible()
})
