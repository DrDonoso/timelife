import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { VIEWER_SESSION, mockSignedIn, renderWithProviders } from '../utils/test-utils'
import { AppShell } from './AppShell'
import { LanguageList, LanguageMenu } from './LanguageMenu'

/** Name, `lang` and `aria-checked` of each option, in order. */
function describeOptions(options: HTMLElement[]) {
  return options.map((option) => [option.textContent, option.getAttribute('lang'), option.getAttribute('aria-checked')])
}

afterEach(() => {
  window.innerWidth = 1024
  window.dispatchEvent(new Event('resize'))
})

describe('LanguageMenu', () => {
  it('shows the current language and offers every language, each named in itself', async () => {
    const user = userEvent.setup()
    render(<LanguageMenu />, { wrapper: I18nProvider })
    const trigger = screen.getByRole('button', { name: 'Idioma: Español' })
    // The visible code repeats the accessible name: assistive technology skips it.
    expect(within(trigger).getByText('ES')).toHaveAttribute('aria-hidden', 'true')
    expect(trigger).toHaveAttribute('aria-haspopup', 'true')

    await user.click(trigger)
    const menu = await screen.findByRole('menu', { name: 'Idioma: Español' })
    expect(describeOptions(within(menu).getAllByRole('menuitemradio'))).toEqual([
      ['Español', 'es', 'true'],
      ['English', 'en', 'false'],
      ['Português', 'pt', 'false'],
    ])
  })

  it('switches the language, remembers it and updates <html lang>', async () => {
    const user = userEvent.setup()
    render(<LanguageMenu />, { wrapper: I18nProvider })
    await user.click(screen.getByRole('button', { name: 'Idioma: Español' }))
    await user.click(within(await screen.findByRole('menu', { name: 'Idioma: Español' })).getByRole('menuitemradio', { name: 'English' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('timelife.lang')).toBe('en')
    const trigger = screen.getByRole('button', { name: 'Language: English' })
    expect(trigger).toHaveTextContent('EN')

    await user.click(trigger)
    const menu = await screen.findByRole('menu', { name: 'Language: English' })
    expect(describeOptions(within(menu).getAllByRole('menuitemradio'))).toEqual([
      ['Español', 'es', 'false'],
      ['English', 'en', 'true'],
      ['Português', 'pt', 'false'],
    ])
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Português' }))
    expect(document.documentElement.lang).toBe('pt')
    expect(localStorage.getItem('timelife.lang')).toBe('pt')
    expect(screen.getByRole('button', { name: /: Português$/ })).toHaveTextContent('PT')
  })

  it('works with the keyboard, opening on the current language', async () => {
    const user = userEvent.setup()
    render(<LanguageMenu />, { wrapper: I18nProvider })
    await user.tab()
    expect(screen.getByRole('button', { name: 'Idioma: Español' })).toHaveFocus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: 'Idioma: Español' })
    await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: 'Español' })).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitemradio', { name: 'English' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(document.documentElement.lang).toBe('en')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Language: English' })).toHaveFocus())
  })
})

describe('LanguageList', () => {
  it('lists every language named in itself, the current one checked, and switches on a tap', async () => {
    const user = userEvent.setup()
    render(<LanguageList />, { wrapper: I18nProvider })
    const group = screen.getByRole('radiogroup', { name: 'Idioma' })
    expect(describeOptions(within(group).getAllByRole('radio'))).toEqual([
      ['Español', 'es', 'true'],
      ['English', 'en', 'false'],
      ['Português', 'pt', 'false'],
    ])

    await user.click(within(group).getByRole('radio', { name: 'Português' }))
    expect(document.documentElement.lang).toBe('pt')
    expect(localStorage.getItem('timelife.lang')).toBe('pt')
    expect(describeOptions(within(group).getAllByRole('radio'))).toEqual([
      ['Español', 'es', 'false'],
      ['English', 'en', 'false'],
      ['Português', 'pt', 'true'],
    ])
  })

  it('arrow keys move between the languages without switching; Space chooses', async () => {
    const user = userEvent.setup()
    render(<LanguageList />, { wrapper: I18nProvider })
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Español' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'English' })).toHaveFocus()
    expect(document.documentElement.lang).toBe('es')

    await user.keyboard(' ')
    expect(document.documentElement.lang).toBe('en')
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'English' })).toHaveFocus()
  })
})

describe('language in the app header', () => {
  it('desktop: a menu next to the theme menu; the account panel has no preferences', async () => {
    mockSignedIn(VIEWER_SESSION)
    const user = userEvent.setup()
    renderWithProviders(<AppShell />)
    await user.click(await screen.findByRole('button', { name: 'Menú de usuario: Vera Viewer' }))
    expect(within(await screen.findByRole('dialog', { name: 'Menú de usuario' })).queryByRole('radiogroup')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Idioma: Español' }))
    await user.click(within(await screen.findByRole('menu', { name: 'Idioma: Español' })).getByRole('menuitemradio', { name: 'English' }))
    expect(await screen.findByRole('button', { name: 'User menu: Vera Viewer' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Timelife, home' })).toBeInTheDocument()
  })

  it('phone: the account panel lists the languages instead', async () => {
    window.innerWidth = 390
    mockSignedIn(VIEWER_SESSION)
    const user = userEvent.setup()
    renderWithProviders(<AppShell />)
    const account = await screen.findByRole('button', { name: 'Menú de usuario: Vera Viewer' })
    expect(screen.queryByRole('button', { name: /^Idioma: / })).not.toBeInTheDocument()

    await user.click(account)
    const panel = await screen.findByRole('dialog', { name: 'Menú de usuario' })
    await user.click(within(within(panel).getByRole('radiogroup', { name: 'Idioma' })).getByRole('radio', { name: 'English' }))
    expect(document.documentElement.lang).toBe('en')
    // The panel stays open, now in English.
    const languages = within(screen.getByRole('dialog', { name: 'User menu' })).getByRole('radiogroup', { name: 'Language' })
    expect(within(languages).getByRole('radio', { name: 'English' })).toBeChecked()

    await user.click(within(languages).getByRole('radio', { name: 'Português' }))
    expect(document.documentElement.lang).toBe('pt')
    expect(within(screen.getByRole('dialog', { name: 'Menu do utilizador' })).getByRole('radio', { name: 'Português' })).toBeChecked()
  })
})
