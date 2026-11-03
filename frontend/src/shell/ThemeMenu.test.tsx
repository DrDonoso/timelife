import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '../contexts/ThemeContext'
import { I18nProvider } from '../i18n'
import { THEME_PALETTES, THEMES } from '../theme/themes'
import { VIEWER_SESSION, mockSignedIn, renderWithProviders } from '../utils/test-utils'
import { AppShell } from './AppShell'
import { ModeSegmented, PalettePicker, ThemeMenu } from './ThemeMenu'

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </I18nProvider>
  )
}

const html = document.documentElement

/** Name and `aria-checked` of each option, in order (the name is the text, or the label of a swatch). */
function describeOptions(options: HTMLElement[]) {
  return options.map((option) => [option.getAttribute('aria-label') ?? option.textContent, option.getAttribute('aria-checked')])
}

/** The decorative swatch inside an option. */
function swatchOf(option: HTMLElement): HTMLElement {
  const swatch = option.querySelector<HTMLElement>('.swatch')
  if (!swatch) throw new Error('The option has no swatch')
  return swatch
}

async function openMenu(name: string) {
  await userEvent.click(screen.getByRole('button', { name }))
  return screen.findByRole('menu', { name })
}

afterEach(() => {
  window.innerWidth = 1024
  window.dispatchEvent(new Event('resize'))
})

describe('ThemeMenu', () => {
  it('names the current theme and mode, and offers both in two sections', async () => {
    render(<ThemeMenu />, { wrapper: Providers })
    const trigger = screen.getByRole('button', { name: 'Tema: Atardecer · Modo: Automático' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'true')
    // The swatch and the sun only repeat the accessible name.
    expect([...trigger.children].map((child) => child.getAttribute('aria-hidden'))).toEqual(['true', 'true'])

    const menu = await openMenu('Tema: Atardecer · Modo: Automático')
    const themes = within(menu).getByRole('group', { name: 'Tema' })
    const options = within(themes).getAllByRole('menuitemradio')
    expect(describeOptions(options)).toEqual([
      ['Atardecer', 'true'],
      ['Océano', 'false'],
      ['Bosque', 'false'],
      ['Lavanda', 'false'],
      ['Grafito', 'false'],
    ])
    // Each theme shows its three colours, hidden from assistive technology.
    options.forEach((option, index) => {
      const swatch = swatchOf(option)
      const [background, primary, accent] = THEMES[THEME_PALETTES[index]].swatches
      expect(swatch).toHaveAttribute('aria-hidden', 'true')
      expect(swatch.style.getPropertyValue('--swatch-background')).toBe(background)
      expect(swatch.style.getPropertyValue('--swatch-primary')).toBe(primary)
      expect(swatch.style.getPropertyValue('--swatch-accent')).toBe(accent)
    })

    const modes = within(menu).getByRole('group', { name: 'Modo' })
    expect(describeOptions(within(modes).getAllByRole('menuitemradio'))).toEqual([
      ['Automático', 'true'],
      ['Claro', 'false'],
      ['Oscuro', 'false'],
    ])
  })

  it('applies a theme to the page, remembers it and keeps the mode', async () => {
    render(<ThemeMenu />, { wrapper: Providers })
    expect(html.dataset.palette).toBe('sunset')
    const menu = await openMenu('Tema: Atardecer · Modo: Automático')
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Océano' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(html.dataset.palette).toBe('ocean')
    expect(localStorage.getItem('timelife.palette')).toBe('ocean')
    expect(html.dataset.theme).toBe('light')
    expect(localStorage.getItem('timelife.theme')).toBeNull()

    const reopened = await openMenu('Tema: Océano · Modo: Automático')
    expect(within(reopened).getByRole('menuitemradio', { name: 'Océano' })).toHaveAttribute('aria-checked', 'true')
    expect(within(reopened).getByRole('menuitemradio', { name: 'Atardecer' })).toHaveAttribute('aria-checked', 'false')
    expect(within(reopened).getByRole('menuitemradio', { name: 'Automático' })).toHaveAttribute('aria-checked', 'true')
  })

  it('still switches the mode, keeping the theme', async () => {
    render(<ThemeMenu />, { wrapper: Providers })
    await userEvent.click(within(await openMenu('Tema: Atardecer · Modo: Automático')).getByRole('menuitemradio', { name: 'Oscuro' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(html.dataset.theme).toBe('dark')
    expect(localStorage.getItem('timelife.theme')).toBe('dark')
    expect(html.dataset.palette).toBe('sunset')
    expect(localStorage.getItem('timelife.palette')).toBeNull()

    const menu = await openMenu('Tema: Atardecer · Modo: Oscuro')
    expect(within(menu).getByRole('menuitemradio', { name: 'Oscuro' })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: 'Atardecer' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Automático' }))
    // The system's choice (light in tests).
    expect(html.dataset.theme).toBe('light')
    expect(await screen.findByRole('button', { name: 'Tema: Atardecer · Modo: Automático' })).toBeInTheDocument()
  })

  it('opens on the choices stored on this device', async () => {
    localStorage.setItem('timelife.palette', 'lavender')
    localStorage.setItem('timelife.theme', 'dark')
    render(<ThemeMenu />, { wrapper: Providers })
    expect(html.dataset.palette).toBe('lavender')
    expect(html.dataset.theme).toBe('dark')
    const menu = await openMenu('Tema: Lavanda · Modo: Oscuro')
    expect(within(menu).getByRole('menuitemradio', { name: 'Lavanda' })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: 'Oscuro' })).toHaveAttribute('aria-checked', 'true')
  })

  it('works with the keyboard: Enter chooses and closes, Space chooses and stays', async () => {
    const user = userEvent.setup()
    render(<ThemeMenu />, { wrapper: Providers })
    await user.tab()
    expect(screen.getByRole('button', { name: 'Tema: Atardecer · Modo: Automático' })).toHaveFocus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: 'Tema: Atardecer · Modo: Automático' })
    await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: 'Atardecer' })).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitemradio', { name: 'Océano' })).toHaveFocus()
    await user.keyboard(' ')
    expect(html.dataset.palette).toBe('ocean')
    expect(within(menu).getByRole('menuitemradio', { name: 'Océano' })).toHaveAttribute('aria-checked', 'true')

    // Down from the last theme to the modes.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(within(menu).getByRole('menuitemradio', { name: 'Automático' })).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(html.dataset.theme).toBe('dark')
    expect(html.dataset.palette).toBe('ocean')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tema: Océano · Modo: Oscuro' })).toHaveFocus())
  })

  it('speaks English', async () => {
    localStorage.setItem('timelife.lang', 'en')
    render(<ThemeMenu />, { wrapper: Providers })
    const menu = await openMenu('Theme: Sunset · Mode: Automatic')
    expect(describeOptions(within(within(menu).getByRole('group', { name: 'Theme' })).getAllByRole('menuitemradio'))).toEqual([
      ['Sunset', 'true'],
      ['Ocean', 'false'],
      ['Forest', 'false'],
      ['Lavender', 'false'],
      ['Graphite', 'false'],
    ])
    expect(describeOptions(within(within(menu).getByRole('group', { name: 'Mode' })).getAllByRole('menuitemradio'))).toEqual([
      ['Automatic', 'true'],
      ['Light', 'false'],
      ['Dark', 'false'],
    ])
  })
})

describe('PalettePicker', () => {
  it('shows every theme as a swatch named after it, the current one checked, and switches on a tap', async () => {
    render(<PalettePicker />, { wrapper: Providers })
    const group = screen.getByRole('radiogroup', { name: 'Tema' })
    const options = within(group).getAllByRole('radio')
    expect(describeOptions(options)).toEqual([
      ['Atardecer', 'true'],
      ['Océano', 'false'],
      ['Bosque', 'false'],
      ['Lavanda', 'false'],
      ['Grafito', 'false'],
    ])
    for (const option of options) expect(swatchOf(option)).toHaveAttribute('aria-hidden', 'true')

    await userEvent.click(within(group).getByRole('radio', { name: 'Bosque' }))
    expect(html.dataset.palette).toBe('forest')
    expect(localStorage.getItem('timelife.palette')).toBe('forest')
    expect(within(group).getByRole('radio', { name: 'Bosque' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Atardecer' })).not.toBeChecked()
  })

  it('arrow keys move between the swatches without switching; Space chooses', async () => {
    const user = userEvent.setup()
    render(<PalettePicker />, { wrapper: Providers })
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Atardecer' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Océano' })).toHaveFocus()
    expect(html.dataset.palette).toBe('sunset')

    await user.keyboard(' ')
    expect(html.dataset.palette).toBe('ocean')
    expect(screen.getByRole('radio', { name: 'Océano' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Océano' })).toHaveFocus()
  })
})

describe('ModeSegmented', () => {
  it('is named «Modo» and switches between light and dark', async () => {
    render(<ModeSegmented />, { wrapper: Providers })
    const group = screen.getByRole('radiogroup', { name: 'Modo' })
    expect(describeOptions(within(group).getAllByRole('radio'))).toEqual([
      ['Automático', 'true'],
      ['Claro', 'false'],
      ['Oscuro', 'false'],
    ])
    await userEvent.click(within(group).getByRole('radio', { name: 'Oscuro' }))
    expect(html.dataset.theme).toBe('dark')
    expect(localStorage.getItem('timelife.theme')).toBe('dark')
    expect(within(group).getByRole('radio', { name: 'Oscuro' })).toBeChecked()
  })
})

describe('theme in the app header', () => {
  it('desktop: the header menu; the account panel has no theme controls', async () => {
    mockSignedIn(VIEWER_SESSION)
    const user = userEvent.setup()
    renderWithProviders(<AppShell />)
    await user.click(await screen.findByRole('button', { name: 'Menú de usuario: Vera Viewer' }))
    const panel = await screen.findByRole('dialog', { name: 'Menú de usuario' })
    expect(within(panel).queryByRole('radiogroup')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Tema: Atardecer · Modo: Automático' }))
    const menu = await screen.findByRole('menu', { name: 'Tema: Atardecer · Modo: Automático' })
    await user.click(within(within(menu).getByRole('group', { name: 'Tema' })).getByRole('menuitemradio', { name: 'Grafito' }))
    expect(html.dataset.palette).toBe('graphite')
    expect(await screen.findByRole('button', { name: 'Tema: Grafito · Modo: Automático' })).toBeInTheDocument()
  })

  it('phone: the account panel has the theme swatches and the mode instead', async () => {
    window.innerWidth = 390
    mockSignedIn(VIEWER_SESSION)
    const user = userEvent.setup()
    renderWithProviders(<AppShell />)
    const account = await screen.findByRole('button', { name: 'Menú de usuario: Vera Viewer' })
    expect(screen.queryByRole('button', { name: /^Tema: / })).not.toBeInTheDocument()

    await user.click(account)
    const panel = await screen.findByRole('dialog', { name: 'Menú de usuario' })
    const themes = within(panel).getByRole('radiogroup', { name: 'Tema' })
    expect(within(themes).getAllByRole('radio')).toHaveLength(THEME_PALETTES.length)
    expect(within(themes).getByRole('radio', { name: 'Atardecer' })).toBeChecked()
    // The current theme's name, next to the label (the checked swatch already says it).
    expect(within(panel).getByText('Atardecer')).toHaveAttribute('aria-hidden', 'true')

    await user.click(within(themes).getByRole('radio', { name: 'Océano' }))
    expect(html.dataset.palette).toBe('ocean')
    expect(localStorage.getItem('timelife.palette')).toBe('ocean')
    // The panel stays open and names the new theme.
    expect(within(themes).getByRole('radio', { name: 'Océano' })).toBeChecked()
    expect(within(panel).getByText('Océano')).toBeInTheDocument()
    expect(within(panel).queryByText('Atardecer')).not.toBeInTheDocument()

    const modes = within(panel).getByRole('radiogroup', { name: 'Modo' })
    expect(within(modes).getByRole('radio', { name: 'Automático' })).toBeChecked()
    await user.click(within(modes).getByRole('radio', { name: 'Oscuro' }))
    expect(html.dataset.theme).toBe('dark')
    expect(html.dataset.palette).toBe('ocean')
    expect(within(modes).getByRole('radio', { name: 'Oscuro' })).toBeChecked()
  })
})
