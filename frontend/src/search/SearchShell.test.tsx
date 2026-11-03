import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Outlet, RouterProvider, createMemoryRouter, type RouteObject } from 'react-router'
import { AppProviders } from '../App'
import { Modal } from '../components/Modal'
import { AppShell } from '../shell/AppShell'
import { RootLayout } from '../shell/RootLayout'
import { createTestQueryClient, mockSignedIn } from '../utils/test-utils'
import { FilterPanel } from './FilterPanel'
import { currentUrl, timelineHandler } from './testing'

/** The real header (AppShell) around a minimal timeline page and a modal detail route. */
async function renderShell(route: string, switcherName = 'Cambiar de niño: Ana') {
  const timeline = (path: string): RouteObject => ({
    path,
    element: (
      <>
        <button type="button">Hito del timeline</button>
        <FilterPanel />
        <Outlet />
      </>
    ),
    children: [
      {
        path: 'e/:eventId',
        element: (
          <Modal isOpen onOpenChange={() => {}} title="Detalle del hito">
            <p>Contenido</p>
          </Modal>
        ),
      },
    ],
  })
  const routes: RouteObject[] = [
    {
      element: <RootLayout />,
      children: [
        {
          element: <AppShell />,
          children: [timeline('c/:childSlug'), timeline('all')],
        },
      ],
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  render(
    <AppProviders queryClient={createTestQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  // The header search is usable before the children load; tests start once the timeline is known.
  await screen.findByRole('button', { name: switcherName })
  return router
}

afterEach(() => {
  window.innerWidth = 1024
  window.dispatchEvent(new Event('resize'))
})

describe('search in the app header', () => {
  it('opens a suggestion as the event detail and ignores "/" while the modal is open', async () => {
    mockSignedIn(undefined, { 'GET /api/children/1/timeline': timelineHandler() })
    const user = userEvent.setup()
    const router = await renderShell('/c/ana?zoom=months')
    const input = await screen.findByRole('combobox', { name: 'Buscar hitos' })
    await user.type(input, 'calabaza')
    await user.click(await screen.findByRole('option', { name: 'Papilla de calabaza' }))

    expect(currentUrl(router)).toBe('/c/ana/e/8?zoom=events&q=calabaza&focus=e8')
    const dialog = await screen.findByRole('dialog', { name: 'Detalle del hito' })
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    await user.keyboard('/')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('searches every child’s milestones on the family timeline and opens them over it', async () => {
    mockSignedIn(undefined, { 'GET /api/timeline': timelineHandler() })
    const user = userEvent.setup()
    const router = await renderShell('/all?zoom=months', 'Cambiar de niño: Todos juntos')
    await user.type(await screen.findByRole('combobox', { name: 'Buscar hitos' }), 'calabaza')
    await user.click(await screen.findByRole('option', { name: 'Papilla de calabaza' }))
    expect(currentUrl(router)).toBe('/all/e/8?zoom=events&q=calabaza&focus=e8')
    expect(await screen.findByRole('dialog', { name: 'Detalle del hito' })).toBeInTheDocument()
  })

  it('applies a pending query when the field loses focus', async () => {
    mockSignedIn(undefined, { 'GET /api/children/1/timeline': timelineHandler() })
    const user = userEvent.setup()
    const router = await renderShell('/c/ana')
    await user.type(await screen.findByRole('combobox', { name: 'Buscar hitos' }), 'luna')
    // While the suggestions are open react-aria hides the rest of the page from assistive tech.
    await user.click(screen.getByRole('button', { name: 'Hito del timeline', hidden: true }))
    expect(currentUrl(router)).toBe('/c/ana?q=luna')
  })

  it('mobile: the search icon expands the field; Esc closes suggestions, then clears, then collapses', async () => {
    window.innerWidth = 390
    mockSignedIn(undefined, { 'GET /api/children/1/timeline': timelineHandler() })
    const user = userEvent.setup()
    const router = await renderShell('/c/ana?zoom=events')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    const openSearch = await screen.findByRole('button', { name: 'Buscar' })
    await user.click(openSearch)
    const input = await screen.findByRole('combobox', { name: 'Buscar hitos' })
    await waitFor(() => expect(input).toHaveFocus())

    await user.type(input, 'pasos')
    const listbox = await screen.findByRole('listbox', { name: 'Hitos encontrados' })
    expect(await within(listbox).findByRole('option', { name: 'Primeros pasos' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(input).toHaveValue('pasos')

    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
    expect(currentUrl(router)).toBe('/c/ana?zoom=events')
    expect(screen.getByRole('combobox', { name: 'Buscar hitos' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buscar' })).toHaveFocus())
  })
})
