import { expect, test, type Page } from '@playwright/test'
import type { CategoryOut, ChildOut, EventOut, UploadOut } from '../src/api/schema.gen'
import { chooseFiles, escapeRegExp, getJson, send, setPressed, storageStateOf, timelineRegion, toasts, uniqueSuffix } from './support'

// Videos and Live Photos, through the UI: a video and a Live Photo (photo + clip with the same
// name) are uploaded together, converted by the server (ffmpeg), shown on the event card and the
// Live choice is switched off from the editor. Playwright's Chromium cannot decode H.264, so the
// players are checked by their markup rather than by playing them.
test.use({ storageState: storageStateOf('admin') })

async function addChild(page: Page, name: string): Promise<ChildOut> {
  return send<ChildOut>(page.request, 'POST', '/api/admin/children', { name })
}

test('an admin adds a video and a Live Photo to a milestone and switches the Live Photo off', async ({ page }, testInfo) => {
  test.slow()
  const suffix = uniqueSuffix(testInfo)
  const child = await addChild(page, `Vera ${suffix}`)
  const [category] = await getJson<CategoryOut[]>(page.request, '/api/categories')
  const title = `Columpio en vídeo ${suffix}`
  let event!: EventOut

  await test.step('upload a video and a Live Photo; they are converted on the server', async () => {
    await page.goto('/admin/events/new')
    const details = page.getByRole('region', { name: 'Datos del evento' })
    await details.getByRole('textbox', { name: 'Título' }).fill(title)
    const children = details.getByRole('group', { name: 'Niños' })
    for (const item of await getJson<ChildOut[]>(page.request, '/api/children')) {
      await setPressed(children.getByRole('button', { name: item.name, exact: true }), item.id === child.id)
    }
    await details.getByRole('group', { name: 'Categorías' }).getByRole('button', { name: `Añadir ${category.name_es}` }).click()

    const media = page.getByRole('region', { name: 'Fotos y vídeos' })
    await expect(media.getByText(/^Fotos Live: sube juntos la foto y su vídeo/)).toBeVisible()
    await chooseFiles(page, media.getByRole('button', { name: 'Elegir fotos y vídeos' }), ['paseo.mp4', 'risas.jpg', 'risas.mov'])
    const grid = media.getByRole('grid', { name: 'Fotos y vídeos del evento' })
    // The photo and the clip of the Live Photo are one item.
    await expect(grid.getByRole('row')).toHaveCount(2)
    await expect(grid.getByRole('progressbar')).toHaveCount(0, { timeout: 60_000 })
    await expect(grid.getByRole('row', { name: 'paseo' }).getByText('0:02')).toBeVisible()
    const live = grid.getByRole('button', { name: 'Foto Live «risas»: mostrar con movimiento' })
    await expect(live).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Crear evento' }).click()
    const toast = toasts(page).getByRole('status').filter({ hasText: `«${title}» se ha creado.` })
    await expect(toast).toBeVisible()
    const href = (await toast.getByRole('link', { name: 'Ver en la línea de tiempo' }).getAttribute('href')) ?? ''
    event = await getJson<EventOut>(page.request, `/api/admin/events/${/\/e\/(\d+)$/.exec(href)?.[1]}`)
    expect(event.images.map((image) => [image.name, image.kind, image.video_status, image.live])).toEqual([
      ['paseo', 'video', 'ready', false],
      ['risas', 'image', 'ready', true],
    ])
    // The converted files are MP4, served in byte ranges.
    const [movie, photo] = event.images
    const part = await page.request.get(movie.video_url ?? '', { headers: { Range: 'bytes=0-15' } })
    expect([part.status(), part.headers()['content-type'], part.headers()['content-range']]).toEqual([
      206,
      'video/mp4',
      expect.stringMatching(/^bytes 0-15\/\d+$/),
    ])
    expect((await part.body()).subarray(4, 8).toString()).toBe('ftyp')
    expect((await page.request.get(photo.video_url ?? '')).status()).toBe(200)
  })

  await test.step('the card plays the video and moves the Live Photo', async () => {
    await page.goto(`/c/${child.slug}?zoom=events`)
    await timelineRegion(page, child.name).getByRole('link', { name: new RegExp(`^${escapeRegExp(title)} · `) }).click()
    const dialog = page.getByRole('dialog', { name: title })
    const carousel = dialog.getByRole('region', { name: `Fotos y vídeos de «${title}»` })
    const player = carousel.locator('video[controls]')
    await expect(player).toHaveAttribute('src', event.images[0].video_url ?? '')
    await expect(player).toHaveAttribute('poster', event.images[0].display_url)
    await expect(player).toHaveAttribute('aria-label', 'paseo')
    await dialog.getByRole('button', { name: 'Foto siguiente' }).click()
    const badge = dialog.getByRole('button', { name: 'Reproducir la foto Live «risas»' })
    await expect(badge).toBeVisible()
    await expect(carousel.locator('video[aria-hidden="true"]')).toHaveAttribute('src', event.images[1].video_url ?? '')
  })

  await test.step('switch the Live Photo off from the editor', async () => {
    await page.goto(`/admin/events/${event.id}`)
    const grid = page.getByRole('grid', { name: 'Fotos y vídeos del evento' })
    await setPressed(grid.getByRole('button', { name: 'Foto Live «risas»: mostrar con movimiento' }), false)
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(toasts(page).getByText('Cambios guardados.')).toBeVisible()
    const saved = await getJson<EventOut>(page.request, `/api/admin/events/${event.id}`)
    expect(saved.images.map((image) => image.live)).toEqual([false, false])
    const upload = await getJson<UploadOut>(page.request, `/api/admin/uploads/${saved.images[1].id}`)
    expect([upload.video_status, upload.live, upload.progress]).toEqual(['ready', false, null])

    await page.goto(`/c/${child.slug}/e/${event.id}`)
    const dialog = page.getByRole('dialog', { name: title })
    await expect(dialog.getByRole('region', { name: `Fotos y vídeos de «${title}»` }).locator('video[controls]')).toHaveCount(1)
    await expect(dialog.getByRole('button', { name: /Reproducir la foto Live/ })).toHaveCount(0)
  })

  await test.step('clean up: purge the milestone and remove the child', async () => {
    await send(page.request, 'DELETE', `/api/admin/events/${event.id}`)
    await page.goto('/admin/trash')
    const item = page.getByRole('list', { name: 'Eventos en la papelera' }).getByRole('listitem').filter({ hasText: title })
    await expect(item.getByText('1 foto · 1 vídeo')).toBeVisible()
    await send(page.request, 'DELETE', `/api/admin/trash/${event.id}`)
    for (const image of event.images) {
      expect((await page.request.get(image.video_url ?? '')).status(), `${image.name} is deleted`).toBe(404)
    }
    await send(page.request, 'DELETE', `/api/admin/children/${child.id}`)
  })
})
