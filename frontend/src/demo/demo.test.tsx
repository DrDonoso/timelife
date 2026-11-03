/**
 * The public demo as visitors get it: the real route tree against the demo's API handlers, with
 * the demo flag on. Every screen must find its data, and nothing may reach the handlers' 501
 * catch-all (a request the demo does not serve).
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserNavigation } from '../utils/navigation'
import { preloadLazyRoutes, renderApp } from '../utils/test-utils'
import { demoStore, handlers, resetDemo } from './handlers'

vi.mock('./config', () => ({ IS_DEMO: true }))

const server = setupServer(...handlers)
/** Requests answered by the catch-all (`METHOD /path`). */
let unserved: string[] = []

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('response:mocked', ({ request, response }) => {
    if (response.status === 501) unserved.push(`${request.method} ${new URL(request.url).pathname}`)
  })
  await preloadLazyRoutes()
})
beforeEach(() => {
  unserved = []
  resetDemo(() => new Date(2026, 9, 21, 12))
})
afterEach(() => {
  if (unserved.length > 0) throw new Error(`The demo did not serve: ${unserved.join(', ')}`)
})
afterAll(() => server.close())

describe('the public demo', () => {
  it('opens the first child’s timeline without signing in, in English, with a one-time welcome', async () => {
    const { router, unmount } = renderApp('/')
    expect(await screen.findByRole('region', { name: "Emma's timeline" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/c/emma')
    expect(document.documentElement.lang).toBe('en')
    const notifications = screen.getByRole('region', { name: 'Notifications' })
    expect(await within(notifications).findByText(/Welcome to the Timelife demo/)).toBeInTheDocument()
    unmount()

    renderApp('/c/leo')
    expect(await screen.findByRole('region', { name: "Leo's timeline" })).toBeInTheDocument()
    expect(screen.queryByText(/Welcome to the Timelife demo/)).not.toBeInTheDocument()
  })

  it('offers resetting the demo instead of signing out', async () => {
    const assign = vi.spyOn(browserNavigation, 'assign').mockImplementation(() => {})
    const user = userEvent.setup()
    renderApp('/c/emma')
    await user.click(await screen.findByRole('button', { name: 'User menu: Alex Carter' }))
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset the demo' }))
    expect(assign).toHaveBeenCalledWith('/')
  })

  it('opens a milestone with its notes and place', async () => {
    const [shared] = demoStore().timeline(2, { q: 'brother and sister meet' }).events
    renderApp(`/c/leo/e/${shared.id}`)
    const dialog = await screen.findByRole('dialog', { name: 'Brother and sister meet' })
    expect(within(dialog).getByText('Emma kissed his head and said "baby". A moment to frame.')).toBeInTheDocument()
    expect(within(dialog).getByText('Riverside Maternity Unit')).toBeInTheDocument()
  })

  it.each([
    ['/admin/events', 'Events', '82 events'],
    ['/admin/events/new', 'New event', 'Emma'],
    ['/admin/categories', 'Categories', 'Language & communication'],
    ['/admin/children', 'Children', '2 children'],
    ['/admin/appearance', 'Colours & appearance', 'Year colours'],
    ['/admin/users', 'Users', 'Grandma Rose'],
    ['/admin/trash', 'Trash', 'The trash is empty'],
    ['/admin/backup', 'Import & export', '82 milestones'],
  ])('serves %s', async (route, heading, text) => {
    renderApp(route)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    await waitFor(() => expect(document.body).toHaveTextContent(text))
  })

  it('opens a milestone in the editor', async () => {
    renderApp('/admin/events/1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit event' })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Welcome, Emma!')).toBeInTheDocument()
  })
})
