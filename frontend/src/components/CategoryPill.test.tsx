import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useI18n } from '../i18n'
import { contrastRatio, ensureContrast } from '../utils/color'
import { TEST_CATEGORIES, mockSignedIn, renderWithProviders } from '../utils/test-utils'
import { CategoryPill } from './CategoryPill'

const language = TEST_CATEGORIES[0] // amber: white text needs a deeper colour

function expandedState(button: HTMLElement) {
  return button.querySelector('[data-expanded]')?.getAttribute('data-expanded')
}

describe('CategoryPill', () => {
  it('is named after the category in the UI language', async () => {
    mockSignedIn()
    function Harness() {
      const { setLang } = useI18n()
      return (
        <>
          <CategoryPill category={language} />
          <button type="button" onClick={() => setLang('en')}>
            EN
          </button>
        </>
      )
    }
    renderWithProviders(<Harness />)
    expect(await screen.findByRole('button', { name: 'Lenguaje y comunicación' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByRole('button', { name: 'Language & communication' })).toBeInTheDocument()
  })

  it('uses the category colour deepened for white text, without a border', async () => {
    mockSignedIn()
    renderWithProviders(<CategoryPill category={language} />)
    const button = await screen.findByRole('button', { name: 'Lenguaje y comunicación' })
    const background = button.style.getPropertyValue('--pill-bg')
    expect(background).toBe(ensureContrast(language.color))
    expect(background).not.toBe(language.color)
    expect(contrastRatio(background, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('expands on hover and collapses when the pointer leaves', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    renderWithProviders(<CategoryPill category={language} />)
    const button = await screen.findByRole('button', { name: 'Lenguaje y comunicación' })
    expect(expandedState(button)).toBe('false')
    await user.hover(button)
    expect(expandedState(button)).toBe('true')
    await user.unhover(button)
    expect(expandedState(button)).toBe('false')
  })

  it('expands while focused with the keyboard', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    renderWithProviders(<CategoryPill category={language} />)
    const button = await screen.findByRole('button', { name: 'Lenguaje y comunicación' })
    await user.tab()
    expect(button).toHaveFocus()
    expect(expandedState(button)).toBe('true')
    await user.tab()
    expect(expandedState(button)).toBe('false')
  })

  it('toggles on tap and collapses when tapping elsewhere', async () => {
    mockSignedIn()
    renderWithProviders(
      <>
        <CategoryPill category={language} />
        <p>fuera</p>
      </>,
    )
    const button = await screen.findByRole('button', { name: 'Lenguaje y comunicación' })
    const tap = (target: Element) => {
      fireEvent.pointerDown(target, { pointerType: 'touch', pointerId: 1, button: 0, isPrimary: true })
      fireEvent.pointerUp(target, { pointerType: 'touch', pointerId: 1, button: 0, isPrimary: true })
      fireEvent.click(target, { detail: 1 })
    }
    tap(button)
    expect(expandedState(button)).toBe('true')
    fireEvent.pointerDown(screen.getByText('fuera'), { pointerType: 'touch', pointerId: 2 })
    expect(expandedState(button)).toBe('false')
    tap(button)
    tap(button)
    expect(expandedState(button)).toBe('false')
  })

  it('can be forced open (admin previews)', async () => {
    mockSignedIn()
    renderWithProviders(<CategoryPill category={language} expanded />)
    const button = await screen.findByRole('button', { name: 'Lenguaje y comunicación' })
    expect(expandedState(button)).toBe('true')
    expect(button).toHaveTextContent('Lenguaje y comunicación')
  })
})
