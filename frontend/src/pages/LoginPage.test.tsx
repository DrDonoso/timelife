import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AuthConfigOut, SessionOut } from '../api/schema.gen'
import { browserNavigation } from '../utils/navigation'
import { ADMIN_SESSION, ANONYMOUS_SESSION, AUTH_CONFIG, mockApi, renderApp, reply, type MockRequest } from '../utils/test-utils'
import { safeNextPath } from './LoginPage'

const SIGNED_IN: SessionOut = {
  authenticated: true,
  user: { id: 4, email: 'ana@example.com', name: 'Ana', role: 'viewer', has_password: true },
}

function mockLogin(config: Partial<AuthConfigOut> = {}, extra: Record<string, unknown> = {}) {
  return mockApi({
    'GET /api/auth/session': ANONYMOUS_SESSION,
    'GET /api/auth/config': { ...AUTH_CONFIG, ...config },
    ...extra,
  })
}

/** Login mock whose session becomes `session` once `endpoint` answers it. */
function mockSignIn(endpoint: string, answer: (request: MockRequest) => unknown, config: Partial<AuthConfigOut> = {}) {
  let session: SessionOut = ANONYMOUS_SESSION
  const handler = vi.fn((request: MockRequest) => {
    const result = answer(request)
    if (result && typeof result === 'object' && 'authenticated' in result) session = result as SessionOut
    return result
  })
  mockApi({
    'GET /api/auth/session': () => session,
    'GET /api/auth/config': { ...AUTH_CONFIG, ...config },
    'GET /api/children': [],
    [endpoint]: handler,
  })
  return handler
}

function emailForm() {
  return screen.getByRole('form', { name: 'Entrar con tu correo' })
}

describe('LoginPage', () => {
  it('shows the brand, Google and the e-mail form', async () => {
    mockLogin()
    renderApp('/login')
    expect(await screen.findByRole('heading', { level: 1, name: 'Timelife' })).toBeInTheDocument()
    expect(screen.getByText('Los hitos de nuestra familia')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Continuar con Google' })).toBeInTheDocument()
    expect(screen.getByRole('separator')).toHaveTextContent('o')
    expect(within(emailForm()).getByRole('textbox', { name: /Correo electrónico/ })).toHaveAttribute('autocomplete', 'username')
    expect(within(emailForm()).getByLabelText(/^Contraseña/)).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.queryByRole('button', { name: '¿Has olvidado tu contraseña?' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Acceso de desarrollo' })).not.toBeInTheDocument()
  })

  it('without Google, only e-mail and password', async () => {
    mockLogin({ google_enabled: false })
    renderApp('/login')
    expect(await screen.findByRole('form', { name: 'Entrar con tu correo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continuar con Google' })).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it.each([
    ['google_not_invited', 'Esta cuenta de Google no tiene acceso. Pide a un administrador que te invite con este correo.'],
    ['account_disabled', 'Tu cuenta está desactivada. Habla con un administrador.'],
    ['google_cancelled', 'Has cancelado el acceso con Google.'],
    ['something_else', 'No se ha podido completar la operación. Inténtalo de nuevo.'],
  ])('translates ?error=%s', async (code, message) => {
    mockLogin()
    renderApp(`/login?error=${code}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('translates errors in English too', async () => {
    localStorage.setItem('timelife.lang', 'en')
    mockLogin()
    renderApp('/login?error=google_not_invited')
    expect(await screen.findByRole('alert')).toHaveTextContent('This Google account has no access.')
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Sign in with your e-mail' })).toBeInTheDocument()
  })

  it('starts the Google flow with the return path and leaves the app', async () => {
    const assign = vi.spyOn(browserNavigation, 'assign').mockImplementation(() => {})
    const start = vi.fn((request: MockRequest) => {
      expect(request.headers.get('X-Timelife-Request')).toBe('1')
      return { authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }
    })
    mockLogin({}, { 'POST /api/auth/google/start': start })
    renderApp(`/login?next=${encodeURIComponent('/c/ana?zoom=months')}`)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continuar con Google' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'))
    expect(start.mock.calls[0][0].body).toEqual({ return_path: '/c/ana?zoom=months' })
  })

  it('shows Google start errors inline', async () => {
    mockLogin({}, { 'POST /api/auth/google/start': reply(503, { code: 'google_disabled' }) })
    renderApp('/login')
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continuar con Google' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El acceso con Google no está configurado en este servidor.')
  })

  it('signs in with e-mail and password and goes back to the page asked for', async () => {
    const login = mockSignIn('POST /api/auth/login', (request) => {
      const body = request.body as { password: string }
      return body.password === 'la buena' ? SIGNED_IN : reply(401, { code: 'invalid_credentials' })
    })
    const user = userEvent.setup()
    const { router } = renderApp('/login?next=%2Fall')
    const form = await screen.findByRole('form', { name: 'Entrar con tu correo' })
    const email = within(form).getByRole('textbox', { name: /Correo electrónico/ })
    const password = within(form).getByLabelText(/^Contraseña/)

    await user.click(within(form).getByRole('button', { name: 'Entrar' }))
    expect(within(form).getByText('Escribe tu correo.')).toBeInTheDocument()
    expect(within(form).getByText('Escribe la contraseña.')).toBeInTheDocument()
    await user.type(email, 'ana@')
    await user.type(password, 'la mala')
    await user.click(within(form).getByRole('button', { name: 'Entrar' }))
    expect(within(form).getByText('Escribe un correo válido, por ejemplo nombre@ejemplo.com.')).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()

    await user.type(email, 'Example.com')
    await user.click(within(form).getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El correo (o el usuario) o la contraseña no son correctos.')
    expect(login.mock.calls[0][0].body).toEqual({ email: 'ana@example.com', password: 'la mala' })

    // The password can be shown while typing it.
    await user.click(within(form).getByRole('button', { name: 'Mostrar contraseña' }))
    expect(password).toHaveAttribute('type', 'text')
    await user.clear(password)
    await user.type(password, 'la buena')
    await user.click(within(form).getByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/all'))
  })

  it('a temporary password is replaced before signing in', async () => {
    const login = mockSignIn('POST /api/auth/login', (request) => {
      const body = request.body as { password: string; new_password?: string }
      if (body.password !== 'temporal-1') return reply(401, { code: 'invalid_credentials' })
      if (!body.new_password) return reply(403, { code: 'password_change_required' })
      return SIGNED_IN
    })
    const user = userEvent.setup()
    const { router } = renderApp('/login')
    const form = await screen.findByRole('form', { name: 'Entrar con tu correo' })
    await user.type(within(form).getByRole('textbox', { name: /Correo electrónico/ }), 'Ana@Example.com')
    await user.type(within(form).getByLabelText(/^Contraseña/), 'temporal-1')
    await user.click(within(form).getByRole('button', { name: 'Entrar' }))

    const choose = await screen.findByRole('form', { name: 'Elige tu contraseña' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(choose).getByText('ana@example.com')).toBeInTheDocument()
    // The Google button and the other forms stay out of the way.
    expect(screen.queryByRole('button', { name: 'Continuar con Google' })).not.toBeInTheDocument()
    const next = within(choose).getByLabelText(/^Contraseña nueva/)
    expect(next).toHaveFocus()
    expect(next).toHaveAttribute('autocomplete', 'new-password')
    const repeat = within(choose).getByLabelText(/^Repite la contraseña/)
    const save = within(choose).getByRole('button', { name: 'Guardar y entrar' })

    await user.type(next, 'corta')
    await user.click(save)
    expect(within(choose).getByText('Debe tener al menos 8 caracteres.')).toBeInTheDocument()
    await user.clear(next)
    await user.type(next, 'temporal-1')
    await user.type(repeat, 'temporal-1')
    await user.click(save)
    expect(within(choose).getByText('Elige una contraseña distinta de la actual.')).toBeInTheDocument()
    await user.clear(next)
    await user.type(next, 'mi frase secreta')
    await user.clear(repeat)
    await user.type(repeat, 'mi frase secret')
    await user.click(save)
    expect(within(choose).getByText('Las dos contraseñas no coinciden.')).toBeInTheDocument()
    expect(login).toHaveBeenCalledTimes(1)

    await user.type(repeat, 'a')
    await user.click(save)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(login.mock.calls.at(-1)?.[0].body).toEqual({
      email: 'ana@example.com',
      password: 'temporal-1',
      new_password: 'mi frase secreta',
    })
  })

  it('goes back from choosing a password to signing in', async () => {
    mockSignIn('POST /api/auth/login', () => reply(403, { code: 'password_change_required' }))
    const user = userEvent.setup()
    renderApp('/login')
    const form = await screen.findByRole('form', { name: 'Entrar con tu correo' })
    await user.type(within(form).getByRole('textbox', { name: /Correo electrónico/ }), 'ana@example.com')
    await user.type(within(form).getByLabelText(/^Contraseña/), 'temporal-1')
    await user.click(within(form).getByRole('button', { name: 'Entrar' }))
    await user.click(within(await screen.findByRole('form', { name: 'Elige tu contraseña' })).getByRole('button', { name: 'Volver' }))
    const again = await screen.findByRole('form', { name: 'Entrar con tu correo' })
    expect(within(again).getByRole('textbox', { name: /Correo electrónico/ })).toHaveValue('ana@example.com')
    expect(within(again).getByLabelText(/^Contraseña/)).toHaveValue('')
  })

  it('e-mails a link to choose a new password when the server can send e-mails', async () => {
    const forgot = vi.fn(() => reply(204))
    mockLogin({ password_reset_enabled: true }, { 'POST /api/auth/password/forgot': forgot })
    const user = userEvent.setup()
    renderApp('/login')
    const form = await screen.findByRole('form', { name: 'Entrar con tu correo' })
    await user.type(within(form).getByRole('textbox', { name: /Correo electrónico/ }), ' Ana@Example.com')
    await user.click(within(form).getByRole('button', { name: '¿Has olvidado tu contraseña?' }))

    const recover = await screen.findByRole('form', { name: 'Recupera tu contraseña' })
    const email = within(recover).getByRole('textbox', { name: /Correo electrónico/ })
    expect(email).toHaveValue('Ana@Example.com')
    await user.click(within(recover).getByRole('button', { name: 'Enviar el enlace' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Si ana@example.com tiene acceso a Timelife, te hemos enviado un correo con un enlace',
    )
    expect(forgot.mock.calls).toHaveLength(1)
    expect((forgot.mock.calls[0] as unknown as [MockRequest])[0].body).toEqual({ email: 'ana@example.com', locale: 'es' })

    await user.click(screen.getByRole('button', { name: 'Volver a iniciar sesión' }))
    expect(await screen.findByRole('form', { name: 'Entrar con tu correo' })).toBeInTheDocument()
  })

  it('shows the errors of a forgot-password request', async () => {
    mockLogin({ password_reset_enabled: true }, { 'POST /api/auth/password/forgot': reply(429, { code: 'request_throttled' }) })
    const user = userEvent.setup()
    renderApp('/login')
    await user.click(await screen.findByRole('button', { name: '¿Has olvidado tu contraseña?' }))
    const recover = await screen.findByRole('form', { name: 'Recupera tu contraseña' })
    await user.click(within(recover).getByRole('button', { name: 'Enviar el enlace' }))
    expect(within(recover).getByText('Escribe tu correo.')).toBeInTheDocument()
    await user.type(within(recover).getByRole('textbox', { name: /Correo electrónico/ }), 'ana@example.com')
    await user.click(within(recover).getByRole('button', { name: 'Enviar el enlace' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiadas solicitudes seguidas.')
  })

  it('a new installation creates its first administrator instead', async () => {
    const setup = mockSignIn('POST /api/auth/setup', () => ADMIN_SESSION, { setup_required: true })
    const user = userEvent.setup()
    const { router, queryClient } = renderApp('/login')
    const form = await screen.findByRole('form', { name: 'Crea la cuenta de administración' })
    expect(screen.queryByRole('button', { name: 'Continuar con Google' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Entrar con tu correo' })).not.toBeInTheDocument()
    expect(screen.getByText('Después, desde Administración → Usuarios, darás acceso a tu familia.')).toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: 'Crear y entrar' }))
    expect(within(form).getByText('Escribe tu correo.')).toBeInTheDocument()
    expect(within(form).getByText('Escribe la contraseña.')).toBeInTheDocument()
    expect(setup).not.toHaveBeenCalled()

    await user.type(within(form).getByRole('textbox', { name: /Correo electrónico/ }), 'Ada@Example.com')
    await user.type(within(form).getByRole('textbox', { name: /Tu nombre/ }), ' Ada ')
    await user.type(within(form).getByLabelText(/^Contraseña nueva/), 'la de la admin')
    await user.type(within(form).getByLabelText(/^Repite la contraseña/), 'la de la admin')
    await user.click(within(form).getByRole('button', { name: 'Crear y entrar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(setup.mock.calls[0][0].body).toEqual({ email: 'ada@example.com', password: 'la de la admin', name: 'Ada', token: null })
    expect(queryClient.getQueryData<AuthConfigOut>(['auth', 'config'])?.setup_required).toBe(false)
  })

  it('tells when somebody else created the administrator first, then offers the sign-in', async () => {
    let setupRequired = true
    mockApi({
      'GET /api/auth/session': ANONYMOUS_SESSION,
      'GET /api/auth/config': () => ({ ...AUTH_CONFIG, setup_required: setupRequired }),
      'POST /api/auth/setup': () => {
        setupRequired = false
        return reply(403, { code: 'setup_closed' })
      },
    })
    const user = userEvent.setup()
    renderApp('/login')
    const form = await screen.findByRole('form', { name: 'Crea la cuenta de administración' })
    await user.type(within(form).getByRole('textbox', { name: /Correo electrónico/ }), 'ada@example.com')
    await user.type(within(form).getByLabelText(/^Contraseña nueva/), 'la de la admin')
    await user.type(within(form).getByLabelText(/^Repite la contraseña/), 'la de la admin')
    await user.click(within(form).getByRole('button', { name: 'Crear y entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Timelife ya tiene administración')
    expect(await screen.findByRole('form', { name: 'Entrar con tu correo' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Crea la cuenta de administración' })).not.toBeInTheDocument()
  })

  it('offers the dev login when enabled and signs in', async () => {
    const devLogin = mockSignIn(
      'POST /api/auth/dev-login',
      (request) => ((request.body as { password: string }).password === 'admin' ? ADMIN_SESSION : reply(401, { code: 'invalid_credentials' })),
      { google_enabled: false, dev_login_enabled: true },
    )
    const user = userEvent.setup()
    const { router } = renderApp('/login?next=%2Fadmin%2Fusers')
    const form = await screen.findByRole('form', { name: 'Acceso de desarrollo' })
    expect(screen.queryByRole('button', { name: 'Continuar con Google' })).not.toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Entrar con tu correo' })).toBeInTheDocument()

    await user.click(within(form).getByRole('radio', { name: 'Administrador' }))
    await user.type(within(form).getByLabelText(/Contraseña/), 'wrong')
    await user.click(within(form).getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El correo (o el usuario) o la contraseña no son correctos.')

    await user.clear(within(form).getByLabelText(/Contraseña/))
    await user.type(within(form).getByLabelText(/Contraseña/), 'admin')
    await user.click(within(form).getByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/users'))
    expect(devLogin.mock.calls.at(-1)?.[0].body).toEqual({ username: 'admin', password: 'admin' })
  })

  it('keeps the dev login next to the first administrator form', async () => {
    mockLogin({ setup_required: true, dev_login_enabled: true })
    renderApp('/login')
    expect(await screen.findByRole('form', { name: 'Crea la cuenta de administración' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Acceso de desarrollo' })).toBeInTheDocument()
  })
})

describe('safeNextPath', () => {
  it('only allows same-origin app paths', () => {
    expect(safeNextPath('/c/ana?zoom=months')).toBe('/c/ana?zoom=months')
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath('https://evil.example')).toBe('/')
    expect(safeNextPath('//evil.example')).toBe('/')
    expect(safeNextPath('/\\evil.example')).toBe('/')
    expect(safeNextPath('/login?next=/x')).toBe('/')
  })
})
