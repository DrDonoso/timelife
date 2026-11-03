import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserOut } from '../../api/schema.gen'
import { ADMIN_SESSION, AUTH_CONFIG, mockSignedIn, renderWithProviders, reply, type MockHandler } from '../../utils/test-utils'
import { sentBodies } from '../categories/testing'
import { relativeTime } from './relativeTime'
import { UsersPage } from './UsersPage'

const NOW = new Date('2026-10-20T12:00:00Z').getTime()
const GENERATED = /^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/

function user(overrides: Partial<UserOut> & Pick<UserOut, 'id' | 'email'>): UserOut {
  return {
    name: null,
    role: 'viewer',
    disabled: false,
    google_linked: false,
    has_password: true,
    must_change_password: false,
    created_at: '2026-01-01T10:00:00Z',
    last_login_at: null,
    ...overrides,
  }
}

const USERS: UserOut[] = [
  user({ id: 7, email: 'boss@example.com', role: 'admin', has_password: false, google_linked: true, last_login_at: '2026-10-19T12:00:00Z' }),
  user({ id: 1, email: 'ada@example.com', name: 'Ada Admin', role: 'admin', last_login_at: '2026-10-20T11:55:00Z' }),
  user({ id: 3, email: 'papa@example.com', role: 'admin' }),
  user({ id: 4, email: 'abuela@example.com', name: 'Abuela Carmen', last_login_at: '2026-10-10T09:00:00Z' }),
  user({ id: 5, email: 'tia@example.com', disabled: true, must_change_password: true }),
]

function setup(handlers: Record<string, MockHandler> = {}, { google = true, initial = USERS }: { google?: boolean; initial?: UserOut[] } = {}) {
  let users = initial.map((item) => ({ ...item }))
  const fetchMock = mockSignedIn(ADMIN_SESSION, {
    'GET /api/auth/config': { ...AUTH_CONFIG, google_enabled: google },
    'GET /api/admin/users': () => users,
    ...handlers,
  })
  const events = userEvent.setup()
  const view = renderWithProviders(<UsersPage />, { route: '/admin/users' })
  return {
    ...view,
    fetchMock,
    user: events,
    setUsers(next: UserOut[]) {
      users = next
    },
  }
}

function row(email: string) {
  const cell = screen.getByText(email)
  const tr = cell.closest('tr')
  if (!tr) throw new Error(`row for ${email} not found`)
  return tr
}

function form() {
  return screen.getByRole('region', { name: 'Dar acceso a alguien' })
}

afterEach(() => {
  window.innerWidth = 1024
})

describe('UsersPage', () => {
  it('lists every user with how they sign in (Google configured)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    try {
      setup()
      expect(await screen.findByRole('heading', { name: '5 personas' })).toBeInTheDocument()
      expect(screen.getByText(/Entrarán con «Continuar con Google» usando este correo/)).toBeInTheDocument()

      const abuela = row('abuela@example.com')
      expect(within(abuela).getByText('Abuela Carmen')).toBeInTheDocument()
      expect(within(abuela).getByRole('button', { name: /Rol de abuela@example.com/ })).toHaveTextContent('Lector')
      expect(within(abuela).getByRole('switch', { name: 'Acceso activo de abuela@example.com' })).toBeChecked()
      expect(within(abuela).getByText('Contraseña')).toHaveAttribute('title', 'Entra con su correo y su contraseña.')
      expect(within(abuela).getByText('Google pendiente')).toBeInTheDocument()
      expect(within(abuela).getByText('la semana pasada')).toHaveAttribute('dateTime', '2026-10-10T09:00:00Z')

      const tia = row('tia@example.com')
      expect(within(tia).getByText('Desactivado')).toBeInTheDocument()
      expect(within(tia).getByRole('switch')).not.toBeChecked()
      expect(within(tia).getByText('Contraseña temporal')).toHaveAttribute('title', 'Tiene que cambiarla la próxima vez que entre.')
      expect(within(tia).getByText('Nunca')).toBeInTheDocument()

      const boss = row('boss@example.com')
      expect(within(boss).getByText('Sin contraseña')).toHaveAttribute('title', 'Entra solo con Google.')
      expect(within(boss).getByText('Google')).toBeInTheDocument()
      expect(within(boss).getByText('ayer')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('without Google, only passwords count', async () => {
    setup({}, { google: false })
    await screen.findByRole('heading', { name: '5 personas' })
    expect(screen.getByText(/Ponle una contraseña temporal y díselo junto con su correo/)).toBeInTheDocument()
    expect(within(row('boss@example.com')).getByText('Sin contraseña')).toHaveAttribute(
      'title',
      'No puede entrar hasta que le pongas una contraseña.',
    )
    // Linked from when Google was configured; nobody is waiting for it now.
    expect(within(row('boss@example.com')).getByText('Google')).toBeInTheDocument()
    expect(screen.queryByText('Google pendiente')).not.toBeInTheDocument()
  })

  it('locks the signed-in admin, explaining why', async () => {
    setup()
    await screen.findByRole('heading', { name: '5 personas' })

    const me = row('ada@example.com')
    expect(within(me).getByText('Tú')).toBeInTheDocument()
    expect(within(me).getByRole('button', { name: /Rol de ada@example.com/ })).toBeDisabled()
    expect(within(me).getByRole('switch')).toBeDisabled()
    expect(within(me).queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument()
    expect(within(me).queryByRole('button', { name: /contraseña de/ })).not.toBeInTheDocument()
    expect(
      within(me).getByRole('button', {
        name: 'No puedes cambiar tu propio rol, desactivarte ni eliminarte. Tu contraseña la cambias desde tu menú.',
      }),
    ).toBeInTheDocument()

    const papa = row('papa@example.com')
    expect(within(papa).getByRole('button', { name: /Rol de papa@example.com/ })).toBeEnabled()
    expect(within(papa).getByRole('switch')).toBeEnabled()
    expect(within(papa).getByRole('button', { name: 'Restablecer la contraseña de papa@example.com' })).toBeEnabled()
    expect(within(papa).getByRole('button', { name: 'Eliminar a papa@example.com' })).toBeEnabled()
    // Nobody is locked any more: no fixed administrators.
    expect(within(row('boss@example.com')).getByRole('button', { name: 'Poner una contraseña a boss@example.com' })).toBeEnabled()
    expect(within(row('boss@example.com')).getByRole('switch')).toBeEnabled()
  })

  it('gives someone access with a temporary password (no Google)', async () => {
    const created = user({ id: 9, email: 'tio@example.com', name: 'Tío Juan', must_change_password: true })
    const { user: events, fetchMock, setUsers } = setup(
      {
        'POST /api/admin/users': () => {
          setUsers([...USERS, created])
          return reply(201, created)
        },
      },
      { google: false },
    )
    const email = await screen.findByRole('textbox', { name: 'Correo' })
    const password = within(form()).getByLabelText(/^Contraseña temporal/)
    const add = screen.getByRole('button', { name: 'Añadir' })

    await events.click(add)
    expect(screen.getByText('Escribe el correo de la persona.')).toBeInTheDocument()
    expect(screen.getByText('Escribe la contraseña.')).toBeInTheDocument()
    await events.click(email)
    await events.paste('no-es-un-correo')
    await events.click(add)
    expect(screen.getByText('Escribe un correo válido, por ejemplo nombre@ejemplo.com.')).toBeInTheDocument()
    await events.clear(email)
    await events.paste('Abuela@Example.com')
    await events.click(add)
    expect(screen.getByText('Este correo ya tiene acceso.')).toBeInTheDocument()
    await events.clear(email)
    await events.paste('  Tio@Example.com ')
    await events.type(password, 'corta')
    await events.click(add)
    expect(screen.getByText('Debe tener al menos 8 caracteres.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST', '/api/admin/users')).toHaveLength(0)

    await events.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Tío Juan')
    await events.click(within(form()).getByRole('button', { name: 'Generar una contraseña temporal' }))
    // Generated passwords are shown, to pass them on.
    expect(password).toHaveAttribute('type', 'text')
    expect((password as HTMLInputElement).value).toMatch(GENERATED)
    const generated = (password as HTMLInputElement).value
    await events.click(add)

    expect(await screen.findByText('Listo: tio@example.com ya puede entrar con su correo y la contraseña temporal.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST', '/api/admin/users')).toEqual([
      { email: 'tio@example.com', role: 'viewer', name: 'Tío Juan', password: generated },
    ])
    expect(email).toHaveValue('')
    expect(password).toHaveValue('')
    expect(email).toHaveFocus()
    expect(await screen.findByText('tio@example.com')).toBeInTheDocument()
  })

  it('with Google the password is optional', async () => {
    const created = user({ id: 9, email: 'nuevo@gmail.com', role: 'admin', has_password: false })
    const { user: events, fetchMock } = setup({ 'POST /api/admin/users': reply(201, created) })
    await events.type(await screen.findByRole('textbox', { name: 'Correo' }), 'nuevo@gmail.com')
    await events.click(within(form()).getByRole('button', { name: /Rol/ }))
    await events.click(await screen.findByRole('option', { name: /Administrador/ }))
    await events.click(screen.getByRole('button', { name: 'Añadir' }))
    expect(await screen.findByText('Listo: nuevo@gmail.com ya puede entrar con Google.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST', '/api/admin/users')).toEqual([
      { email: 'nuevo@gmail.com', role: 'admin', name: null, password: null },
    ])
  })

  it.each([
    [reply(409, { code: 'user_exists' }), 'Correo', 'Este correo ya tiene acceso.'],
    [reply(422, { code: 'invalid_request', fields: { password: 'missing' } }), 'Contraseña temporal', 'Escribe la contraseña.'],
  ])('shows server errors of the form on their field', async (answer, label, message) => {
    const { user: events } = setup({ 'POST /api/admin/users': answer })
    await events.type(await screen.findByRole('textbox', { name: 'Correo' }), 'otra@gmail.com')
    await events.click(screen.getByRole('button', { name: 'Añadir' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(within(form()).getByLabelText(new RegExp(`^${label}`))).toHaveAttribute('aria-invalid', 'true')
  })

  it('gives a user a new temporary password', async () => {
    const reset = { ...USERS[3], must_change_password: true }
    const { user: events, fetchMock, setUsers } = setup({
      'PUT /api/admin/users/4/password': () => {
        setUsers(USERS.map((item) => (item.id === 4 ? reset : item)))
        return reset
      },
    })
    await screen.findByRole('heading', { name: '5 personas' })
    await events.click(within(row('abuela@example.com')).getByRole('button', { name: 'Restablecer la contraseña de abuela@example.com' }))
    const dialog = await screen.findByRole('dialog', { name: 'Contraseña temporal de abuela@example.com' })
    expect(within(dialog).getByText(/tendrá que cambiarla la primera vez que entre/)).toBeInTheDocument()
    const field = within(dialog).getByLabelText(/^Contraseña temporal/)
    expect(field).toHaveFocus()
    await events.type(field, '1234567')
    await events.click(within(dialog).getByRole('button', { name: 'Guardar contraseña' }))
    expect(within(dialog).getByText('Debe tener al menos 8 caracteres.')).toBeInTheDocument()
    await events.type(field, '8')
    await events.click(within(dialog).getByRole('button', { name: 'Guardar contraseña' }))

    expect(await screen.findByText('Contraseña temporal de abuela@example.com guardada: la cambiará al entrar.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/users/4/password')).toEqual([{ password: '12345678' }])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(row('abuela@example.com')).getByText('Contraseña temporal')).toBeInTheDocument()
  })

  it('shows the errors of a new password in its dialog', async () => {
    const { user: events } = setup({ 'PUT /api/admin/users/3/password': reply(404, { code: 'user_not_found' }) })
    await screen.findByRole('heading', { name: '5 personas' })
    await events.click(within(row('papa@example.com')).getByRole('button', { name: 'Restablecer la contraseña de papa@example.com' }))
    const dialog = await screen.findByRole('dialog')
    await events.click(within(dialog).getByRole('button', { name: 'Generar una contraseña temporal' }))
    await events.click(within(dialog).getByRole('button', { name: 'Guardar contraseña' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('El usuario ya no existe. Actualiza la lista.')
  })

  it('changes the role of a user', async () => {
    const { user: events, fetchMock } = setup({
      'PATCH /api/admin/users/4': ({ body }: { body: Partial<UserOut> }) => ({ ...USERS[3], ...body }),
    })
    await screen.findByRole('heading', { name: '5 personas' })
    await events.click(within(row('abuela@example.com')).getByRole('button', { name: /Rol de abuela@example.com/ }))
    await events.click(await screen.findByRole('option', { name: 'Administrador' }))
    expect(await screen.findByText('Rol de abuela@example.com cambiado a Administrador.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'PATCH', '/api/admin/users/4')).toEqual([{ role: 'admin' }])
  })

  it('disables and re-enables access', async () => {
    const { user: events, fetchMock } = setup({
      'PATCH /api/admin/users/3': ({ body }: { body: Partial<UserOut> }) => ({ ...USERS[2], ...body }),
      'PATCH /api/admin/users/5': ({ body }: { body: Partial<UserOut> }) => ({ ...USERS[4], ...body }),
    })
    await screen.findByRole('heading', { name: '5 personas' })
    await events.click(within(row('papa@example.com')).getByRole('switch'))
    expect(await screen.findByText('papa@example.com ya no puede entrar.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'PATCH', '/api/admin/users/3')).toEqual([{ disabled: true }])

    await events.click(within(row('tia@example.com')).getByRole('switch'))
    expect(await screen.findByText('tia@example.com vuelve a tener acceso.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'PATCH', '/api/admin/users/5')).toEqual([{ disabled: false }])
  })

  it.each([
    ['last_admin', 'Debe quedar al menos un administrador activo.'],
    ['cannot_modify_self', 'No puedes cambiar tu propio rol, desactivarte ni eliminarte.'],
    ['user_not_found', 'El usuario ya no existe. Actualiza la lista.'],
  ])('translates the %s error', async (code, message) => {
    const { user: events } = setup({ 'PATCH /api/admin/users/3': reply(code === 'user_not_found' ? 404 : 409, { code }) })
    await screen.findByRole('heading', { name: '5 personas' })
    const toggle = within(row('papa@example.com')).getByRole('switch')
    await events.click(toggle)
    expect(await screen.findByText(message)).toBeInTheDocument()
    // The control shows the real (unchanged) state again.
    await waitFor(() => expect(within(row('papa@example.com')).getByRole('switch')).toBeChecked())
  })

  it('removes a user after confirming', async () => {
    const { user: events, fetchMock, setUsers } = setup({
      'DELETE /api/admin/users/4': () => {
        setUsers(USERS.filter((item) => item.id !== 4))
        return reply(204)
      },
    })
    await screen.findByRole('heading', { name: '5 personas' })
    await events.click(within(row('abuela@example.com')).getByRole('button', { name: 'Eliminar a abuela@example.com' }))
    const dialog = await screen.findByRole('alertdialog', { name: '¿Eliminar a abuela@example.com?' })
    await events.click(within(dialog).getByRole('button', { name: 'Eliminar acceso' }))
    expect(await screen.findByText('abuela@example.com ya no tiene acceso.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'DELETE', '/api/admin/users/4')).toHaveLength(1)
    await waitFor(() => expect(screen.queryByText('Abuela Carmen')).not.toBeInTheDocument())
  })

  it('shows the delete error inside the confirmation', async () => {
    const { user: events } = setup({ 'DELETE /api/admin/users/3': reply(409, { code: 'last_admin' }) })
    await screen.findByRole('heading', { name: '5 personas' })
    await events.click(within(row('papa@example.com')).getByRole('button', { name: 'Eliminar a papa@example.com' }))
    const dialog = await screen.findByRole('alertdialog')
    await events.click(within(dialog).getByRole('button', { name: 'Eliminar acceso' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Debe quedar al menos un administrador activo.')
  })

  it('uses cards on phones', async () => {
    window.innerWidth = 390
    setup()
    await screen.findByRole('heading', { name: '5 personas' })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(5)
    const me = cards[1]
    expect(within(me).getByText(/No puedes cambiar tu propio rol, desactivarte ni eliminarte/)).toBeInTheDocument()
    expect(within(me).getByRole('switch', { name: 'Acceso activo de ada@example.com' })).toBeDisabled()
    expect(within(cards[4]).getByText('Contraseña temporal')).toBeInTheDocument()
  })
})

describe('relativeTime', () => {
  it('uses the largest unit that fits', () => {
    expect(relativeTime('2026-10-20T11:59:50Z', 'es-ES', NOW)).toBe('ahora')
    expect(relativeTime('2026-10-20T11:55:00Z', 'es-ES', NOW)).toBe('hace 5 minutos')
    expect(relativeTime('2026-10-20T09:00:00Z', 'es-ES', NOW)).toBe('hace 3 horas')
    expect(relativeTime('2026-10-19T12:00:00Z', 'es-ES', NOW)).toBe('ayer')
    expect(relativeTime('2026-08-20T12:00:00Z', 'en-GB', NOW)).toBe('2 months ago')
    expect(relativeTime('2024-10-20T12:00:00Z', 'en-GB', NOW)).toBe('2 years ago')
    expect(relativeTime('not a date', 'es-ES', NOW)).toBe('')
  })
})
