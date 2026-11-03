import type { ChildOut, SessionOut } from '../src/api/schema.gen'
import { BASE_URL } from './server'
import { ANONYMOUS, DEV_PASSWORD, expect, expectInstallable, getJson, openUserMenu, storageStateOf, test, timelineRegion } from './support'

test.describe('signed out', () => {
  test.use({ storageState: ANONYMOUS })

  test('protected pages send anonymous visitors to the login page', async ({ page }) => {
    await page.goto('/admin/events')
    await expect(page).toHaveURL('/login?next=%2Fadmin%2Fevents')
    await expect(page.getByRole('heading', { name: 'Timelife', level: 1 })).toBeVisible()
    await expect(page.getByText('Los hitos de nuestra familia')).toBeVisible()
    await expect(page.getByRole('form', { name: 'Acceso de desarrollo' })).toBeVisible()
    // E-mail and password always; no Google client in the e2e server, so no Google button.
    await expect(page.getByRole('form', { name: 'Entrar con tu correo' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continuar con Google' })).toHaveCount(0)
    // No SMTP server either: no "forgot password" link.
    await expect(page.getByRole('button', { name: '¿Has olvidado tu contraseña?' })).toHaveCount(0)
    expect((await getJson<SessionOut>(page.request, '/api/auth/session')).authenticated).toBe(false)
  })

  test('the login page can be installed as an app, without a session', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Timelife', level: 1 })).toBeVisible()
    await expectInstallable(page)
  })

  test('the admin signs in, lands on the first child and signs out', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/login')
    const form = page.getByRole('form', { name: 'Acceso de desarrollo' })
    await expect(form.getByRole('radio', { name: 'Administrador' })).toBeChecked()
    await form.getByLabel('Contraseña').fill(DEV_PASSWORD)
    await form.getByRole('button', { name: 'Entrar' }).click()

    await expect(page).toHaveURL(/\/c\/[^/?]+$/)
    const [first] = await getJson<ChildOut[]>(page.request, '/api/children')
    await expect(page).toHaveURL(`/c/${first.slug}`)
    await expect(timelineRegion(page, first.name)).toBeVisible()
    await expect(page.getByRole('button', { name: `Cambiar de niño: ${first.name}` })).toBeVisible()

    const menu = await openUserMenu(page)
    await expect(menu.getByText('dev-admin@example.com')).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Administración' })).toBeVisible()
    await menu.getByRole('button', { name: 'Cerrar sesión' }).click()

    // An explicit sign-out lands on the plain login page (no ?next= back to the page left).
    await expect(page).toHaveURL('/login')
    await expect(page.getByRole('form', { name: 'Acceso de desarrollo' })).toBeVisible()
    expect((await getJson<SessionOut>(page.request, '/api/auth/session')).authenticated).toBe(false)
    // The session is gone for good: protected pages ask to sign in again.
    await page.goto(`/c/${first.slug}`)
    await expect(page).toHaveURL(`/login?next=%2Fc%2F${first.slug}`)
  })

  test('the viewer signs in and is sent back to the page they asked for', async ({ page, playwright }) => {
    // A deep link to a timeline other than the default one.
    const api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: storageStateOf('viewer') })
    const children = await getJson<ChildOut[]>(api, '/api/children')
    await api.dispose()
    const child = children[1] ?? children[0]
    const target = `/c/${child.slug}?zoom=years`

    await page.goto(target)
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(target)}`)
    const form = page.getByRole('form', { name: 'Acceso de desarrollo' })
    await form.getByRole('radio', { name: 'Lector' }).click()
    await expect(form.getByRole('radio', { name: 'Lector' })).toBeChecked()
    await form.getByLabel('Contraseña').fill(DEV_PASSWORD)
    await form.getByRole('button', { name: 'Entrar' }).click()

    await expect(page).toHaveURL(target)
    await expect(timelineRegion(page, child.name).getByRole('radio', { name: 'Años' })).toBeChecked()
    const session = await getJson<SessionOut>(page.request, '/api/auth/session')
    expect(session.user).toMatchObject({ email: 'dev-viewer@example.com', role: 'viewer' })
  })
})

test.describe('viewer', () => {
  test.use({ storageState: storageStateOf('viewer') })

  test('cannot reach the admin panel', async ({ page }) => {
    const [first] = await getJson<ChildOut[]>(page.request, '/api/children')
    for (const path of ['/admin', '/admin/events/new', '/admin/users']) {
      await page.goto(path)
      await expect(page).toHaveURL(`/c/${first.slug}`)
      await expect(timelineRegion(page, first.name)).toBeVisible()
    }
    const menu = await openUserMenu(page)
    await expect(menu.getByText('Lector', { exact: true })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Administración' })).toHaveCount(0)
    // The API enforces it too.
    expect((await page.request.get('/api/admin/users')).status()).toBe(403)
  })

  test('sees no edit button in the event detail', async ({ page }) => {
    const [first] = await getJson<ChildOut[]>(page.request, '/api/children')
    await page.goto(`/c/${first.slug}?zoom=events`)
    const event = timelineRegion(page, first.name).getByRole('link').first()
    const title = (await event.getAttribute('aria-label'))?.split(' · ')[0] ?? ''
    expect(title).not.toBe('')
    await event.click()
    const dialog = page.getByRole('dialog', { name: title })
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cerrar' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Editar hito' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cerrar' }).click()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(`/c/${first.slug}?zoom=events`)
  })
})
