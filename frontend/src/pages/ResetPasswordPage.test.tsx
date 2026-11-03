import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SessionOut } from '../api/schema.gen'
import { ANONYMOUS_SESSION, AUTH_CONFIG, mockApi, renderApp, reply, type MockRequest } from '../utils/test-utils'

const TOKEN = 'ab'.repeat(32)
const SIGNED_IN: SessionOut = {
  authenticated: true,
  user: { id: 4, email: 'ana@example.com', name: 'Ana', role: 'viewer', has_password: true },
}

function mockReset(answer: (request: MockRequest) => unknown) {
  let session: SessionOut = ANONYMOUS_SESSION
  const handler = vi.fn((request: MockRequest) => {
    const result = answer(request)
    if (result === SIGNED_IN) session = SIGNED_IN
    return result
  })
  mockApi({
    'GET /api/auth/session': () => session,
    'GET /api/auth/config': AUTH_CONFIG,
    'GET /api/children': [],
    'POST /api/auth/password/reset': handler,
  })
  return handler
}

describe('ResetPasswordPage', () => {
  it('chooses a new password with the e-mailed link and signs in', async () => {
    const reset = mockReset(() => SIGNED_IN)
    const user = userEvent.setup()
    const { router } = renderApp(`/reset-password#${TOKEN}`)
    const form = await screen.findByRole('form', { name: 'Elige una contraseña nueva' })
    // The code leaves the address bar once read.
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(router.state.location.pathname).toBe('/reset-password')

    const next = within(form).getByLabelText(/^Contraseña nueva/)
    expect(next).toHaveFocus()
    await user.type(next, 'mi frase nueva')
    await user.type(within(form).getByLabelText(/^Repite la contraseña/), 'otra cosa')
    await user.click(within(form).getByRole('button', { name: 'Guardar y entrar' }))
    expect(within(form).getByText('Las dos contraseñas no coinciden.')).toBeInTheDocument()
    expect(reset).not.toHaveBeenCalled()

    await user.clear(within(form).getByLabelText(/^Repite la contraseña/))
    await user.type(within(form).getByLabelText(/^Repite la contraseña/), 'mi frase nueva')
    await user.click(within(form).getByRole('button', { name: 'Guardar y entrar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(reset.mock.calls[0][0].body).toEqual({ token: TOKEN, new_password: 'mi frase nueva' })
  })

  it('explains an expired or used link', async () => {
    mockReset(() => reply(400, { code: 'password_reset_invalid' }))
    const user = userEvent.setup()
    renderApp(`/reset-password#${TOKEN}`)
    const form = await screen.findByRole('form', { name: 'Elige una contraseña nueva' })
    await user.type(within(form).getByLabelText(/^Contraseña nueva/), 'mi frase nueva')
    await user.type(within(form).getByLabelText(/^Repite la contraseña/), 'mi frase nueva')
    await user.click(within(form).getByRole('button', { name: 'Guardar y entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace ha caducado o ya se ha usado.')
    expect(screen.getByRole('link', { name: 'Ir a iniciar sesión' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('shows other errors above the form', async () => {
    mockReset(() => reply(403, { code: 'account_disabled' }))
    const user = userEvent.setup()
    renderApp(`/reset-password#${TOKEN}`)
    const form = await screen.findByRole('form', { name: 'Elige una contraseña nueva' })
    await user.type(within(form).getByLabelText(/^Contraseña nueva/), 'mi frase nueva')
    await user.type(within(form).getByLabelText(/^Repite la contraseña/), 'mi frase nueva')
    await user.click(within(form).getByRole('button', { name: 'Guardar y entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu cuenta está desactivada.')
    expect(screen.getByRole('form', { name: 'Elige una contraseña nueva' })).toBeInTheDocument()
  })

  it.each(['', '#corto', `#${TOKEN.toUpperCase()}`])('refuses a link without a valid code (%s)', async (hash) => {
    mockReset(() => SIGNED_IN)
    renderApp(`/reset-password${hash}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace no es válido: puede que esté incompleto.')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })
})
