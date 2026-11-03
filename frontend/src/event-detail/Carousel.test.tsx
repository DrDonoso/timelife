import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ImageOut } from '../api/schema.gen'
import { mockSignedIn, renderWithProviders } from '../utils/test-utils'
import { Carousel, type CarouselHandle } from './Carousel'

function image(id: string, name: string, width = 1600, height = 1000): ImageOut {
  return {
    id,
    name,
    kind: 'image',
    width,
    height,
    dominant_color: '#8a6f5c',
    crop: null,
    thumb_url: `/api/media/${id}/thumb`,
    display_url: `/api/media/${id}/display`,
    video_status: null,
    video_url: null,
    duration: null,
    live: false,
  }
}

const IMAGES = [
  image('p1', 'Primer paso', 1000, 1500),
  image('p2', 'Columpio'),
  image('p3', 'Merienda', 1200, 1200),
  image('p4', 'Siesta', 2400, 1000),
  image('p5', 'Baño'),
]

function renderCarousel(images: ImageOut[] = IMAGES, extra?: ReactNode) {
  mockSignedIn()
  return renderWithProviders(
    <>
      {extra}
      <Carousel images={images} label="Fotos de «Primeros pasos»" />
    </>,
  )
}

const strip = () => screen.findByRole('region', { name: 'Fotos de «Primeros pasos»' })
const counter = () => document.querySelector('.counter')?.textContent
const photos = () => Array.from(document.querySelectorAll<HTMLImageElement>('img.photo'))

describe('Carousel', () => {
  it('renders one slide per image, in order, naming each photo only for assistive tech (alt, no tooltip)', async () => {
    renderCarousel()
    const region = await strip()
    expect(region).toHaveAttribute('aria-roledescription', 'carrusel')
    expect(region).toHaveAttribute('tabindex', '0')
    const slides = within(region).getAllByRole('group')
    expect(slides).toHaveLength(5)
    expect(slides[1]).toHaveAccessibleName('2 de 5')
    expect(photos().map((photo) => photo.alt)).toEqual(['Primer paso', 'Columpio', 'Merienda', 'Siesta', 'Baño'])
    for (const photo of photos()) {
      expect(photo).not.toHaveAttribute('title')
      expect(photo.getAttribute('src')).toMatch(/^\/api\/media\/p\d\/display$/)
    }
    // The file name is never painted over the photo.
    expect(screen.queryByText('Primer paso')).not.toBeInTheDocument()
  })

  it('paints the dominant colour and loads only nearby slides eagerly', async () => {
    renderCarousel()
    await strip()
    const slides = Array.from(document.querySelectorAll<HTMLElement>('.slide'))
    expect(slides[0].style.backgroundColor).toBe('rgb(138, 111, 92)')
    expect(photos().map((photo) => photo.getAttribute('loading'))).toEqual(['eager', 'eager', 'lazy', 'lazy', 'lazy'])
    const backdrops = Array.from(document.querySelectorAll<HTMLElement>('.backdrop'))
    expect(backdrops[0].style.backgroundImage).toContain('/api/media/p1/thumb')
    expect(backdrops[1].style.backgroundImage).toContain('/api/media/p2/thumb')
    expect(backdrops[3].style.backgroundImage).toBe('')
    expect(photos()[0]).toHaveAttribute('fetchpriority', 'high')
  })

  it('moves with the arrow buttons and hands focus over at the ends', async () => {
    const user = userEvent.setup()
    renderCarousel(IMAGES.slice(0, 2))
    await strip()
    expect(counter()).toBe('1 / 2')
    expect(screen.queryByRole('button', { name: 'Foto anterior' })).not.toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Foto siguiente' })
    await user.click(next)
    expect(counter()).toBe('2 / 2')
    expect(screen.queryByRole('button', { name: 'Foto siguiente' })).not.toBeInTheDocument()
    const previous = screen.getByRole('button', { name: 'Foto anterior' })
    await waitFor(() => expect(previous).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(counter()).toBe('1 / 2')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Foto siguiente' })).toHaveFocus())
  })

  it('follows ←/→ (and Home/End on the strip), ignoring keys typed in fields', async () => {
    const user = userEvent.setup()
    renderCarousel(IMAGES, <input aria-label="Campo" />)
    await strip()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(counter()).toBe('3 / 5')
    await user.keyboard('{ArrowLeft}')
    expect(counter()).toBe('2 / 5')
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(counter()).toBe('1 / 5')

    await user.click(screen.getByRole('textbox', { name: 'Campo' }))
    await user.keyboard('{ArrowRight}')
    expect(counter()).toBe('1 / 5')

    screen.getByRole('region', { name: 'Fotos de «Primeros pasos»' }).focus()
    await user.keyboard('{End}')
    expect(counter()).toBe('5 / 5')
    await user.keyboard('{Home}')
    expect(counter()).toBe('1 / 5')
    await user.keyboard('{Control>}{ArrowRight}{/Control}')
    expect(counter()).toBe('1 / 5')
  })

  it('has one dot per photo; the current one is marked and dots jump to their photo', async () => {
    const user = userEvent.setup()
    renderCarousel()
    const pagination = await screen.findByRole('group', { name: 'Elegir foto' })
    const dots = within(pagination).getAllByRole('button')
    expect(dots.map((dot) => dot.getAttribute('aria-label'))).toEqual([
      'Ver la foto 1 de 5',
      'Ver la foto 2 de 5',
      'Ver la foto 3 de 5',
      'Ver la foto 4 de 5',
      'Ver la foto 5 de 5',
    ])
    expect(dots[0]).toHaveAttribute('aria-current', 'true')
    await user.click(dots[3])
    expect(counter()).toBe('4 / 5')
    expect(within(pagination).getByRole('button', { name: 'Ver la foto 4 de 5' })).toHaveAttribute('aria-current', 'true')
    expect(within(pagination).getByRole('button', { name: 'Ver la foto 1 de 5' })).not.toHaveAttribute('aria-current')
    // The neighbours of the new photo are now loaded eagerly too.
    expect(photos().map((photo) => photo.getAttribute('loading'))).toEqual(['lazy', 'lazy', 'eager', 'eager', 'eager'])
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Foto 4 de 5: Siesta')
  })

  it('shows at most seven dots for long albums', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 12 }, (_, index) => image(`m${index}`, `Foto ${index + 1}`))
    renderCarousel(many)
    const pagination = await screen.findByRole('group', { name: 'Elegir foto' })
    expect(within(pagination).getAllByRole('button')).toHaveLength(7)
    expect(counter()).toBe('1 / 12')
    await user.click(within(pagination).getByRole('button', { name: 'Ver la foto 7 de 12' }))
    const labels = within(pagination)
      .getAllByRole('button')
      .map((dot) => dot.getAttribute('aria-label'))
    expect(labels[0]).toBe('Ver la foto 4 de 12')
    expect(labels.at(-1)).toBe('Ver la foto 10 de 12')
  })

  it('has no arrows, dots or counter for a single photo', async () => {
    renderCarousel([IMAGES[1]])
    const region = await strip()
    expect(region).not.toHaveAttribute('tabindex')
    expect(screen.getByRole('img', { name: 'Columpio' })).not.toHaveAttribute('title')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(counter()).toBeUndefined()
    // No visible caption with the file name either (touch screens included).
    expect(screen.queryByText('Columpio')).not.toBeInTheDocument()
  })

  it('reveals each photo once loaded and explains broken ones', async () => {
    renderCarousel(IMAGES.slice(0, 2))
    await strip()
    const [first, second] = photos()
    expect(first).not.toHaveAttribute('data-loaded')
    fireEvent.load(first)
    expect(first).toHaveAttribute('data-loaded')
    fireEvent.error(second)
    const broken = screen.getByRole('img', { name: 'Columpio' })
    expect(broken).toHaveTextContent('No se ha podido cargar esta foto')
    expect(broken).not.toHaveAttribute('title')
  })

  it('opens on the requested photo and reports every change', async () => {
    const user = userEvent.setup()
    const onIndexChange = vi.fn()
    mockSignedIn()
    renderWithProviders(<Carousel images={IMAGES} label="Fotos de «Primeros pasos»" initialIndex={2} onIndexChange={onIndexChange} />)
    await strip()
    expect(counter()).toBe('3 / 5')
    expect(within(screen.getByRole('group', { name: 'Elegir foto' })).getByRole('button', { name: 'Ver la foto 3 de 5' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(onIndexChange).not.toHaveBeenCalled()
    await user.keyboard('{ArrowRight}')
    expect(counter()).toBe('4 / 5')
    expect(onIndexChange).toHaveBeenLastCalledWith(3)
  })

  it('offers the photos full screen with a tap on the photo or the button', async () => {
    const user = userEvent.setup()
    const onExpand = vi.fn()
    mockSignedIn()
    renderWithProviders(<Carousel images={IMAGES} label="Fotos de «Primeros pasos»" onExpand={onExpand} />)
    await strip()
    await user.click(photos()[0])
    expect(onExpand).toHaveBeenLastCalledWith(0)
    await user.keyboard('{ArrowRight}')
    await user.click(screen.getByRole('button', { name: 'Ver la foto a pantalla completa' }))
    expect(onExpand).toHaveBeenLastCalledWith(1)
  })

  it('has no full-screen affordance unless asked for', async () => {
    renderCarousel()
    await strip()
    expect(screen.queryByRole('button', { name: 'Ver la foto a pantalla completa' })).not.toBeInTheDocument()
  })

  it('leaves videos and the LIVE badge to themselves when offering photos full screen', async () => {
    const user = userEvent.setup()
    const onExpand = vi.fn()
    const movie: ImageOut = { ...image('v1', 'Paseo'), kind: 'video', video_status: 'ready', video_url: '/api/media/v1/video', duration: 30 }
    const live: ImageOut = { ...image('l1', 'Risas'), video_status: 'ready', video_url: '/api/media/l1/video', duration: 2, live: true }
    mockSignedIn()
    renderWithProviders(<Carousel images={[movie, live]} label="Fotos de «Primeros pasos»" onExpand={onExpand} />)
    await strip()
    // A video has its own player (full screen included): no button, taps go to the player.
    expect(screen.queryByRole('button', { name: 'Ver la foto a pantalla completa' })).not.toBeInTheDocument()
    await user.click(document.querySelector('video.video') as HTMLVideoElement)
    expect(onExpand).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Foto siguiente' }))
    await user.click(screen.getByRole('button', { name: /^Reproducir la foto Live/ }))
    expect(onExpand).not.toHaveBeenCalled()
    await user.click(screen.getByRole('img', { name: 'Risas' }))
    expect(onExpand).toHaveBeenLastCalledWith(1)
    await user.click(screen.getByRole('button', { name: 'Ver la foto a pantalla completa' }))
    expect(onExpand).toHaveBeenCalledTimes(2)
  })

  it('jumps to a photo on demand (show)', async () => {
    const ref = createRef<CarouselHandle>()
    mockSignedIn()
    renderWithProviders(<Carousel ref={ref} images={IMAGES} label="Fotos de «Primeros pasos»" />)
    await strip()
    act(() => ref.current?.show(4))
    expect(counter()).toBe('5 / 5')
  })

  it('mixes photos, videos and Live Photos', async () => {
    const user = userEvent.setup()
    const movie: ImageOut = { ...image('v1', 'Paseo'), kind: 'video', video_status: 'ready', video_url: '/api/media/v1/video', duration: 30 }
    const live: ImageOut = { ...image('l1', 'Risas'), video_status: 'ready', video_url: '/api/media/l1/video', duration: 2, live: true }
    const off: ImageOut = { ...live, id: 'l2', name: 'Quieta', live: false }
    renderCarousel([movie, live, off])
    const region = await strip()
    const slides = within(region).getAllByRole('group')
    expect(slides.map((slide) => [slide.getAttribute('aria-roledescription'), slide.dataset.kind])).toEqual([
      ['vídeo', 'video'],
      ['foto', 'live'],
      ['foto', 'photo'],
    ])
    const player = slides[0].querySelector('video') as HTMLVideoElement
    expect(player).toHaveAttribute('src', '/api/media/v1/video')
    // Only the Live Photo that is on has a LIVE badge (and its clip).
    expect(screen.getAllByRole('button', { name: /Reproducir la foto Live/ })).toHaveLength(1)
    expect(slides[2].querySelector('video')).toBeNull()
    expect(document.querySelector('.carousel')).toHaveAttribute('data-multiple')

    const pause = vi.spyOn(player, 'pause')
    await user.click(screen.getByRole('button', { name: 'Foto siguiente' }))
    expect(pause).toHaveBeenCalled()
  })
})
