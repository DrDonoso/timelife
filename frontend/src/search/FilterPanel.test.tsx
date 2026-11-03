import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockSignedIn } from '../utils/test-utils'
import { currentUrl, renderSearch, timelineHandler } from './testing'

function setup(route = '/c/ana') {
  mockSignedIn(undefined, { 'GET /api/children/1/timeline': timelineHandler() })
  return renderSearch(route)
}

const toggle = () => screen.getByRole('button', { name: /^Filtros/ })
const panel = () => screen.getByRole('dialog', { name: 'Filtros' })

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(toggle())
  return screen.findByRole('dialog', { name: 'Filtros' })
}

/** Types a date (dd/mm/yyyy digits) into a react-aria DateField labelled `label`. */
async function typeDate(user: ReturnType<typeof userEvent.setup>, label: string, digits: string) {
  const group = screen.getByRole('group', { name: label })
  const [day] = within(group).getAllByRole('spinbutton')
  await user.click(day)
  await user.keyboard(digits)
}

afterEach(() => {
  vi.useRealTimers()
  window.innerWidth = 1024
  window.dispatchEvent(new Event('resize'))
})

describe('FilterToggleButton + FilterPanel (desktop)', () => {
  it('opens a non-modal panel next to the timeline and closes it with its button', async () => {
    const user = userEvent.setup()
    setup()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).not.toHaveAttribute('aria-controls')

    const dialog = await openPanel(user)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(toggle()).toHaveAttribute('aria-controls', dialog.id)
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    expect(dialog).not.toHaveAttribute('aria-modal')

    // No backdrop / focus trap: the timeline keeps working while the panel is open.
    const timelineButton = screen.getByRole('button', { name: 'Hito del timeline' })
    await user.click(timelineButton)
    expect(timelineButton).toHaveFocus()
    expect(panel()).toBeInTheDocument()

    await user.click(within(panel()).getByRole('button', { name: 'Cerrar filtros' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveFocus()
  })

  it('toggles from the header button', async () => {
    const user = userEvent.setup()
    setup()
    await openPanel(user)
    await user.click(toggle())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toggle()).toHaveFocus()
  })

  it('closes with Escape from inside the panel, but not while typing elsewhere', async () => {
    const user = userEvent.setup()
    setup()
    await openPanel(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toggle()).toHaveFocus()

    await openPanel(user)
    await user.click(screen.getByRole('textbox', { name: 'Notas' }))
    await user.keyboard('{Escape}')
    expect(panel()).toBeInTheDocument()

    await user.click(within(panel()).getByRole('button', { name: 'Sueño' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toggle()).toHaveFocus()
  })

  it('toggles categories (any of them) and counts each one on the button', async () => {
    const user = userEvent.setup()
    const { router } = setup('/c/ana?zoom=months')
    await openPanel(user)
    const chips = within(panel()).getByRole('toolbar', { name: 'Categorías' })
    const sleep = await within(chips).findByRole('button', { name: 'Sueño' })
    expect(within(chips).getAllByRole('button').map((chip) => chip.textContent)).toEqual([
      'Lenguaje y comunicación',
      'Sueño',
      'Alimentación',
    ])
    expect(sleep).toHaveAttribute('aria-pressed', 'false')

    await user.click(sleep)
    expect(sleep).toHaveAttribute('aria-pressed', 'true')
    expect(currentUrl(router)).toBe('/c/ana?zoom=months&cat=2')
    expect(toggle()).toHaveAccessibleName('Filtros (1 activo)')
    expect(within(toggle()).getByText('1')).toBeInTheDocument()

    await user.click(within(chips).getByRole('button', { name: 'Alimentación' }))
    expect(currentUrl(router)).toBe('/c/ana?zoom=months&cat=2,3')
    expect(toggle()).toHaveAccessibleName('Filtros (2 activos)')

    await user.click(sleep)
    expect(currentUrl(router)).toBe('/c/ana?zoom=months&cat=3')
    expect(sleep).toHaveAttribute('aria-pressed', 'false')
  })

  describe('date range', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 20, 12, 0, 0) })
    })

    it('applies the quick presets relative to today and counts the range once', async () => {
      const user = userEvent.setup()
      const { router } = setup('/c/ana?cat=1')
      await openPanel(user)
      const presets = within(panel()).getByRole('group', { name: 'Rangos rápidos' })

      await user.click(within(presets).getByRole('button', { name: 'Este año' }))
      expect(currentUrl(router)).toBe('/c/ana?cat=1&from=2026-01-01&to=2026-12-31')
      expect(within(presets).getByRole('button', { name: 'Este año' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('group', { name: 'Desde' })).toHaveTextContent('01/01/2026')
      expect(screen.getByRole('group', { name: 'Hasta' })).toHaveTextContent('31/12/2026')
      expect(toggle()).toHaveAccessibleName('Filtros (2 activos)')

      await user.click(within(presets).getByRole('button', { name: 'Últimos 12 meses' }))
      expect(currentUrl(router)).toBe('/c/ana?cat=1&from=2025-10-21&to=2026-10-20')
      expect(within(presets).getByRole('button', { name: 'Este año' })).toHaveAttribute('aria-pressed', 'false')

      await user.click(within(presets).getByRole('button', { name: 'Año pasado' }))
      expect(currentUrl(router)).toBe('/c/ana?cat=1&from=2025-01-01&to=2025-12-31')

      // Pressing the active preset again removes the range.
      await user.click(within(presets).getByRole('button', { name: 'Año pasado' }))
      expect(currentUrl(router)).toBe('/c/ana?cat=1')
      expect(toggle()).toHaveAccessibleName('Filtros (1 activo)')
    })

    it('keeps a reversed range as a draft with an error until it is fixed', async () => {
      const user = userEvent.setup()
      const { router } = setup('/c/ana?from=2026-05-10')
      await openPanel(user)
      expect(screen.getByRole('group', { name: 'Desde' })).toHaveTextContent('10/05/2026')

      await typeDate(user, 'Hasta', '01012026')
      expect(await screen.findByText('Tiene que ser igual o posterior a «Desde».')).toBeInTheDocument()
      expect(currentUrl(router)).toBe('/c/ana?from=2026-05-10')

      await typeDate(user, 'Hasta', '31122026')
      await waitFor(() => expect(currentUrl(router)).toBe('/c/ana?from=2026-05-10&to=2026-12-31'))
      expect(screen.queryByText('Tiene que ser igual o posterior a «Desde».')).not.toBeInTheDocument()

      await typeDate(user, 'Desde', '01012026')
      await waitFor(() => expect(currentUrl(router)).toBe('/c/ana?from=2026-01-01&to=2026-12-31'))
    })
  })

  it('shows the live result count, the active search and clears everything', async () => {
    const user = userEvent.setup()
    const { router } = setup('/c/ana?q=pas&cat=2&zoom=events&focus=e6')
    await openPanel(user)
    expect(await within(panel()).findByText('4 de 12 hitos')).toBeInTheDocument()
    expect(within(panel()).getByText('pas')).toBeInTheDocument()
    expect(toggle()).toHaveAccessibleName('Filtros (2 activos)')

    await user.click(within(panel()).getByRole('button', { name: 'Quitar la búsqueda «pas»' }))
    expect(currentUrl(router)).toBe('/c/ana?cat=2&zoom=events&focus=e6')
    expect(await within(panel()).findByText('5 de 12 hitos')).toBeInTheDocument()
    await waitFor(() => expect(panel()).toContainElement(document.activeElement as HTMLElement))

    const clear = within(panel()).getByRole('button', { name: 'Limpiar filtros' })
    expect(clear).toBeEnabled()
    await user.click(clear)
    expect(currentUrl(router)).toBe('/c/ana?zoom=events&focus=e6')
    expect(await within(panel()).findByText('12 hitos')).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Limpiar filtros' })).toBeDisabled()
    expect(toggle()).toHaveAccessibleName('Filtros')
    await waitFor(() => expect(panel()).toContainElement(document.activeElement as HTMLElement))
  })
})

describe('FilterPanel (mobile)', () => {
  beforeEach(() => {
    window.innerWidth = 390
    window.dispatchEvent(new Event('resize'))
  })

  it('is a full-height drawer with backdrop that closes with "show results" or Escape', async () => {
    const user = userEvent.setup()
    const { router } = setup('/c/ana')
    const button = toggle()
    const dialog = await openPanel(user)
    expect(dialog.closest('.drawer')).not.toBeNull()
    expect(document.querySelector('.overlay')).not.toBeNull()
    expect(button).toHaveAttribute('aria-controls', dialog.querySelector('.drawerContent')?.id)

    await user.click(await within(dialog).findByRole('button', { name: 'Alimentación' }))
    expect(currentUrl(router)).toBe('/c/ana?cat=3')
    await user.click(await within(dialog).findByRole('button', { name: 'Ver 3 hitos' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await openPanel(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(button).toHaveFocus())
  })
})
