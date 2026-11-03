import type { Locator, Page } from '@playwright/test'
import type { CategoryOut, ChildOut, EventOut, TimelineOut } from '../src/api/schema.gen'
import {
  chooseFiles,
  escapeRegExp,
  getJson,
  setPressed,
  storageStateOf,
  timelineRegion,
  toasts,
  uniqueSuffix,
  expect,
  test,
} from './support'

// The admin's whole journey with a milestone, through the UI: new child (with avatar), new event
// with photos, timeline, detail card, edit from the card, trash, restore and permanent deletion.
test.use({ storageState: storageStateOf('admin') })

const NOTES = 'Merienda al sol y muchas risas en el columpio.'
const LOCATION = 'Parque del Oeste, Madrid'

function eventLink(page: Page, child: ChildOut, title: string): Locator {
  return timelineRegion(page, child.name).getByRole('link', { name: new RegExp(`^${escapeRegExp(title)} · `) })
}

async function rowNames(grid: Locator): Promise<string[]> {
  return grid.getByRole('row').evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label') ?? ''))
}

async function moveToTrash(page: Page, title: string): Promise<void> {
  await page.goto(`/admin/events?q=${encodeURIComponent(title)}`)
  await page.getByRole('list', { name: 'Eventos', exact: true }).getByRole('button', { name: `Eliminar «${title}»` }).click()
  const confirm = page.getByRole('alertdialog', { name: '¿Mover a la papelera?' })
  await expect(confirm).toContainText(`«${title}» dejará de verse en la línea de tiempo.`)
  await confirm.getByRole('button', { name: 'Mover a la papelera' }).click()
  await expect(toasts(page).getByText(`«${title}» se ha movido a la papelera.`)).toBeVisible()
  await expect(confirm).toBeHidden()
}

test('an admin creates, edits, trashes, restores and purges a milestone with photos', async ({ page }, testInfo) => {
  test.slow()
  const suffix = uniqueSuffix(testInfo)
  const childName = `Nora ${suffix}`
  const title = `Picnic en el parque ${suffix}`
  const newTitle = `Picnic con los abuelos ${suffix}`
  // The milestone is shared with an existing child other than the first one (whose timeline the
  // read-only suites check while this runs).
  const existing = await getJson<ChildOut[]>(page.request, '/api/children')
  const sibling = existing[1] ?? existing[0]
  const [primary, secondary] = await getJson<CategoryOut[]>(page.request, '/api/categories')
  let child!: ChildOut
  let event!: EventOut

  await test.step('add a child with an avatar', async () => {
    await page.goto('/admin/children')
    await page.getByRole('button', { name: 'Añadir niño' }).click()
    const dialog = page.getByRole('dialog', { name: 'Añadir niño' })
    await chooseFiles(page, dialog.getByRole('button', { name: 'Subir foto' }), ['avatar.png'])
    await expect(dialog.getByRole('button', { name: 'Cambiar foto' })).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Nombre', exact: true }).fill(childName)
    await dialog.getByRole('button', { name: 'Añadir niño' }).click()
    await expect(toasts(page).getByText(`${childName} se ha añadido.`)).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('row', { name: childName })).toBeVisible()

    const created = (await getJson<ChildOut[]>(page.request, '/api/children')).find((item) => item.name === childName)
    expect(created?.avatar, 'the uploaded avatar is saved').toBeTruthy()
    child = created as ChildOut
    // The server makes the timeline address from the name; the card no longer shows it.
    expect(child.slug).toBe(`nora-${suffix}`)
    await expect(page.getByRole('row', { name: childName }).getByRole('link')).toHaveCount(0)
    expect((await page.request.get(child.avatar?.thumb_url ?? '')).status()).toBe(200)
  })

  await test.step('create a milestone for two children with three photos', async () => {
    await page.goto('/admin/events/new')
    const details = page.getByRole('region', { name: 'Datos del evento' })
    await details.getByRole('textbox', { name: 'Título' }).fill(title)
    await details.getByRole('combobox', { name: 'Ubicación' }).fill(LOCATION)
    // Leave the field (and its suggestions of places already used).
    await page.keyboard.press('Tab')
    await details.getByRole('textbox', { name: 'Notas' }).fill(NOTES)

    const children = details.getByRole('group', { name: 'Niños' })
    for (const item of await getJson<ChildOut[]>(page.request, '/api/children')) {
      await setPressed(children.getByRole('button', { name: item.name, exact: true }), item.id === child.id || item.id === sibling.id)
    }
    const categories = details.getByRole('group', { name: 'Categorías' })
    await categories.getByRole('button', { name: `Añadir ${primary.name_es}` }).click()
    await categories.getByRole('button', { name: `Añadir ${secondary.name_es}` }).click()
    const selected = categories.getByRole('list', { name: 'Seleccionados' }).getByRole('listitem')
    await expect(selected).toHaveCount(2)
    await expect(selected.first()).toContainText(primary.name_es)
    await expect(selected.first()).toContainText('Principal')

    const images = page.getByRole('region', { name: 'Fotos y vídeos' })
    await chooseFiles(page, images.getByRole('button', { name: 'Elegir fotos y vídeos' }), ['amanecer.jpg', 'columpio.png', 'merienda.jpg'])
    const grid = images.getByRole('grid', { name: 'Fotos y vídeos del evento' })
    await expect(grid.getByRole('row')).toHaveCount(3)
    await expect(grid.getByRole('progressbar')).toHaveCount(0)
    await expect(images.getByText('3 de 50')).toBeVisible()
    // The first photo is the cover until another one is chosen.
    await expect(grid.getByRole('button', { name: '«amanecer» es la portada' })).toHaveAttribute('aria-pressed', 'true')
    await grid.getByRole('button', { name: 'Usar «merienda» como portada' }).click()
    await expect(grid.getByRole('button', { name: '«merienda» es la portada' })).toHaveAttribute('aria-pressed', 'true')

    // Reorder with the keyboard (react-aria drag and drop): "columpio" before "amanecer".
    await grid.getByRole('button', { name: 'Arrastrar columpio' }).focus()
    await page.keyboard.press('Enter')
    const target = page.locator(':focus')
    await expect(target).toHaveAttribute('aria-label', /^Insertar /)
    // The list registers its current drop target on the next render; arrows sent earlier are lost.
    await expect(grid.locator('[data-drop-target="true"]')).toHaveCount(1)
    await expect(async () => {
      if ((await target.getAttribute('aria-label')) !== 'Insertar antes de amanecer') await page.keyboard.press('ArrowLeft')
      await expect(target).toHaveAttribute('aria-label', 'Insertar antes de amanecer', { timeout: 1_000 })
    }).toPass()
    await page.keyboard.press('Enter')
    await expect.poll(() => rowNames(grid)).toEqual(['columpio', 'amanecer', 'merienda'])

    await grid.getByRole('button', { name: 'Cambiar el nombre de «amanecer»' }).click()
    const rename = page.getByRole('dialog', { name: 'Nombre de la imagen' })
    await rename.getByRole('textbox', { name: 'Nombre de la imagen' }).fill('Amanecer en el parque')
    await rename.getByRole('button', { name: 'Guardar' }).click()
    await expect(rename).toBeHidden()
    await expect.poll(() => rowNames(grid)).toEqual(['columpio', 'Amanecer en el parque', 'merienda'])

    await page.getByRole('button', { name: 'Crear evento' }).click()
    const toast = toasts(page).getByRole('status').filter({ hasText: `«${title}» se ha creado.` })
    await expect(toast).toBeVisible()
    await expect(page).toHaveURL('/admin/events')
    const href = (await toast.getByRole('link', { name: 'Ver en la línea de tiempo' }).getAttribute('href')) ?? ''
    const id = Number(/\/e\/(\d+)$/.exec(href)?.[1])
    expect(id, `event id in ${href}`).toBeGreaterThan(0)

    event = await getJson<EventOut>(page.request, `/api/admin/events/${id}`)
    expect(event.title).toBe(title)
    expect(event.child_ids.toSorted()).toEqual([child.id, sibling.id].toSorted())
    expect(event.category_ids).toEqual([primary.id, secondary.id])
    expect(event.images.map((image) => image.name)).toEqual(['columpio', 'Amanecer en el parque', 'merienda'])
    expect(event.cover_image_id).toBe(event.images[2].id)
  })

  await test.step('the milestone is on both timelines', async () => {
    for (const owner of [sibling, child]) {
      await page.goto(`/c/${owner.slug}?zoom=events`)
      const link = eventLink(page, owner, title)
      await expect(link).toBeVisible()
      await expect(link.getByTitle(title)).toHaveText(title)
    }
  })

  await test.step('the detail card starts with the cover and shows names and categories', async () => {
    await eventLink(page, child, title).click()
    const dialog = page.getByRole('dialog', { name: title })
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
    const carousel = dialog.getByRole('region', { name: `Fotos de «${title}»` })
    const photos = carousel.locator('img[alt]')
    // Cover first, then the others in their saved order; the alt text names each photo and the
    // name is never shown over it (no caption, no hover tooltip).
    await expect(photos).toHaveCount(3)
    const names = ['merienda', 'columpio', 'Amanecer en el parque']
    for (const [index, name] of names.entries()) {
      await expect(photos.nth(index)).toHaveAttribute('alt', name)
      await expect(photos.nth(index)).not.toHaveAttribute('title')
    }
    await expect(carousel.getByText('merienda')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Ver la foto 1 de 3' })).toHaveAttribute('aria-current', 'true')
    await expect(photos.first()).toBeInViewport()
    await expect(dialog.getByRole('button', { name: 'Foto anterior' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Foto siguiente' }).click()
    await expect(dialog.getByRole('button', { name: 'Ver la foto 2 de 3' })).toHaveAttribute('aria-current', 'true')
    await expect(photos.nth(1)).toBeInViewport()

    const pills = dialog.getByRole('list', { name: 'Categorías' }).getByRole('button')
    await expect(pills).toHaveCount(2)
    await expect(pills.nth(0)).toHaveAccessibleName(primary.name_es)
    await expect(pills.nth(1)).toHaveAccessibleName(secondary.name_es)
    const shared = dialog.getByRole('list', { name: 'Niños de este hito' })
    await expect(shared.getByRole('img', { name: childName })).toBeVisible()
    await expect(shared.getByRole('img', { name: sibling.name })).toBeVisible()
    await expect(dialog.getByText(LOCATION)).toBeVisible()
    await expect(dialog.getByText(NOTES)).toBeVisible()
  })

  await test.step('edit the title from the card', async () => {
    const dialog = page.getByRole('dialog', { name: title })
    await dialog.getByRole('button', { name: 'Editar hito' }).click()
    const editor = page.getByRole('dialog', { name: `Editando «${title}»` })
    const field = editor.getByRole('textbox', { name: 'Título' })
    await expect(field).toHaveValue(title)
    await field.fill(newTitle)
    await editor.getByRole('button', { name: 'Guardar cambios' }).click()

    const card = page.getByRole('dialog', { name: newTitle })
    await expect(card.getByRole('heading', { name: newTitle })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Editar hito' })).toBeVisible()
    await expect(card.getByRole('region', { name: `Fotos de «${newTitle}»` }).locator('img[alt]').first()).toHaveAttribute('alt', 'merienda')
    await card.getByRole('button', { name: 'Cerrar' }).click()
    await expect(card).toBeHidden()
    await expect(eventLink(page, child, newTitle)).toBeVisible()
    await expect(eventLink(page, child, title)).toHaveCount(0)
  })

  await test.step('delete it: it moves to the trash and leaves the timelines', async () => {
    await moveToTrash(page, newTitle)
    await toasts(page).getByRole('link', { name: 'Ver papelera' }).click()
    await expect(page).toHaveURL('/admin/trash')
    const item = page.getByRole('list', { name: 'Eventos en la papelera' }).getByRole('listitem').filter({ hasText: newTitle })
    await expect(item).toBeVisible()
    await expect(item.getByText('3 fotos')).toBeVisible()
    await expect(item.getByText(/^Eliminado el .+ por dev-admin@example\.com$/)).toBeVisible()

    await page.goto(`/c/${child.slug}`)
    await expect(page.getByRole('heading', { name: `Todavía no hay hitos de ${childName}` })).toBeVisible()
    const timeline = await getJson<TimelineOut>(page.request, `/api/children/${sibling.id}/timeline`)
    expect(timeline.events.map((item) => item.id)).not.toContain(event.id)
  })

  await test.step('restore it from the trash', async () => {
    await page.goto('/admin/trash')
    const item = page.getByRole('list', { name: 'Eventos en la papelera' }).getByRole('listitem').filter({ hasText: newTitle })
    await item.getByRole('button', { name: `Restaurar «${newTitle}»` }).click()
    await expect(toasts(page).getByText(`«${newTitle}» se ha restaurado.`)).toBeVisible()
    await expect(item).toHaveCount(0)

    await page.goto(`/c/${child.slug}?zoom=events`)
    await expect(eventLink(page, child, newTitle)).toBeVisible()
  })

  await test.step('delete it again and purge it for good', async () => {
    await moveToTrash(page, newTitle)
    await page.goto('/admin/trash')
    const item = page.getByRole('list', { name: 'Eventos en la papelera' }).getByRole('listitem').filter({ hasText: newTitle })
    await item.getByRole('button', { name: `Eliminar definitivamente «${newTitle}»` }).click()
    const confirm = page.getByRole('alertdialog', { name: '¿Eliminar para siempre?' })
    await expect(confirm).toContainText(`«${newTitle}» y sus 3 fotos se borrarán definitivamente.`)
    await confirm.getByRole('button', { name: 'Eliminar para siempre' }).click()
    await expect(toasts(page).getByText(`«${newTitle}» se ha eliminado definitivamente.`)).toBeVisible()
    await expect(confirm).toBeHidden()
    await expect(page.getByRole('listitem').filter({ hasText: newTitle })).toHaveCount(0)

    expect((await page.request.get(`/api/admin/events/${event.id}`)).status()).toBe(404)
    for (const image of event.images) {
      expect((await page.request.get(image.thumb_url)).status(), `photo ${image.name} is deleted`).toBe(404)
    }
    await page.goto(`/c/${child.slug}`)
    await expect(page.getByRole('heading', { name: `Todavía no hay hitos de ${childName}` })).toBeVisible()
    await page.goto(`/c/${sibling.slug}?zoom=events`)
    await expect(timelineRegion(page, sibling.name).getByRole('link').first()).toBeVisible()
    await expect(eventLink(page, sibling, newTitle)).toHaveCount(0)
  })

  await test.step('remove the child again', async () => {
    await page.goto('/admin/children')
    await page.getByRole('button', { name: `Eliminar a ${childName}` }).click()
    const confirm = page.getByRole('alertdialog', { name: `¿Eliminar a ${childName}?` })
    await confirm.getByRole('button', { name: 'Eliminar', exact: true }).click()
    await expect(toasts(page).getByText(`${childName} se ha eliminado.`)).toBeVisible()
    await expect(page.getByRole('row', { name: childName })).toHaveCount(0)
    expect((await page.request.get(child.avatar?.thumb_url ?? '')).status()).toBe(404)
  })
})
