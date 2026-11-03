import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageOut } from '../api/schema.gen'
import { fireTouch, mockSignedIn, renderWithProviders, type Finger } from '../utils/test-utils'
import { SWIPE_CLOSE_MS } from '../utils/useSwipeToClose'
import { PhotoViewer } from './PhotoViewer'

const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => motion.reduced,
}))

afterEach(() => {
  motion.reduced = false
  Reflect.deleteProperty(window, 'visualViewport')
})

function image(id: string, name: string): ImageOut {
  return {
    id,
    name,
    kind: 'image',
    width: 1600,
    height: 1000,
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

const IMAGES = [image('p1', 'Primer paso'), image('p2', 'Columpio'), image('p3', 'Merienda')]

/** Renders the viewer (jsdom: 768 px tall, so a swipe closes from 115 px down) with fake timers. */
async function renderViewer() {
  const onClose = vi.fn()
  mockSignedIn()
  renderWithProviders(<PhotoViewer images={IMAGES} title="Primeros pasos" initialIndex={0} onIndexChange={vi.fn()} onClose={onClose} />)
  const viewer = await screen.findByRole('dialog', { name: 'Fotos de «Primeros pasos» a pantalla completa' })
  // Frozen clock: events carry Date.now() as their time stamp, so speeds are only what a test sets.
  vi.useFakeTimers()
  return { viewer, photo: screen.getByRole('img', { name: 'Primer paso' }), onClose }
}

/**
 * A finger pressing `target` at the first point, then moving through the others (`stepMs` apart).
 * Returns, for each move, whether it was left to the browser (not cancelled).
 */
function press(target: Element, [start, ...moves]: Finger[], { stepMs = 0, cancelable = true } = {}): boolean[] {
  fireTouch(target, 'touchstart', [start])
  return moves.map((point) => {
    if (stepMs) act(() => vi.advanceTimersByTime(stepMs))
    return fireTouch(target, 'touchmove', [point], { cancelable })
  })
}

function lift(target: Element, point: Finger) {
  fireTouch(target, 'touchend', [], { changed: [point] })
}

const swipeOf = (viewer: HTMLElement) => ({
  state: viewer.dataset.swipe,
  y: viewer.style.getPropertyValue('--swipe-y'),
  progress: viewer.style.getPropertyValue('--swipe'),
})

const AT_REST = { state: undefined, y: '', progress: '' }

describe('PhotoViewer: swipe down to close', () => {
  it('follows a finger swiping the photo down and closes, after its glide, once released far enough', async () => {
    const { viewer, photo, onClose } = await renderViewer()
    // Within the slop it may still be a tap: left alone.
    expect(press(photo, [[180, 300], [182, 306]])).toEqual([true])
    expect(swipeOf(viewer).state).toBeUndefined()

    // Heading down past it: the photo follows instead of the browser scrolling.
    expect(fireTouch(photo, 'touchmove', [[184, 330]])).toBe(false)
    expect(swipeOf(viewer)).toEqual({ state: 'drag', y: '0px', progress: '0' })
    fireTouch(photo, 'touchmove', [[186, 450]])
    expect(swipeOf(viewer)).toEqual({ state: 'drag', y: '120px', progress: '0.46875' })

    lift(photo, [186, 450])
    expect(swipeOf(viewer)).toEqual({ state: 'close', y: '768px', progress: '1' })
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('glides back when the swipe falls short, and a quick flick closes', async () => {
    const { viewer, photo, onClose } = await renderViewer()
    press(photo, [
      [180, 300],
      [180, 320],
      [180, 400],
    ])
    lift(photo, [180, 400])
    expect(swipeOf(viewer)).toEqual(AT_REST)
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).not.toHaveBeenCalled()

    // 60 px in 32 ms: carried on by its speed, it would go well past the line.
    press(
      photo,
      [
        [180, 300],
        [180, 315],
        [180, 345],
        [180, 375],
      ],
      { stepMs: 16 },
    )
    lift(photo, [180, 375])
    expect(swipeOf(viewer).state).toBe('close')
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves sideways swipes to the carousel and upward ones to the browser', async () => {
    const { viewer, photo, onClose } = await renderViewer()
    expect(
      press(photo, [
        [180, 300],
        [230, 306],
        [230, 600],
      ]),
    ).toEqual([true, true])
    lift(photo, [230, 600])
    expect(
      press(photo, [
        [180, 300],
        [180, 250],
        [180, 600],
      ]),
    ).toEqual([true, true])
    lift(photo, [180, 600])
    expect(swipeOf(viewer).state).toBeUndefined()
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still follows a finger the browser already scrolls with (its moves can no longer be cancelled)', async () => {
    const { viewer, photo, onClose } = await renderViewer()
    press(
      photo,
      [
        [180, 300],
        [180, 330],
        [180, 600],
      ],
      { cancelable: false },
    )
    expect(swipeOf(viewer)).toEqual({ state: 'drag', y: '270px', progress: '1' })
    lift(photo, [180, 600])
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('gives way to a second finger (pinch-zoom) and to a cancelled touch', async () => {
    const { viewer, photo, onClose } = await renderViewer()
    press(photo, [
      [180, 300],
      [180, 330],
      [180, 400],
    ])
    expect(swipeOf(viewer).state).toBe('drag')
    fireTouch(photo, 'touchstart', [[180, 400], [260, 420, 2]], { changed: [[260, 420, 2]] })
    expect(swipeOf(viewer)).toEqual(AT_REST)
    expect(fireTouch(photo, 'touchmove', [[180, 600], [260, 640, 2]])).toBe(true)
    fireTouch(photo, 'touchend', [], { changed: [[180, 600], [260, 640, 2]] })
    expect(swipeOf(viewer).state).toBeUndefined()

    press(photo, [
      [180, 300],
      [180, 330],
      [180, 600],
    ])
    fireTouch(photo, 'touchcancel', [], { changed: [[180, 600]] })
    expect(swipeOf(viewer)).toEqual(AT_REST)
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('puts the photo back when a new touch comes before the end of a swipe (its end went missing)', async () => {
    const { viewer, photo, onClose } = await renderViewer()
    press(photo, [
      [180, 300],
      [180, 330],
      [180, 600],
    ])
    fireTouch(photo, 'touchstart', [[120, 200, 3]])
    fireTouch(photo, 'touchend', [], { changed: [[120, 200, 3]] })
    expect(swipeOf(viewer)).toEqual(AT_REST)
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets one finger pan around a zoomed-in page', async () => {
    const viewport = Object.assign(new EventTarget(), { scale: 2 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    const { viewer, photo, onClose } = await renderViewer()
    expect(viewer).toHaveAttribute('data-zoomed')
    expect(
      press(photo, [
        [180, 300],
        [180, 330],
        [180, 600],
      ]),
    ).toEqual([true, true])
    lift(photo, [180, 600])
    expect(swipeOf(viewer).state).toBeUndefined()
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).not.toHaveBeenCalled()

    // Pinched back out: swiping works again.
    viewport.scale = 1
    act(() => viewport.dispatchEvent(new Event('resize')))
    expect(viewer).not.toHaveAttribute('data-zoomed')
    press(photo, [
      [180, 300],
      [180, 330],
      [180, 600],
    ])
    lift(photo, [180, 600])
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes at once with reduced motion', async () => {
    motion.reduced = true
    const { photo, onClose } = await renderViewer()
    press(photo, [
      [180, 300],
      [180, 330],
      [180, 600],
    ])
    lift(photo, [180, 600])
    act(() => vi.advanceTimersByTime(0))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves only once when ✕ or Esc is used while the photo glides away', async () => {
    const { viewer, photo, onClose } = await renderViewer()
    press(photo, [
      [180, 300],
      [180, 330],
      [180, 600],
    ])
    lift(photo, [180, 600])
    fireEvent.click(screen.getByRole('button', { name: 'Salir de la pantalla completa' }))
    fireEvent.keyDown(viewer, { key: 'Escape' })
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('is not held back by text selected elsewhere (the card under it)', async () => {
    const { viewer, photo, onClose } = await renderViewer()
    const notes = document.body.appendChild(document.createElement('p'))
    notes.textContent = 'Se soltó del sofá'
    window.getSelection()?.selectAllChildren(notes)
    press(photo, [
      [180, 300],
      [180, 330],
      [180, 600],
    ])
    expect(swipeOf(viewer).state).toBe('drag')
    lift(photo, [180, 600])
    act(() => vi.advanceTimersByTime(SWIPE_CLOSE_MS))
    expect(onClose).toHaveBeenCalledTimes(1)
    window.getSelection()?.removeAllRanges()
    notes.remove()
  })
})