import type { Locator, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { AppearanceOut, CategoryOut, ChildOut, EventOut, EventPageOut, ImageOut, SessionOut, TimelineOut, TrashItemOut, UserOut } from '../src/api/schema.gen'
import {
  ANONYMOUS,
  MUTATION_HEADERS,
  escapeRegExp,
  fixture,
  getJson,
  openUserMenu,
  send,
  storageStateOf,
  timelineRegion,
  toasts,
  uniqueSuffix,
  expect,
  test,
} from './support'

test.use({ storageState: storageStateOf('admin') })

async function categoryNames(page: Page): Promise<string[]> {
  return (await getJson<CategoryOut[]>(page.request, '/api/categories')).map((category) => category.name_es)
}

async function fillColor(field: Locator, hex: string): Promise<void> {
  await field.fill(hex)
  // The hex field commits on blur (Enter would also submit the surrounding form).
  await field.press('Tab')
}

async function pickIcon(dialog: Locator, search: string, icon: string): Promise<void> {
  await dialog.getByRole('searchbox', { name: 'Buscar icono' }).fill(search)
  const option = dialog.getByRole('listbox', { name: /^Icono/ }).getByRole('option', { name: icon.replaceAll('-', ' '), exact: true })
  await option.click()
  await expect(option).toHaveAttribute('aria-selected', 'true')
}

test('categories: create, edit colour and icon, reorder and delete', async ({ page }, testInfo) => {
  const suffix = uniqueSuffix(testInfo)
  const name = `Natación ${suffix}`
  const nameEn = `Swimming ${suffix}`
  const namePt = `Natação ${suffix}`
  await page.goto('/admin/categories')
  await page.getByRole('button', { name: 'Nueva categoría' }).click()

  const create = page.getByRole('dialog', { name: 'Nueva categoría' })
  await create.getByRole('textbox', { name: 'Nombre en español' }).fill(name)
  await create.getByRole('textbox', { name: 'Nombre en inglés' }).fill(nameEn)
  await create.getByRole('textbox', { name: 'Nombre en portugués' }).fill(namePt)
  await fillColor(create.getByRole('textbox', { name: 'Color', exact: true }), '#0e7490')
  await pickIcon(create, 'nadar', 'swimming')
  await create.getByRole('button', { name: 'Crear categoría' }).click()
  await expect(toasts(page).getByText(`Categoría «${name}» creada.`)).toBeVisible()
  await expect(create).toBeHidden()

  const list = page.getByRole('grid', { name: 'Categorías (arrastra para ordenar)' })
  const row = list.getByRole('row', { name })
  await expect(row).toContainText(nameEn)
  await expect(row).toContainText(namePt)
  await expect(row).toContainText('#0e7490')
  await expect(row).toContainText('swimming')
  let saved = (await getJson<CategoryOut[]>(page.request, '/api/categories')).find((category) => category.name_es === name)
  expect(saved).toMatchObject({ name_en: nameEn, name_pt: namePt, color: '#0e7490', icon: 'swimming' })

  await row.getByRole('button', { name: `Editar ${name}` }).click()
  const edit = page.getByRole('dialog', { name: 'Editar categoría' })
  await expect(edit.getByRole('textbox', { name: 'Nombre en español' })).toHaveValue(name)
  await expect(edit.getByRole('textbox', { name: 'Nombre en portugués' })).toHaveValue(namePt)
  await fillColor(edit.getByRole('textbox', { name: 'Color', exact: true }), '#b45309')
  await pickIcon(edit, 'tarta', 'cake')
  await edit.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(toasts(page).getByText(`Categoría «${name}» guardada.`)).toBeVisible()
  await expect(edit).toBeHidden()
  await expect(row).toContainText('#b45309')
  await expect(row).toContainText('cake')
  saved = (await getJson<CategoryOut[]>(page.request, '/api/categories')).find((category) => category.name_es === name)
  expect(saved).toMatchObject({ name_pt: namePt, color: '#b45309', icon: 'cake' })

  // New categories go last; "Subir" moves it up one place and saves the order right away.
  const before = await categoryNames(page)
  expect(before.at(-1)).toBe(name)
  await row.getByRole('button', { name: `Subir ${name}` }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Orden guardado' })).toBeVisible()
  const expected = [...before.slice(0, -2), name, before.at(-2) ?? '']
  await expect.poll(() => categoryNames(page)).toEqual(expected)
  await expect.poll(() => list.getByRole('row').evaluateAll((rows) => rows.map((item) => item.getAttribute('aria-label')))).toEqual(expected)
  await page.reload()
  await expect(list.getByRole('row').nth(expected.length - 2)).toHaveAccessibleName(name)

  await list.getByRole('row', { name }).getByRole('button', { name: `Eliminar ${name}` }).click()
  const confirm = page.getByRole('alertdialog', { name: `¿Eliminar «${name}»?` })
  await confirm.getByRole('button', { name: 'Eliminar categoría' }).click()
  await expect(toasts(page).getByText(`Categoría «${name}» eliminada.`)).toBeVisible()
  await expect(list.getByRole('row', { name })).toHaveCount(0)
  expect(await categoryNames(page)).toEqual(before.slice(0, -1))
})

test('appearance: a year gets its own colour, which reaches the timeline, until it is removed', async ({ page }) => {
  const appearance = await getJson<AppearanceOut>(page.request, '/api/appearance')
  const year = appearance.event_years.at(-1)
  expect(year, 'a year with events').toBeDefined()
  if (year === undefined) return
  // Start from its automatic colour (a previous failed run may have left one).
  if (appearance.year_colors.some((item) => item.year === year)) await send(page.request, 'DELETE', `/api/admin/year-colors/${year}`)

  // Only the years with their own colour are listed; «Añadir año» suggests the ones with milestones.
  await page.goto('/admin/appearance')
  const section = page.getByRole('region', { name: 'Colores de los años' })
  const card = section.getByRole('article', { name: String(year) })
  await expect(section.getByRole('combobox', { name: 'Añadir año' })).toBeVisible()
  await expect(card).toHaveCount(0)
  await section.getByRole('button', { name: /^Mostrar sugerencias/ }).click()
  const option = page.getByRole('listbox', { name: /^Años con hitos/ }).getByRole('option', { name: String(year), exact: true })
  // React Aria reveals the list once it knows whether an on-screen keyboard opens (touch screens):
  // until then it is transparent and clipped, so wait until it really takes the click.
  await expect
    .poll(() =>
      option.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('[role="option"]') === element
      }),
    )
    .toBe(true)
  await option.click()
  const field = card.getByRole('textbox', { name: `Color de ${year}` })
  await expect(field).toBeFocused()
  await expect(card.getByText('Sin guardar')).toBeVisible()
  await expect(field).toHaveValue(/^#[0-9A-F]{6}$/i)
  const automatic = (await field.inputValue()).toLowerCase()
  const custom = automatic === '#0f766e' ? '#9d174d' : '#0f766e'

  await fillColor(field, custom)
  await card.getByRole('button', { name: `Guardar el color de ${year}` }).click()
  await expect(toasts(page).getByText(`Color de ${year} guardado.`)).toBeVisible()
  await expect(card.getByText('Sin guardar')).toHaveCount(0)
  await expect(field).toHaveValue(custom.toUpperCase())
  expect((await getJson<AppearanceOut>(page.request, '/api/appearance')).year_colors).toContainEqual({ year, color: custom })

  // The year's hub on the timeline uses it (the default theme paints chosen colours as they are).
  const [first] = await getJson<ChildOut[]>(page.request, '/api/children')
  await page.goto(`/c/${first.slug}?zoom=years`)
  const hub = timelineRegion(page, first.name).getByRole('button', { name: new RegExp(`^${year} · `) })
  await expect.poll(() => hub.evaluate((element) => getComputedStyle(element).getPropertyValue('--hub-color').trim())).toBe(custom)

  // Removing its colour takes it off the list: it goes back to the automatic one.
  await page.goto('/admin/appearance')
  await card.getByRole('button', { name: `Quitar el color de ${year}` }).click()
  await expect(toasts(page).getByText(`${year} vuelve a su color automático.`)).toBeVisible()
  await expect(card).toHaveCount(0)
  expect((await getJson<AppearanceOut>(page.request, '/api/appearance')).year_colors.map((item) => item.year)).not.toContain(year)
})

test('appearance: a child’s own colour paints their line on «Todos juntos»', async ({ page }) => {
  const [children, family] = await Promise.all([
    getJson<ChildOut[]>(page.request, '/api/children'),
    getJson<TimelineOut>(page.request, '/api/timeline'),
  ])
  test.skip(children.length < 2, 'the family timeline needs two children')
  // Only children with milestones get a line.
  const child = children.find((item) => family.events.some((event) => event.child_ids.includes(item.id)))
  expect(child, 'a child with milestones').toBeDefined()
  if (!child) return
  // Start from the automatic colour (a previous failed run may have left one).
  if (child.color !== null) await send(page.request, 'DELETE', `/api/admin/children/${child.id}/color`)
  const savedColor = async () => (await getJson<ChildOut[]>(page.request, '/api/children')).find((item) => item.id === child.id)?.color

  await page.goto('/admin/appearance')
  const row = page.getByRole('region', { name: 'Todos juntos' }).getByRole('article', { name: child.name })
  await expect(row.getByText('Automático')).toBeVisible()
  const field = row.getByRole('textbox', { name: `Color de la línea de ${child.name}` })
  await expect(field).toHaveValue(/^#[0-9A-F]{6}$/i)
  const automatic = (await field.inputValue()).toLowerCase()
  const custom = automatic === '#7c3aed' ? '#0f766e' : '#7c3aed'

  await fillColor(field, custom)
  await expect(row.getByText('Sin guardar')).toBeVisible()
  await row.getByRole('button', { name: `Guardar el color de la línea de ${child.name}` }).click()
  await expect(toasts(page).getByText(`Color de la línea de ${child.name} guardado.`)).toBeVisible()
  await expect(row.getByText('Personalizado')).toBeVisible()
  expect(await savedColor()).toBe(custom)

  // Their line on the family timeline is painted with it (the default theme keeps chosen colours).
  await page.goto('/all?zoom=events')
  const line = page.getByRole('region', { name: 'Línea de tiempo de todos juntos' }).locator(`path[data-lane="${child.id}"]`)
  await expect.poll(() => line.evaluate((element) => (element as SVGPathElement).style.getPropertyValue('--lane-color'))).toBe(custom)

  await page.goto('/admin/appearance')
  await row.getByRole('button', { name: `Quitar el color de la línea de ${child.name}` }).click()
  await expect(toasts(page).getByText(`La línea de ${child.name} vuelve a su color automático.`)).toBeVisible()
  await expect(row.getByText('Automático')).toBeVisible()
  await expect(field).toHaveValue(automatic.toUpperCase())
  expect(await savedColor()).toBeNull()
})

test('users: access with a temporary password, changed at the first sign-in, and reset by an admin', async ({ page, browser }, testInfo) => {
  const email = `abuela.${uniqueSuffix(testInfo)}@example.com`
  await page.goto('/admin/users')
  const form = page.getByRole('region', { name: 'Dar acceso a alguien' })
  await form.getByRole('textbox', { name: 'Correo' }).fill(email)
  await form.getByRole('textbox', { name: 'Nombre' }).fill('Abuela Carmen')
  await expect(form.getByRole('button', { name: /Rol/ })).toContainText('Lector')
  await form.getByRole('button', { name: 'Generar una contraseña temporal' }).click()
  // A generated password is shown, to pass it on.
  const temporary = await form.getByRole('textbox', { name: 'Contraseña temporal' }).inputValue()
  expect(temporary).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/)
  await form.getByRole('button', { name: 'Añadir' }).click()
  await expect(toasts(page).getByText(`Listo: ${email} ya puede entrar con su correo y la contraseña temporal.`)).toBeVisible()
  await expect(form.getByRole('textbox', { name: 'Correo' })).toHaveValue('')

  const table = page.getByRole('table', { name: 'Usuarios con acceso a Timelife' })
  const row = table.getByRole('row').filter({ hasText: email })
  await expect(row).toBeVisible()
  await expect(row.getByRole('button', { name: `Rol de ${email}` })).toContainText('Lector')
  await expect(row.getByRole('switch', { name: `Acceso activo de ${email}` })).toBeChecked()
  await expect(row.getByText('Contraseña temporal')).toBeVisible()
  const users = await getJson<UserOut[]>(page.request, '/api/admin/users')
  expect(users.find((user) => user.email === email)).toMatchObject({
    name: 'Abuela Carmen',
    role: 'viewer',
    disabled: false,
    has_password: true,
    must_change_password: true,
  })

  // Her first sign-in, on her own device: she chooses her password first.
  const device = await browser.newContext({ storageState: ANONYMOUS })
  const abuela = await device.newPage()
  await abuela.goto('/login')
  const signIn = abuela.getByRole('form', { name: 'Entrar con tu correo' })
  await signIn.getByRole('textbox', { name: 'Correo electrónico' }).fill(email)
  await signIn.getByLabel(/^Contraseña\*?$/).fill(temporary)
  await signIn.getByRole('button', { name: 'Entrar' }).click()
  const choose = abuela.getByRole('form', { name: 'Elige tu contraseña' })
  await expect(choose.getByText(email)).toBeVisible()
  await choose.getByLabel(/^Contraseña nueva\*?$/).fill('la frase de la abuela')
  await choose.getByLabel(/^Repite la contraseña\*?$/).fill('la frase de la abuela')
  await choose.getByRole('button', { name: 'Guardar y entrar' }).click()
  await expect(abuela).toHaveURL(/\/c\/[^/?]+$/)
  const menu = await openUserMenu(abuela)
  await expect(menu.getByText(email)).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Cambiar contraseña' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Administración' })).toHaveCount(0)

  await page.reload()
  await expect(row.getByText('Contraseña', { exact: true })).toBeVisible()

  // An administrator resets it: she is signed out everywhere and chooses another one next time.
  await row.getByRole('button', { name: `Restablecer la contraseña de ${email}` }).click()
  const dialog = page.getByRole('dialog', { name: `Contraseña temporal de ${email}` })
  await dialog.getByRole('button', { name: 'Generar una contraseña temporal' }).click()
  await dialog.getByRole('button', { name: 'Guardar contraseña' }).click()
  await expect(toasts(page).getByText(`Contraseña temporal de ${email} guardada: la cambiará al entrar.`)).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(row.getByText('Contraseña temporal')).toBeVisible()
  expect((await getJson<SessionOut>(abuela.request, '/api/auth/session')).authenticated).toBe(false)
  await device.close()

  // Tidy up: remove her access again.
  await row.getByRole('button', { name: `Eliminar a ${email}` }).click()
  const confirm = page.getByRole('alertdialog', { name: `¿Eliminar a ${email}?` })
  await confirm.getByRole('button', { name: 'Eliminar acceso' }).click()
  await expect(toasts(page).getByText(`${email} ya no tiene acceso.`)).toBeVisible()
  await expect(row).toHaveCount(0)
})

// Milestones of these tests belong to the second child: the read-only suites (running in parallel)
// check the first child's timeline.
async function secondChild(page: Page): Promise<ChildOut> {
  const children = await getJson<ChildOut[]>(page.request, '/api/children')
  return children[1] ?? children[0]
}

/** A milestone of the second child (first category) created through the API. */
async function addEvent(page: Page, title: string, date: string, images: Pick<ImageOut, 'id' | 'name'>[] = []): Promise<EventOut> {
  const child = await secondChild(page)
  const [category] = await getJson<CategoryOut[]>(page.request, '/api/categories')
  return send<EventOut>(page.request, 'POST', '/api/admin/events', {
    title,
    date,
    child_ids: [child.id],
    category_ids: [category.id],
    images: images.map(({ id, name }) => ({ id, name })),
  })
}

/** Trash and purge (leaves no trace for the other suites). */
async function removeEvent(page: Page, id: number): Promise<void> {
  await send(page.request, 'DELETE', `/api/admin/events/${id}`)
  await send(page.request, 'DELETE', `/api/admin/trash/${id}`)
}

test('events: filter by dates and choose which milestone of a day comes first', async ({ page }, testInfo) => {
  const suffix = uniqueSuffix(testInfo)
  const date = '2023-03-14'
  const morning = await addEvent(page, `Por la mañana ${suffix}`, date)
  const evening = await addEvent(page, `Por la tarde ${suffix}`, date)
  const child = await secondChild(page)
  const timelineOrder = async () =>
    (await getJson<TimelineOut>(page.request, `/api/children/${child.id}/timeline?date_from=${date}&date_to=${date}`)).events
      .map((event) => event.title)
      .filter((title) => title.endsWith(suffix))

  await page.goto(`/admin/events?q=${suffix}&from=${date}&to=${date}`)
  await expect(page.getByRole('button', { name: 'Filtrar por fecha: 14 mar 2023 – 14 mar 2023' })).toBeVisible()
  await expect(page.getByText('Mismo día · 14 mar 2023')).toBeVisible()
  const day = page.getByRole('grid', { name: 'Eventos del 14 mar 2023 (arrastra para ordenar)' })
  const rows = day.getByRole('row')
  // A new milestone goes first of its day.
  await expect(rows).toHaveText([new RegExp(escapeRegExp(evening.title)), new RegExp(escapeRegExp(morning.title))])
  expect(await timelineOrder()).toEqual([evening.title, morning.title])

  await day.getByRole('button', { name: `Subir «${morning.title}» (sale antes)` }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Orden guardado' })).toBeVisible()
  await expect(rows).toHaveText([new RegExp(escapeRegExp(morning.title)), new RegExp(escapeRegExp(evening.title))])
  await expect.poll(timelineOrder).toEqual([morning.title, evening.title])

  await page.getByRole('button', { name: /^Filtrar por fecha:/ }).click()
  const dates = page.getByRole('dialog', { name: 'Filtrar por fecha' })
  await dates.getByRole('button', { name: 'Quitar fechas' }).click()
  await expect(page).toHaveURL(`/admin/events?q=${suffix}`)
  await expect(dates).toBeHidden()
  await expect(page.getByRole('button', { name: 'Filtrar por fecha: Todas las fechas' })).toBeFocused()

  await removeEvent(page, morning.id)
  await removeEvent(page, evening.id)
})

test('timeline: administrators add a milestone with the floating button', async ({ page }, testInfo) => {
  const title = `Primera excursión ${uniqueSuffix(testInfo)}`
  const child = await secondChild(page)
  const [category] = await getJson<CategoryOut[]>(page.request, '/api/categories')
  await page.goto(`/c/${child.slug}?zoom=months`)
  await page.getByRole('link', { name: 'Nuevo hito' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo hito' })
  await expect(dialog.getByRole('heading', { name: 'Nuevo evento' })).toBeVisible()
  // The timeline's child comes chosen.
  const children = dialog.getByRole('group', { name: 'Niños' })
  await expect(children.getByRole('button', { name: child.name, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('textbox', { name: 'Título' }).fill(title)
  await dialog.getByRole('group', { name: 'Categorías' }).getByRole('button', { name: `Añadir ${category.name_es}` }).click()
  // Slowed animations: the timeline must open even while the editor's modal is still animating
  // out (it keeps rendering its unsaved-changes guard with its last props until it is gone).
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Animation.enable')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 })
  await dialog.getByRole('button', { name: 'Crear evento' }).click()

  await expect(toasts(page).getByText(`«${title}» se ha creado.`)).toBeVisible()
  const [created] = (await getJson<EventPageOut>(page.request, `/api/admin/events?q=${encodeURIComponent(title)}`)).items
  expect(created).toMatchObject({ title, child_ids: [child.id], category_ids: [category.id] })
  // Back on the timeline, at the days level, on the new milestone.
  await expect(page).toHaveURL(`/c/${child.slug}?zoom=events&focus=e${created.id}`)
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 })
  await expect(dialog).toBeHidden()
  await expect(timelineRegion(page, child.name).getByRole('link', { name: new RegExp(`^${escapeRegExp(title)} · `) })).toBeVisible()
  await removeEvent(page, created.id)
})

test('events: the cover is framed (zoomed and moved) for the timeline circle', async ({ page }, testInfo) => {
  const upload = await page.request.post('/api/admin/uploads?purpose=event', {
    headers: MUTATION_HEADERS,
    multipart: { file: { name: 'amanecer.jpg', mimeType: 'image/jpeg', buffer: readFileSync(fixture('amanecer.jpg')) } },
  })
  expect(upload.status()).toBe(201)
  const image = (await upload.json()) as ImageOut
  const event = await addEvent(page, `Amanecer ${uniqueSuffix(testInfo)}`, '2023-03-15', [image])
  expect(event.images[0]).toMatchObject({ id: image.id, crop: null })

  await page.goto(`/admin/events/${event.id}`)
  await page.getByRole('button', { name: 'Ajustar encuadre' }).click()
  const dialog = page.getByRole('dialog', { name: 'Encuadre de la portada' })
  await expect(dialog.getByRole('img', { name: `Encuadre de «${image.name}»` })).toBeVisible()
  await dialog.getByRole('slider', { name: 'Zoom' }).focus()
  await page.keyboard.press('End')
  await expect(dialog.getByRole('slider', { name: 'Zoom' })).toHaveAttribute('aria-valuetext', /^400\s%$/)
  await dialog.getByRole('button', { name: 'Mover a la izquierda' }).click()
  await dialog.getByRole('button', { name: 'Aplicar' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Cambios sin guardar')).toBeVisible()
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(toasts(page).getByText('Cambios guardados.')).toBeVisible()

  const [saved] = (await getJson<EventOut>(page.request, `/api/admin/events/${event.id}`)).images
  expect(saved.crop?.zoom).toBe(4)
  expect(saved.thumb_url).toMatch(/\/thumb\?v=[0-9a-f]{12}$/)
  // The framed thumbnail the timeline shows is rendered on demand.
  const thumb = await page.request.get(saved.thumb_url)
  expect(thumb.status()).toBe(200)
  expect(thumb.headers()['content-type']).toBe('image/webp')
  await removeEvent(page, event.id)
})

/** Ids of every event, the trash included. */
async function allEventIds(page: Page): Promise<Set<number>> {
  const ids = new Set<number>()
  for (let pageNumber = 1; ; pageNumber += 1) {
    const listed = await getJson<EventPageOut>(page.request, `/api/admin/events?page_size=100&page=${pageNumber}`)
    for (const item of listed.items) ids.add(item.id)
    if (pageNumber * listed.page_size >= listed.total) break
  }
  for (const item of await getJson<TrashItemOut[]>(page.request, '/api/admin/trash')) ids.add(item.id)
  return ids
}

test('backup: download a copy and merge it back, which brings a deleted milestone back', async ({ page }, testInfo) => {
  const upload = await page.request.post('/api/admin/uploads?purpose=event', {
    headers: MUTATION_HEADERS,
    multipart: { file: { name: 'amanecer.jpg', mimeType: 'image/jpeg', buffer: readFileSync(fixture('amanecer.jpg')) } },
  })
  expect(upload.status()).toBe(201)
  const title = `Copia ${uniqueSuffix(testInfo)}`
  const event = await addEvent(page, title, '2023-03-16', [(await upload.json()) as ImageOut])

  await page.goto('/admin/backup')
  await expect(page.getByRole('heading', { level: 1, name: 'Importar y exportar' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Contenido de la copia' })).toContainText(/\d+ hitos/)
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Descargar copia' }).click()
  const archive = testInfo.outputPath('timelife.zip')
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^timelife-\d{4}-\d{2}-\d{2}\.zip$/)
  await file.saveAs(archive)
  const bytes = readFileSync(archive)
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from('PK\u0003\u0004', 'latin1'))
  // The photos are in folders by year and milestone.
  expect(bytes.includes(Buffer.from(`events/2023/2023-03-16 ${title}/amanecer.jpg`))).toBe(true)

  await removeEvent(page, event.id)
  const before = await allEventIds(page)
  try {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Elegir archivo ZIP' }).click()
    await (await chooser).setFiles(archive)
    await expect(page.getByText(/^Copia del /)).toBeVisible()
    await expect(page.getByRole('radio', { name: /^Fusionar/ })).toBeChecked()
    await page.getByRole('button', { name: 'Importar', exact: true }).click()
    await expect(page.getByText('Importación terminada')).toBeVisible({ timeout: 60_000 })
    const milestones = page.getByRole('table', { name: 'Resultado de la importación' }).getByRole('row', { name: /^Hitos/ })
    await expect(milestones.getByRole('cell').first()).not.toHaveText('0')
    const [restored] = (await getJson<EventPageOut>(page.request, `/api/admin/events?q=${encodeURIComponent(title)}`)).items
    expect(restored).toMatchObject({ title, image_count: 1 })
    expect(restored.id).not.toBe(event.id)
    await page.getByRole('button', { name: 'Cerrar' }).click()
    await expect(page.getByRole('button', { name: 'Elegir archivo ZIP' })).toBeVisible()
  } finally {
    // Whatever the import brought back (our milestone, and any another suite deleted meanwhile).
    for (const id of await allEventIds(page)) {
      if (before.has(id)) continue
      const created = await getJson<EventOut>(page.request, `/api/admin/events/${id}`)
      if (created.deleted_at === null) await send(page.request, 'DELETE', `/api/admin/events/${id}`)
      await send(page.request, 'DELETE', `/api/admin/trash/${id}`)
    }
  }
})