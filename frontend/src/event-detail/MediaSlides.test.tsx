import { act, fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageOut } from '../api/schema.gen'
import { mockSignedIn, renderWithProviders } from '../utils/test-utils'
import { HOLD_MS, LivePhoto, VideoSlide, playFromStart, slideKind } from './MediaSlides'

const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => motion.reduced,
}))

afterEach(() => {
  motion.reduced = false
  vi.restoreAllMocks()
})

function item(changes: Partial<ImageOut> = {}): ImageOut {
  return {
    id: 'l1',
    name: 'Risas',
    kind: 'image',
    width: 1200,
    height: 900,
    dominant_color: '#806040',
    crop: null,
    thumb_url: '/api/media/l1/thumb',
    display_url: '/api/media/l1/display',
    video_status: 'ready',
    video_url: '/api/media/l1/video',
    duration: 2.4,
    live: true,
    ...changes,
  }
}

/** A Live Photo or video slide whose `active` (and `paused`) state the test switches with buttons. */
function Harness({ image, initial = true }: { image: ImageOut; initial?: boolean }) {
  const [active, setActive] = useState(initial)
  const [paused, setPaused] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setActive((value) => !value)}>
        cambiar
      </button>
      <button type="button" onClick={() => setPaused((value) => !value)}>
        tapar
      </button>
      {image.kind === 'video' ? (
        <VideoSlide image={image} active={active} near />
      ) : (
        <LivePhoto image={image} active={active} near paused={paused}>
          <img className="photo" src={image.display_url} alt={image.name} />
        </LivePhoto>
      )}
    </>
  )
}

function render(image: ImageOut, initial = true) {
  mockSignedIn()
  return renderWithProviders(<Harness image={image} initial={initial} />)
}

const clip = () => document.querySelector<HTMLVideoElement>('video.motion') as HTMLVideoElement
const toggle = () => fireEvent.click(screen.getByRole('button', { name: 'cambiar' }))
const cover = () => fireEvent.click(screen.getByRole('button', { name: 'tapar' }))

describe('slideKind', () => {
  it('plays videos, moves Live Photos that are on and ready, shows everything else still', () => {
    expect(slideKind(item({ kind: 'video' }))).toBe('video')
    expect(slideKind(item())).toBe('live')
    expect(slideKind(item({ live: false }))).toBe('photo')
    expect(slideKind(item({ video_status: 'processing', video_url: null }))).toBe('photo')
    expect(slideKind(item({ video_status: null, video_url: null, live: false }))).toBe('photo')
  })
})

describe('playFromStart', () => {
  it('plays with sound, muted when the browser blocks sound without a gesture', async () => {
    const video = document.createElement('video')
    const play = vi
      .spyOn(video, 'play')
      .mockRejectedValueOnce(new DOMException('No gesture', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined)
    video.currentTime = 1
    await playFromStart(video)
    expect(play).toHaveBeenCalledTimes(2)
    expect([video.muted, video.currentTime]).toEqual([true, 0])
  })

  it('gives up quietly on other failures', async () => {
    const video = document.createElement('video')
    const play = vi.spyOn(video, 'play').mockRejectedValue(new DOMException('Interrupted', 'AbortError'))
    await playFromStart(video)
    expect(play).toHaveBeenCalledTimes(1)
    expect(video.muted).toBe(false)
  })
})

describe('LivePhoto', () => {
  it('moves once, with sound, each time it becomes the current slide', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    render(item(), false)
    expect(play).not.toHaveBeenCalled()
    expect(clip()).toHaveAttribute('src', '/api/media/l1/video')
    expect(clip()).toHaveAttribute('aria-hidden', 'true')

    await act(async () => toggle())
    expect(play).toHaveBeenCalledTimes(1)
    expect(clip().muted).toBe(false)
    expect(clip()).toHaveAttribute('data-playing')
    fireEvent.ended(clip())
    expect(clip()).not.toHaveAttribute('data-playing')

    // Leaving the slide stops it; coming back plays it again.
    await act(async () => toggle())
    await act(async () => toggle())
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('stays still while covered (paused), even becoming the current slide, and is not replayed once uncovered', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause')
    render(item())
    expect(play).toHaveBeenCalledTimes(1)
    pause.mockClear()

    // Covered while its clip plays: it stops.
    await act(async () => cover())
    expect(pause).toHaveBeenCalledTimes(1)
    expect(clip()).not.toHaveAttribute('data-playing')
    // Becoming the current slide again behind the cover does not play it…
    await act(async () => toggle())
    await act(async () => toggle())
    expect(play).toHaveBeenCalledTimes(1)
    // …nor does uncovering it; a later change of slide does.
    await act(async () => cover())
    expect(play).toHaveBeenCalledTimes(1)
    await act(async () => toggle())
    await act(async () => toggle())
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('stays still with reduced motion until the LIVE badge is pressed or hovered', async () => {
    motion.reduced = true
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    render(item())
    expect(play).not.toHaveBeenCalled()
    const badge = screen.getByRole('button', { name: 'Reproducir la foto Live «Risas»' })
    expect(badge).toHaveTextContent('LIVE')
    await act(async () => fireEvent.click(badge))
    expect(play).toHaveBeenCalledTimes(1)
    await act(async () => fireEvent.pointerEnter(badge, { pointerType: 'mouse' }))
    expect(play).toHaveBeenCalledTimes(2)
    // Touch screens have no hover: only a press plays it.
    await act(async () => fireEvent.pointerEnter(badge, { pointerType: 'touch' }))
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('plays while the photo is held down, not when it is swiped', async () => {
    motion.reduced = true
    vi.useFakeTimers()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause')
    render(item())
    const photo = screen.getByRole('img', { name: 'Risas' })

    fireEvent.pointerDown(photo, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(photo, { clientX: 60, clientY: 12 })
    await act(async () => vi.advanceTimersByTime(HOLD_MS + 50))
    expect(play).not.toHaveBeenCalled()
    fireEvent.pointerUp(photo)

    fireEvent.pointerDown(photo, { button: 0, clientX: 10, clientY: 10 })
    await act(async () => vi.advanceTimersByTime(HOLD_MS + 50))
    expect(play).toHaveBeenCalledTimes(1)
    pause.mockClear()
    fireEvent.pointerUp(photo)
    expect(pause).toHaveBeenCalledTimes(1)
    // A long press must not open the browser's image menu.
    expect(fireEvent.contextMenu(photo)).toBe(false)
  })

  it('cancels the click that ends holding it down (not a tap on the photo), not a plain tap', async () => {
    motion.reduced = true
    vi.useFakeTimers()
    render(item())
    const photo = screen.getByRole('img', { name: 'Risas' })

    fireEvent.pointerDown(photo, { button: 0, clientX: 10, clientY: 10 })
    await act(async () => vi.advanceTimersByTime(HOLD_MS + 50))
    fireEvent.pointerUp(photo)
    expect(fireEvent.click(photo)).toBe(false)

    fireEvent.pointerDown(photo, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(photo)
    expect(fireEvent.click(photo)).toBe(true)
  })
})

describe('VideoSlide', () => {
  it('is the browser player over the poster, paused when another slide is shown', async () => {
    render(item({ kind: 'video', duration: 30 }))
    const player = document.querySelector('video') as HTMLVideoElement
    expect(player).toHaveAttribute('controls')
    expect(player).toHaveAttribute('playsinline')
    expect(player).toHaveAttribute('poster', '/api/media/l1/display')
    expect(player).toHaveAttribute('aria-label', 'Risas')
    const pause = vi.spyOn(player, 'pause')
    await act(async () => toggle())
    expect(pause).toHaveBeenCalled()
  })

  it('shows the poster and a note while converting or when it failed', () => {
    render(item({ kind: 'video', video_status: 'processing', video_url: null }))
    expect(document.querySelector('video')).toBeNull()
    expect(screen.getByRole('img', { name: 'Risas' })).toHaveAttribute('src', '/api/media/l1/display')
    expect(screen.getByText('Preparando el vídeo…')).toBeInTheDocument()
  })

  it('says when a video cannot be played', () => {
    render(item({ kind: 'video', video_status: 'failed', video_url: null }))
    expect(screen.getByText('Este vídeo no se puede reproducir')).toBeInTheDocument()
  })
})
