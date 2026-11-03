import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { hubFill } from '../utils/color'
import { mockSignedIn, renderWithProviders } from '../utils/test-utils'
import { EventNode } from './EventNode'
import { DEMO_CATEGORIES } from './testing/demoData'

const [general, academic, teething, language, sleep] = DEMO_CATEGORIES
const COVER = { thumb_url: '/api/media/abc/thumb', dominant_color: '#d9a066' }

function renderNode(props: Partial<Parameters<typeof EventNode>[0]> = {}) {
  mockSignedIn()
  return renderWithProviders(
    <EventNode title="Primeros pasos" date="2026-03-12" categories={[language, sleep]} cover={COVER} href="/c/ana/e/5" {...props} />,
  )
}

describe('EventNode', () => {
  it('is a link named after the title, the long date and the categories', async () => {
    renderNode()
    const link = await screen.findByRole('link', {
      name: 'Primeros pasos · 12 de marzo de 2026 · Lenguaje y comunicación, Sueño',
    })
    expect(link).toHaveAttribute('href', '/c/ana/e/5')
    expect(link).toHaveTextContent('12 mar')
  })

  it('shows the title in a pill with the full text as a tooltip', async () => {
    renderNode({ title: 'Un título muy largo que no cabe en dos líneas de la etiqueta del círculo' })
    const link = await screen.findByRole('link')
    const pill = link.querySelector('.label')
    expect(pill).toHaveAttribute('title', 'Un título muy largo que no cabe en dos líneas de la etiqueta del círculo')
  })

  it('splits the ring and the pill border into category colours, in order', async () => {
    renderNode({ categories: [language, sleep, teething] })
    const link = await screen.findByRole('link')
    const ring = link.style.getPropertyValue('--ring')
    expect(ring).toMatch(/^conic-gradient\(from 0deg, /)
    expect(ring.indexOf(language.color)).toBeLessThan(ring.indexOf(sleep.color))
    expect(ring.indexOf(sleep.color)).toBeLessThan(ring.indexOf(teething.color))
    expect(link.style.getPropertyValue('--label-border')).toMatch(/^linear-gradient\(90deg, #f59e0b 0% 33.333%/)
  })

  it('shows up to three category badges and then +N', async () => {
    renderNode({ categories: [language, sleep, teething, academic, general] })
    const link = await screen.findByRole('link')
    const badges = link.querySelector('.badges')
    expect(badges).toHaveAttribute('aria-hidden', 'true')
    expect(badges?.querySelectorAll('.badge')).toHaveLength(3)
    expect(badges).toHaveTextContent('+2')
  })

  it('lazy-loads the cover over its dominant colour and fades it in once loaded', async () => {
    renderNode()
    const link = await screen.findByRole('link')
    const image = link.querySelector('img')
    expect(image).toHaveAttribute('src', COVER.thumb_url)
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('alt', '')
    expect(link.style.getPropertyValue('--photo-bg')).toBe(COVER.dominant_color)
    expect(image).not.toHaveAttribute('data-loaded')
    fireEvent.load(image as HTMLImageElement)
    expect(image).toHaveAttribute('data-loaded', 'true')
  })

  it('falls back to a category gradient with the icon without a photo (or when it fails)', async () => {
    const { unmount } = renderNode({ cover: null })
    let link = await screen.findByRole('link')
    expect(link.querySelector('img')).toBeNull()
    expect(link.querySelector('[data-fallback] svg')).not.toBeNull()
    expect(link.style.getPropertyValue('--photo-bg')).toBe(hubFill(language.color))
    unmount()
    renderNode()
    link = await screen.findByRole('link')
    fireEvent.error(link.querySelector('img') as HTMLImageElement)
    expect(link.querySelector('img')).toBeNull()
    expect(link.querySelector('[data-fallback]')).not.toBeNull()
  })

  it('calls onOpen when clicked and can be a decorative copy', async () => {
    const onOpen = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    const { unmount } = renderNode({ onOpen })
    fireEvent.click(await screen.findByRole('link'))
    expect(onOpen).toHaveBeenCalledTimes(1)
    unmount()
    const { container } = renderNode({ decorative: true })
    await waitFor(() => expect(container.querySelector('.node')).not.toBeNull())
    expect(container.querySelector('.node')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('exposes a non-link node as an image (admin previews)', async () => {
    renderNode({ href: undefined })
    expect(await screen.findByRole('img', { name: /^Primeros pasos · 12 de marzo de 2026/ })).toBeInTheDocument()
  })
})
