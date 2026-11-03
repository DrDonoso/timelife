import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ChildOut } from '../../api/schema.gen'
import { getThemeColors } from '../../theme/useThemeColors'
import { ADMIN_SESSION, mockSignedIn, renderWithProviders, reply, type MockHandler } from '../../utils/test-utils'
import { sentBodies } from '../categories/testing'
import { AppearancePage } from './AppearancePage'

const ANA: ChildOut = { id: 1, name: 'Ana', slug: 'ana', birth_date: '2024-05-02', avatar: null, color: null, sort_order: 0 }
const LEO: ChildOut = { id: 2, name: 'Leo', slug: 'leo', birth_date: '2026-01-15', avatar: null, color: '#0f766e', sort_order: 1 }

const sunset = getThemeColors('sunset', 'light')

/** The page over a fake API whose children answer the colour endpoints (`handlers` override them). */
function setup(initial: readonly ChildOut[] = [ANA, LEO], handlers: Record<string, MockHandler> = {}) {
  const children = structuredClone([...initial])
  const setColor = (id: number, color: string | null) => {
    const index = children.findIndex((child) => child.id === id)
    children[index] = { ...children[index], color }
    return children[index]
  }
  const fetchMock = mockSignedIn(ADMIN_SESSION, {
    'GET /api/children': () => children,
    ...Object.fromEntries(
      children.flatMap(({ id }) => [
        [`PUT /api/admin/children/${id}/color`, ({ body }: { body: { color: string } }) => setColor(id, body.color)],
        [`DELETE /api/admin/children/${id}/color`, () => setColor(id, null)],
      ]),
    ),
    ...handlers,
  })
  const user = userEvent.setup()
  const view = renderWithProviders(<AppearancePage />, { route: '/admin/appearance' })
  return { ...view, fetchMock, user }
}

function lanesSection() {
  return screen.getByRole('region', { name: 'Todos juntos' })
}

function laneRow(name: string) {
  return within(lanesSection()).getByRole('article', { name })
}

/** `--lane-color` of a child's line in the preview. */
function previewColor(container: HTMLElement, id: number) {
  return container.querySelector<SVGPathElement>(`[data-lane-preview] [data-preview-lane="${id}"]`)?.style.getPropertyValue('--lane-color')
}

async function setHex(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input)
  await user.type(input, value)
  await user.tab()
}

describe('AppearancePage · Todos juntos', () => {
  it('lists every child with the colour of their line and previews the lines together', async () => {
    const { container } = setup()
    const ana = await screen.findByRole('article', { name: 'Ana' })
    expect(
      within(lanesSection()).getByText('El color de la línea de cada niño en Todos juntos. Sin color propio, cada uno usa el color automático del tema.'),
    ).toBeInTheDocument()
    // In display order.
    expect(within(lanesSection()).getAllByRole('article').map((row) => row.getAttribute('data-lane-row'))).toEqual(['1', '2'])

    expect(within(ana).getByText('Automático')).toBeInTheDocument()
    expect(within(ana).getByRole('textbox', { name: 'Color de la línea de Ana' })).toHaveValue(sunset.lane(0, null).toUpperCase())
    expect(within(ana).queryByRole('button', { name: /^Quitar el color/ })).not.toBeInTheDocument()
    const leo = laneRow('Leo')
    expect(within(leo).getByText('Personalizado')).toBeInTheDocument()
    expect(within(leo).getByRole('textbox', { name: 'Color de la línea de Leo' })).toHaveValue('#0F766E')
    expect(within(leo).getByRole('button', { name: 'Quitar el color de la línea de Leo' })).toBeEnabled()

    // A decorative sketch of the lines in the colours the timeline paints them.
    expect(container.querySelector('[data-lane-preview]')).toHaveAttribute('aria-hidden', 'true')
    expect(previewColor(container, 1)).toBe('#5b8def')
    expect(previewColor(container, 2)).toBe('#0f766e')
    expect(screen.queryByText('Todos juntos aparece cuando hay al menos dos niños.')).not.toBeInTheDocument()
  })

  it('saves the colour of a child’s line', async () => {
    const { user, fetchMock, container } = setup()
    const field = within(await screen.findByRole('article', { name: 'Ana' })).getByRole('textbox', { name: 'Color de la línea de Ana' })
    await setHex(user, field, '#FF0000')
    expect(within(laneRow('Ana')).getByText('Sin guardar')).toBeInTheDocument()
    // The preview follows the unsaved colour.
    expect(previewColor(container, 1)).toBe('#ff0000')

    await user.click(within(laneRow('Ana')).getByRole('button', { name: 'Guardar el color de la línea de Ana' }))
    expect(await screen.findByText('Color de la línea de Ana guardado.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/children/1/color')).toEqual([{ color: '#ff0000' }])
    await waitFor(() => expect(within(laneRow('Ana')).getByText('Personalizado')).toBeInTheDocument())
    expect(within(laneRow('Ana')).queryByText('Sin guardar')).not.toBeInTheDocument()
    expect(field).toHaveValue('#FF0000')
    expect(within(laneRow('Ana')).getByRole('button', { name: 'Quitar el color de la línea de Ana' })).toBeInTheDocument()
    expect(previewColor(container, 1)).toBe('#ff0000')
  })

  it('removes the colour of a child’s line, which goes back to the automatic one', async () => {
    const { user, fetchMock, container } = setup()
    await screen.findByRole('article', { name: 'Leo' })
    await user.click(within(laneRow('Leo')).getByRole('button', { name: 'Quitar el color de la línea de Leo' }))
    expect(await screen.findByText('La línea de Leo vuelve a su color automático.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'DELETE', '/api/admin/children/2/color')).toHaveLength(1)
    await waitFor(() => expect(within(laneRow('Leo')).getByText('Automático')).toBeInTheDocument())
    const field = within(laneRow('Leo')).getByRole('textbox', { name: 'Color de la línea de Leo' })
    expect(field).toHaveValue(sunset.lane(1, null).toUpperCase())
    await waitFor(() => expect(field).toHaveFocus())
    expect(within(laneRow('Leo')).queryByRole('button', { name: /^Quitar el color/ })).not.toBeInTheDocument()
    expect(previewColor(container, 2)).toBe(sunset.lane(1, null))
  })

  it('undoes an unsaved colour', async () => {
    const { user, fetchMock, container } = setup()
    const field = within(await screen.findByRole('article', { name: 'Leo' })).getByRole('textbox', { name: 'Color de la línea de Leo' })
    await setHex(user, field, '#123456')
    expect(previewColor(container, 2)).toBe('#123456')
    await user.click(within(laneRow('Leo')).getByRole('button', { name: 'Deshacer' }))
    expect(field).toHaveValue('#0F766E')
    expect(within(laneRow('Leo')).queryByText('Sin guardar')).not.toBeInTheDocument()
    expect(previewColor(container, 2)).toBe('#0f766e')
    await waitFor(() => expect(field).toHaveFocus())
    expect(fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET')).toEqual([])
  })

  it('reports why a colour could not be saved', async () => {
    const { user } = setup([ANA, LEO], { 'PUT /api/admin/children/1/color': reply(404, { code: 'child_not_found' }) })
    const field = within(await screen.findByRole('article', { name: 'Ana' })).getByRole('textbox', { name: 'Color de la línea de Ana' })
    await setHex(user, field, '#abcdef')
    await user.click(within(laneRow('Ana')).getByRole('button', { name: 'Guardar el color de la línea de Ana' }))
    expect(await screen.findByText('Este niño ya no existe.')).toBeInTheDocument()
    expect(within(laneRow('Ana')).getByText('Sin guardar')).toBeInTheDocument()
    expect(within(laneRow('Ana')).getByText('Automático')).toBeInTheDocument()
  })

  it('uses the automatic colours of the chosen theme and adapts the chosen ones to it', async () => {
    localStorage.setItem('timelife.palette', 'ocean')
    const ocean = getThemeColors('ocean', 'light')
    const pale = '#fde68a'
    const { container } = setup([ANA, { ...LEO, color: pale }])
    const ana = await screen.findByRole('article', { name: 'Ana' })
    expect(ocean.lane(0, null)).not.toBe(sunset.lane(0, null))
    expect(within(ana).getByRole('textbox', { name: 'Color de la línea de Ana' })).toHaveValue(ocean.lane(0, null).toUpperCase())
    expect(previewColor(container, 1)).toBe(ocean.lane(0, null))
    // The field keeps the chosen colour; the lines paint it for the theme.
    expect(within(laneRow('Leo')).getByRole('textbox', { name: 'Color de la línea de Leo' })).toHaveValue(pale.toUpperCase())
    expect(ocean.lane(1, pale)).not.toBe(pale)
    expect(previewColor(container, 2)).toBe(ocean.lane(1, pale))
  })

  it('explains that Todos juntos needs two children', async () => {
    const { container } = setup([ANA])
    expect(await screen.findByText('Todos juntos aparece cuando hay al menos dos niños.')).toBeInTheDocument()
    expect(laneRow('Ana')).toBeInTheDocument()
    expect(container.querySelector('[data-lane-preview]')).toBeNull()
  })

  it('links to the children page when there are none', async () => {
    setup([])
    expect(
      await screen.findByText('Todavía no hay niños. Cuando los añadas, aquí podrás elegir el color de la línea de cada uno.'),
    ).toBeInTheDocument()
    expect(within(lanesSection()).getByRole('link', { name: 'Ir a Niños' })).toHaveAttribute('href', '/admin/children')
    expect(within(lanesSection()).queryByRole('article')).not.toBeInTheDocument()
  })

  it('offers to retry when the children cannot be loaded', async () => {
    let fail = true
    const { user } = setup([ANA, LEO], {
      'GET /api/children': () => (fail ? reply(500, { code: 'internal_error' }) : [ANA, LEO]),
    })
    const error = await within(await screen.findByRole('region', { name: 'Todos juntos' })).findByRole('heading', {
      name: 'No se han podido cargar los niños.',
    })
    expect(error).toBeInTheDocument()
    fail = false
    await user.click(within(lanesSection()).getByRole('button', { name: 'Reintentar' }))
    expect(await within(lanesSection()).findByRole('article', { name: 'Leo' })).toBeInTheDocument()
  })
})
