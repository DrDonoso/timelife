import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { SessionOut } from '../api/schema.gen'
import { UserMenu } from '../shell/UserMenu'
import { ADMIN_SESSION, mockSignedIn, renderWithProviders, reply, type MockHandler } from '../utils/test-utils'

const GOOGLE_ONLY: SessionOut = {
  authenticated: true,
  user: { id: 3, email: 'leo@example.com', name: 'Leo', role: 'viewer', has_password: false },
}

function setup(handler: MockHandler, session: SessionOut = ADMIN_SESSION) {
  const fetchMock = mockSignedIn(session, { 'POST /api/auth/password': handler })
  renderWithProviders(<UserMenu />)
  return { fetchMock, user: userEvent.setup() }
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Menú de usuario/ }))
  await user.click(await screen.findByRole('button', { name: 'Cambiar contraseña' }))
  return screen.findByRole('dialog', { name: 'Cambiar tu contraseña' })
}

async function fill(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, current: string, next: string, repeat = next) {
  await user.type(within(dialog).getByLabelText(/^Contraseña actual/), current)
  await user.type(within(dialog).getByLabelText(/^Contraseña nueva/), next)
  await user.type(within(dialog).getByLabelText(/^Repite la contraseña/), repeat)
  await user.click(within(dialog).getByRole('button', { name: 'Cambiar contraseña' }))
}

describe('ChangePasswordDialog', () => {
  it('changes your password from the user menu', async () => {
    const { fetchMock, user } = setup(() => ADMIN_SESSION)
    const dialog = await openDialog(user)
    expect(within(dialog).getByText(/Se cerrará la sesión en tus otros dispositivos/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^Contraseña actual/)).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Cambiar contraseña' }))
    // The current and the new password are both missing.
    expect(within(dialog).getAllByText('Escribe la contraseña.')).toHaveLength(2)
    await fill(user, dialog, 'la de antes', 'la de antes')
    expect(within(dialog).getByText('Elige una contraseña distinta de la actual.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

    await user.clear(within(dialog).getByLabelText(/^Contraseña nueva/))
    await user.type(within(dialog).getByLabelText(/^Contraseña nueva/), 'la de ahora')
    await user.clear(within(dialog).getByLabelText(/^Repite la contraseña/))
    await user.type(within(dialog).getByLabelText(/^Repite la contraseña/), 'la de ahora')
    await user.click(within(dialog).getByRole('button', { name: 'Cambiar contraseña' }))
    expect(await screen.findByText('Contraseña cambiada. Se ha cerrado la sesión en tus otros dispositivos.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const [, init] = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST') ?? []
    expect(JSON.parse(String(init?.body))).toEqual({ current_password: 'la de antes', new_password: 'la de ahora' })
  })

  it.each([
    [reply(422, { code: 'current_password_invalid' }), 'La contraseña actual no es correcta.'],
    [reply(422, { code: 'password_unchanged' }), 'Elige una contraseña distinta de la actual.'],
    [reply(429, { code: 'login_throttled' }), 'Demasiados intentos de acceso. Espera unos minutos y vuelve a intentarlo.'],
  ])('shows the answer of the server', async (answer, message) => {
    const { user } = setup(answer)
    const dialog = await openDialog(user)
    await fill(user, dialog, 'la de antes', 'la de ahora')
    expect(await within(dialog).findByText(message)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('is not offered to accounts without a password', async () => {
    const { user } = setup(() => GOOGLE_ONLY, GOOGLE_ONLY)
    await user.click(await screen.findByRole('button', { name: /Menú de usuario/ }))
    expect(await screen.findByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cambiar contraseña' })).not.toBeInTheDocument()
  })
})
