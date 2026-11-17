import type { CategoryOut, ChildOut, EventOut, MemoriesOut } from '../src/api/schema.gen'
import { browserToday, escapeRegExp, expect, getJson, send, storageStateOf, test, toasts, uniqueSuffix } from './support'

// Today's memories: told once in a notice, listed in the header's panel and opened over the
// timeline. auth.setup.ts saved today's memories as seen for the development users (so that no
// other page shows the notice): here the app is told that nothing was recorded yet, while what it
// saves still reaches the server.
test.use({ storageState: storageStateOf('admin') })

const NOTHING_YET: MemoriesOut = { announced_on: null, opened_on: null }

test('tells about a milestone of a year ago today, and opens it from the panel', async ({ page }, testInfo) => {
  const today = browserToday()
  // Exactly a year ago (four years for 29 February), for a child other than the first one (whose
  // timeline the read-only suites check while this runs).
  const years = today.endsWith('-02-29') ? 4 : 1
  const date = `${Number(today.slice(0, 4)) - years}${today.slice(4)}`
  const children = await getJson<ChildOut[]>(page.request, '/api/children')
  const child = children[1] ?? children[0]
  const [category] = await getJson<CategoryOut[]>(page.request, '/api/categories')
  const title = `Recuerdo ${uniqueSuffix(testInfo)}`
  const event = await send<EventOut>(page.request, 'POST', '/api/admin/events', {
    title,
    date,
    child_ids: [child.id],
    category_ids: [category.id],
  })
  try {
    await page.route('**/api/memories', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: NOTHING_YET }) : route.fallback(),
    )
    const told = page.waitForResponse((response) => response.url().endsWith('/api/memories/seen'))
    await page.goto(`/c/${child.slug}`)
    await expect(toasts(page).getByRole('status').filter({ hasText: /^Tal día como hoy, / })).toBeVisible()
    const saved = await told
    expect(saved.request().postDataJSON()).toEqual({ announced_on: today })
    expect(saved.status()).toBe(200)

    await page.getByRole('button', { name: /^Recuerdos/ }).click()
    const panel = page.getByRole('dialog', { name: 'Recuerdos de hoy' })
    await expect(panel.getByRole('heading', { name: years === 1 ? 'Hace 1 año' : `Hace ${years} años`, level: 3 })).toBeVisible()
    const memory = panel.getByRole('link', { name: new RegExp(`^${escapeRegExp(title)}`) })
    await expect(memory).toHaveAttribute('href', `/c/${child.slug}/e/${event.id}?zoom=events&focus=e${event.id}`)
    await memory.click()
    await expect(page.getByRole('dialog', { name: title })).toBeVisible()
    await expect(panel).toBeHidden()
  } finally {
    await send(page.request, 'DELETE', `/api/admin/events/${event.id}`)
    await send(page.request, 'DELETE', `/api/admin/trash/${event.id}`)
  }
})
