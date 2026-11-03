import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ADMIN_SESSION, mockSignedIn, renderWithProviders } from '../utils/test-utils'
import { AdminLayout } from './AdminLayout'

afterEach(() => {
  window.innerWidth = 1024
  window.dispatchEvent(new Event('resize'))
})

describe('AdminLayout', () => {
  it('desktop: the language menu sits in the top bar', async () => {
    mockSignedIn(ADMIN_SESSION)
    const user = userEvent.setup()
    renderWithProviders(<AdminLayout />, { route: '/admin' })
    expect(await screen.findByRole('navigation', { name: 'Secciones' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Idioma: Español' }))
    const menu = await screen.findByRole('menu', { name: 'Idioma: Español' })
    await user.click(within(menu).getByRole('menuitemradio', { name: 'English' }))
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    expect(screen.getByRole('button', { name: 'Language: English' })).toHaveTextContent('EN')
  })

  it('phone: the languages are listed in the account panel', async () => {
    window.innerWidth = 390
    mockSignedIn(ADMIN_SESSION)
    const user = userEvent.setup()
    renderWithProviders(<AdminLayout />, { route: '/admin' })
    const account = await screen.findByRole('button', { name: 'Menú de usuario: Ada Admin' })
    expect(screen.queryByRole('button', { name: /^Idioma: / })).not.toBeInTheDocument()

    await user.click(account)
    const panel = await screen.findByRole('dialog', { name: 'Menú de usuario' })
    await user.click(within(within(panel).getByRole('radiogroup', { name: 'Idioma' })).getByRole('radio', { name: 'English' }))
    expect(document.documentElement.lang).toBe('en')
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'User menu' })).toBeInTheDocument())
    expect(within(screen.getByRole('dialog', { name: 'User menu' })).getByRole('link', { name: 'Timeline' })).toBeInTheDocument()
  })
})
