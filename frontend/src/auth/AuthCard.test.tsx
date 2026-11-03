import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ANONYMOUS_SESSION, mockApi, renderWithProviders } from '../utils/test-utils'
import { AuthCard } from './AuthCard'

describe('AuthCard', () => {
  it('switches the language of the signed-out pages from the menu in the corner', async () => {
    mockApi({ 'GET /api/auth/session': ANONYMOUS_SESSION })
    const user = userEvent.setup()
    renderWithProviders(
      <AuthCard>
        <p>Formulario</p>
      </AuthCard>,
      { route: '/login' },
    )
    expect(await screen.findByText('Los hitos de nuestra familia')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Idioma: Español' }))
    const menu = await screen.findByRole('menu', { name: 'Idioma: Español' })
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Português' }))
    expect(await screen.findByText('Os marcos da nossa família')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('pt')
    expect(localStorage.getItem('timelife.lang')).toBe('pt')
    expect(screen.getByRole('button', { name: /: Português$/ })).toHaveTextContent('PT')

    await user.click(screen.getByRole('button', { name: /: Português$/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'English' }))
    expect(await screen.findByText('Our family milestones')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
  })
})
