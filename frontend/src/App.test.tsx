import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ADMIN_SESSION,
  ANONYMOUS_SESSION,
  TEST_CHILDREN,
  VIEWER_SESSION,
  mockApi,
  mockSignedIn,
  preloadLazyRoutes,
  renderApp,
  reply,
} from './utils/test-utils'

const location = (router: ReturnType<typeof renderApp>['router']) =>
  `${router.state.location.pathname}${router.state.location.search}`

beforeAll(preloadLazyRoutes)

describe('auth guards', () => {
  it('sends anonymous visitors to the login page, remembering where they were going', async () => {
    mockSignedIn(ANONYMOUS_SESSION)
    const { router } = renderApp('/c/ana?zoom=months')
    expect(await screen.findByRole('button', { name: 'Continuar con Google' })).toBeInTheDocument()
    expect(location(router)).toBe(`/login?next=${encodeURIComponent('/c/ana?zoom=months')}`)
  })

  it('does not add ?next= for the home page', async () => {
    mockSignedIn(ANONYMOUS_SESSION)
    const { router } = renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Timelife' })
    expect(location(router)).toBe('/login')
  })

  it('shows a retry state when the session cannot be checked', async () => {
    mockApi({ 'GET /api/auth/session': reply(500, { code: 'internal_error' }) })
    renderApp('/c/ana')
    expect(await screen.findByText('No se ha podido comprobar tu sesión.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('sends signed-in users away from /login to ?next=', async () => {
    mockSignedIn(VIEWER_SESSION)
    const { router } = renderApp('/login?next=%2Fc%2Fleo')
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/leo'))
  })

  it('ignores unsafe ?next= targets', async () => {
    mockSignedIn(VIEWER_SESSION)
    const { router } = renderApp('/login?next=%2F%2Fevil.example')
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana'))
  })

  it('keeps viewers out of the admin panel', async () => {
    mockSignedIn(VIEWER_SESSION)
    const { router } = renderApp('/admin/users')
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana'))
  })

  it('opens the admin panel on /admin/events for admins', async () => {
    mockSignedIn(ADMIN_SESSION)
    const { router } = renderApp('/admin')
    expect(await screen.findByRole('heading', { level: 1, name: 'Eventos' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/events')
    expect(screen.getByRole('navigation', { name: 'Secciones' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver a la línea de tiempo' })).toHaveAttribute('href', '/')
  })

  it('returns to the login page when the session expires (401)', async () => {
    let signedIn = true
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/auth/session': () => (signedIn ? ADMIN_SESSION : ANONYMOUS_SESSION),
      'GET /api/children': () => {
        signedIn = false
        return reply(401, { code: 'authentication_required' })
      },
    })
    const { router } = renderApp('/c/ana')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/c/ana')}`)
  })

  it('signs out to the plain login page, without ?next=', async () => {
    let signedIn = true
    mockSignedIn(ADMIN_SESSION, {
      'GET /api/auth/session': () => (signedIn ? ADMIN_SESSION : ANONYMOUS_SESSION),
      'GET /api/children/1/timeline': { child_id: 1, total: 0, events: [] },
      'POST /api/auth/logout': () => {
        signedIn = false
        return reply(204)
      },
    })
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?zoom=months')
    await user.click(await screen.findByRole('button', { name: /Menú de usuario/ }))
    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))
    await waitFor(() => expect(location(router)).toBe('/login'))
    expect(await screen.findByRole('button', { name: 'Continuar con Google' })).toBeInTheDocument()
  })
})

describe('home redirect', () => {
  it('opens the first child by default', async () => {
    mockSignedIn(VIEWER_SESSION)
    const { router } = renderApp('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana'))
    expect(await screen.findByRole('heading', { name: 'Ana' })).toBeInTheDocument()
  })

  it('opens the remembered child', async () => {
    localStorage.setItem('timelife.child', 'leo')
    mockSignedIn(VIEWER_SESSION)
    const { router } = renderApp('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/leo'))
  })

  it('remembers the child being viewed', async () => {
    mockSignedIn(VIEWER_SESSION)
    renderApp('/c/leo')
    await screen.findByRole('heading', { name: 'Leo' })
    expect(localStorage.getItem('timelife.child')).toBe('leo')
  })

  it('falls back to the first child when the remembered one is gone', async () => {
    localStorage.setItem('timelife.child', 'nadie')
    mockSignedIn(VIEWER_SESSION)
    const { router } = renderApp('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana'))
  })

  it('remembers and reopens the family timeline (with two children or more)', async () => {
    mockSignedIn(VIEWER_SESSION, { 'GET /api/timeline': { child_id: null, total: 0, events: [] } })
    const first = renderApp('/all')
    expect(await screen.findByRole('heading', { level: 1, name: 'Todos juntos' })).toBeInTheDocument()
    expect(localStorage.getItem('timelife.child')).toBe('@all')
    first.unmount()

    const { router } = renderApp('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/all'))
  })

  it('opens the only child when the family timeline was remembered but one child is left', async () => {
    localStorage.setItem('timelife.child', '@all')
    mockSignedIn(VIEWER_SESSION, { 'GET /api/children': [TEST_CHILDREN[0]] })
    const { router } = renderApp('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/ana'))
  })

  it('invites admins to add children when there are none', async () => {
    mockSignedIn(ADMIN_SESSION, { 'GET /api/children': [] })
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Todavía no hay niños' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Añadir niños' })).toHaveAttribute('href', '/admin/children')
  })

  it('explains the empty state to viewers without an admin link', async () => {
    mockSignedIn(VIEWER_SESSION, { 'GET /api/children': [] })
    renderApp('/')
    expect(await screen.findByText(/Cuando un administrador añada a los niños/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Añadir niños' })).not.toBeInTheDocument()
  })
})

describe('routes', () => {
  it('shows a friendly message for an unknown child', async () => {
    mockSignedIn(VIEWER_SESSION)
    renderApp('/c/nadie')
    expect(await screen.findByRole('heading', { name: 'No encontramos a este niño' })).toBeInTheDocument()
  })

  it('renders the 404 page for unknown paths', async () => {
    mockSignedIn(ANONYMOUS_SESSION)
    renderApp('/esto/no/existe')
    expect(await screen.findByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeInTheDocument()
  })

  it('renders the event detail route inside the timeline', async () => {
    mockSignedIn(VIEWER_SESSION, {
      'GET /api/events/5': {
        id: 5,
        title: 'Primeros pasos',
        date: '2026-03-12',
        notes: '',
        location: null,
        child_ids: [1],
        category_ids: [],
        images: [],
        cover_image_id: null,
        version: 1,
        created_at: '2026-03-12T10:00:00Z',
        updated_at: '2026-03-12T10:00:00Z',
        deleted_at: null,
      },
    })
    const { router } = renderApp('/c/ana/e/5?zoom=events')
    expect(await screen.findByRole('dialog', { name: 'Primeros pasos' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(location(router)).toBe('/c/ana?zoom=events'))
  })

  it('switches between children from the header, keeping filters but not the focused event', async () => {
    mockSignedIn(VIEWER_SESSION)
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?q=pasos&focus=e3')
    await user.click(await screen.findByRole('button', { name: 'Cambiar de niño: Ana' }))
    await user.click(await screen.findByRole('menuitemradio', { name: TEST_CHILDREN[1].name }))
    await waitFor(() => expect(location(router)).toBe('/c/leo?q=pasos'))
  })

  it('switches to everyone together from the header and back', async () => {
    mockSignedIn(VIEWER_SESSION, { 'GET /api/timeline': { child_id: null, total: 0, events: [] } })
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana?q=pasos&focus=e3')
    await user.click(await screen.findByRole('button', { name: 'Cambiar de niño: Ana' }))
    const family = await screen.findByRole('menuitemradio', { name: /^Todos juntos/ })
    expect(family).toHaveAccessibleDescription('Cada niño en su línea')
    await user.click(family)
    await waitFor(() => expect(location(router)).toBe('/all?q=pasos'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Todos juntos' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cambiar de niño: Todos juntos' }))
    expect(screen.getByRole('menuitemradio', { name: /^Todos juntos/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: 'Ana' }))
    await waitFor(() => expect(location(router)).toBe('/c/ana?q=pasos'))
  })

  it('offers no family timeline with a single child', async () => {
    mockSignedIn(VIEWER_SESSION, { 'GET /api/children': [TEST_CHILDREN[0]] })
    renderApp('/c/ana')
    expect(await screen.findByTitle('Viendo a Ana')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Cambiar de niño/ })).not.toBeInTheDocument()
  })

  it('sends the family timeline home when there are no children', async () => {
    mockSignedIn(ADMIN_SESSION, { 'GET /api/children': [] })
    const { router } = renderApp('/all')
    expect(await screen.findByRole('heading', { name: 'Todavía no hay niños' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('signs out from the account menu', async () => {
    let signedIn = true
    const fetchMock = mockSignedIn(ADMIN_SESSION, {
      'GET /api/auth/session': () => (signedIn ? ADMIN_SESSION : ANONYMOUS_SESSION),
      'POST /api/auth/logout': () => {
        signedIn = false
        return reply(204)
      },
    })
    const user = userEvent.setup()
    const { router } = renderApp('/c/ana')
    await user.click(await screen.findByRole('button', { name: 'Menú de usuario: Ada Admin' }))
    expect(screen.getByRole('link', { name: 'Administración' })).toHaveAttribute('href', '/admin')
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    const logoutCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/auth/logout')
    expect(logoutCall).toBeDefined()
  })
})
