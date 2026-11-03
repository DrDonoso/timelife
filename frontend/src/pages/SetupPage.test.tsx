import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SessionOut } from '../api/schema.gen'
import { ADMIN_SESSION, ANONYMOUS_SESSION, AUTH_CONFIG, mockApi, renderApp, reply, type MockRequest } from '../utils/test-utils'

const TOKEN = 'cd'.repeat(32)

function mockSetup(answer: (request: MockRequest) => unknown) {
  let session: SessionOut = ANONYMOUS_SESSION
  const handler = vi.fn((request: MockRequest) => {
    const result = answer(request)
    if (result === ADMIN_SESSION) session = ADMIN_SESSION
    return result
  })
  mockApi({
    'GET /api/auth/session': () => session,
    'GET /api/auth/config': AUTH_CONFIG,
    'GET /api/children': [],
    'POST /api/auth/setup': handler,
  })
  return handler
}

async function fill(form: HTMLElement) {
  const user = userEvent.setup()
  await user.type(within(form).getByRole('textbox', { name: /Correo electrónico/ }), 'ada@example.com')
  await user.type(within(form).getByLabelText(/^Contraseña nueva/), 'la nueva de ada')
  await user.type(within(form).getByLabelText(/^Repite la contraseña/), 'la nueva de ada')
  await user.click(within(form).getByRole('button', { name: 'Guardar y entrar' }))
}

describe('SetupPage', () => {
  it('recovers the administration with the link of the setup command', async () => {
    const setup = mockSetup(() => ADMIN_SESSION)
    const { router } = renderApp(`/setup#${TOKEN}`)
    const form = await screen.findByRole('form', { name: 'Recupera la administración' })
    expect(within(form).getByText(/si el correo ya tiene cuenta, elige su nueva contraseña/)).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    await fill(form)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(setup.mock.calls[0][0].body).toEqual({ email: 'ada@example.com', password: 'la nueva de ada', name: null, token: TOKEN })
  })

  it('explains an expired or used link', async () => {
    mockSetup(() => reply(403, { code: 'setup_closed' }))
    renderApp(`/setup#${TOKEN}`)
    await fill(await screen.findByRole('form', { name: 'Recupera la administración' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace ya no sirve: ha caducado o ya se ha usado.')
    expect(screen.getByRole('link', { name: 'Ir a iniciar sesión' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('refuses a link without a valid code', async () => {
    mockSetup(() => ADMIN_SESSION)
    renderApp('/setup')
    expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace de recuperación no es válido o está incompleto.')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })
})
