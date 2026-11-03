import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useI18n } from '../i18n'
import { THEMES } from '../theme/themes'
import { contrastRatio, hubFill } from '../utils/color'
import { mockSignedIn, renderWithProviders } from '../utils/test-utils'
import { HubNode, type HubNodeProps } from './HubNode'
import { hubColors } from './palette'

const BLUE = hubColors('#3b82f6')
const HUB_BADGE_BG = THEMES.sunset.hubBadge

function renderHub(props: Partial<HubNodeProps> = {}) {
  mockSignedIn()
  return renderWithProviders(<HubNode kind="month" year={2026} month={3} count={4} colors={BLUE} onActivate={() => {}} {...props} />)
}

describe('HubNode', () => {
  it("shows only the month's first three letters, with the full text as its name", async () => {
    renderHub()
    const hub = await screen.findByRole('button', { name: 'marzo de 2026 · 4 hitos' })
    expect(hub.querySelector('.name')).toHaveTextContent(/^MAR$/)
    expect(hub.querySelector('.count')).toHaveTextContent('4')
    expect(hub.querySelector('.count')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows the year and a singular count', async () => {
    renderHub({ kind: 'year', month: null, count: 1 })
    const hub = await screen.findByRole('button', { name: '2026 · 1 hito' })
    expect(hub.querySelector('.name')).toHaveTextContent(/^2026$/)
  })

  it('is translated', async () => {
    mockSignedIn()
    function Harness() {
      const { setLang } = useI18n()
      return (
        <>
          <HubNode kind="month" year={2026} month={3} count={4} colors={BLUE} onActivate={() => {}} />
          <button type="button" onClick={() => setLang('en')}>
            EN
          </button>
        </>
      )
    }
    renderWithProviders(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'EN' }))
    expect(screen.getByRole('button', { name: 'March 2026 · 4 milestones' })).toBeInTheDocument()
  })

  it('paints the pearl fill and contrast-safe numbers', async () => {
    renderHub()
    const hub = await screen.findByRole('button')
    expect(hub.style.getPropertyValue('--hub-fill')).toBe(hubFill('#3b82f6'))
    const light = hub.style.getPropertyValue('--badge-text-light')
    const dark = hub.style.getPropertyValue('--badge-text-dark')
    expect(contrastRatio(light, HUB_BADGE_BG.light)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark, HUB_BADGE_BG.dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(hub.style.getPropertyValue('--hub-text'), '#3b82f6')).toBeGreaterThanOrEqual(3)
  })

  it('uses a deep shade of its own hue for numbers on light hubs', () => {
    const january = hubColors('#c7dcff')
    expect(january.text).not.toBe('#ffffff')
    expect(contrastRatio(january.text, january.color)).toBeGreaterThanOrEqual(4.5)
  })

  it("keeps the count numbers readable on every palette's badge background", () => {
    for (const { hubBadge } of Object.values(THEMES)) {
      const colors = hubColors('#f59e0b', hubBadge)
      expect(contrastRatio(colors.badgeLight, hubBadge.light)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(colors.badgeDark, hubBadge.dark)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('drills in when activated', async () => {
    const onActivate = vi.fn()
    renderHub({ onActivate })
    fireEvent.click(await screen.findByRole('button', { name: 'marzo de 2026 · 4 hitos' }))
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('counts up to its total when popping in', async () => {
    renderHub({ count: 12, countFrom: 0 })
    const hub = await screen.findByRole('button')
    await waitFor(() => expect(hub.querySelector('.count')).toHaveTextContent('12'))
  })

  it('renders decorative copies without a button or caption', async () => {
    const { container } = renderHub({ decorative: true })
    await waitFor(() => expect(container.querySelector('.hub')).not.toBeNull())
    expect(container.querySelector('.hub')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.caption')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
