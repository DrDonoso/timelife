import { useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** Movement (px) that turns a press into a swipe: a swipe down when it heads more down than sideways. */
const SLOP_PX = 8
/** A released swipe closes when the stage, carried on by its speed, would get this far down (share of the height). */
const CLOSE_RATIO = 0.15
/** How long (ms) the release speed is taken to carry the stage on. */
const MOMENTUM_MS = 200
/** Moves of the last … ms that set the release speed. */
const VELOCITY_WINDOW_MS = 100
/** The stage glides off the screen (`--duration-normal`) before `onClose` (`exit: 'glide'`). */
export const SWIPE_CLOSE_MS = 220
/** Still there this long after `onClose` (its owner kept it open), the stage comes back. */
const CLOSE_FALLBACK_MS = 1000

/** Downward speed (px/ms) of the moves shortly before `now`, from `[time, y]` samples; 0 when unknown. */
export function releaseVelocity(samples: ReadonlyArray<readonly [number, number]>, now: number): number {
  const recent = samples.filter(([time]) => now - time <= VELOCITY_WINDOW_MS)
  if (recent.length < 2) return 0
  const [firstTime, firstY] = recent[0]
  const [lastTime, lastY] = recent[recent.length - 1]
  return lastTime > firstTime ? (lastY - firstY) / (lastTime - firstTime) : 0
}

/** Whether a swipe released `offset` px down, moving at `velocity` px/ms, closes a stage `height` px tall. */
export function swipeCloses(offset: number, velocity: number, height: number): boolean {
  return offset + velocity * MOMENTUM_MS >= height * CLOSE_RATIO
}

export interface SwipeToCloseOptions {
  /** Default true; false leaves every touch to the browser (e.g. while editing). */
  enabled?: boolean
  /**
   * The stage's content scroller: a swipe only starts at its top (further down, the finger scrolls
   * the content back first).
   */
  scrollerRef?: RefObject<HTMLElement | null>
  /**
   * `glide` (default): the stage glides off the screen (`SWIPE_CLOSE_MS`), then `onClose` runs.
   * `now`: `onClose` runs at once and the stage stays where the finger left it, for an exit
   * animation of its owner.
   */
  exit?: 'glide' | 'now'
}

interface Press {
  id: number
  startX: number
  startY: number
  /** Finger position when the stage started following it; `null` while it may still be a tap, a scroll or a sideways swipe. */
  originY: number | null
  offset: number
  samples: Array<[number, number]>
}

/** Pinch-zoomed in: one finger pans the page then. */
function isZoomedIn(): boolean {
  return (window.visualViewport?.scale ?? 1) > 1.01
}

/** Text selected in `element`: a finger moving there adjusts the selection. */
function hasSelectionIn(element: Element): boolean {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && selection.rangeCount > 0 && selection.getRangeAt(0).intersectsNode(element)
}

function findTouch(list: TouchList, id: number): Touch | undefined {
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].identifier === id) return list[index]
  }
  return undefined
}

/**
 * Swipe down to close, on touch screens: a finger pulling the stage (`ref`) down drags it. While
 * the finger is down the stage gets `data-swipe="drag"` and the CSS variables `--swipe-y` (px down)
 * and `--swipe` (0 → 1 over a third of its height), which its styles use to move it and uncover
 * what lies behind. Released far or fast enough it closes (`data-swipe="close"`, see `exit`);
 * otherwise it glides back. Sideways and upward swipes, pinches and a zoomed-in page stay the
 * browser's (the stage gets `data-zoomed` then).
 *
 * Touch events rather than pointer events: a browser that starts scrolling cancels the pointer but
 * keeps reporting the touch, so the stage follows the finger either way. It also cancels the
 * browser's own handling when it still can (iOS only lets the first touchmove do so). Once the
 * stage follows the finger it captures the finger's pointer, so a button the touch started on
 * (moving along with the stage) does not take the release for a press, and it follows the touch at
 * its own target too, whose events stop reaching the stage if React replaces it meanwhile.
 */
export function useSwipeToClose(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  { enabled = true, scrollerRef, exit = 'glide' }: SwipeToCloseOptions = {},
): void {
  const reduceMotion = useReducedMotion()
  const latestRef = useRef({ onClose, reduceMotion })
  useLayoutEffect(() => {
    latestRef.current = { onClose, reduceMotion }
  })

  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    // Typed non-null binding: the hoisted handlers below cannot see the narrowing above.
    const stage: HTMLElement = element
    let press: Press | null = null
    // Listeners at the press's own target (see `watch`).
    let watching: AbortController | null = null
    // The finger's pointer (the primary one last pressed on the stage).
    let pointerId: number | null = null
    let closeTimer = 0

    const height = () => stage.clientHeight || window.innerHeight

    function follow(offset: number) {
      stage.style.setProperty('--swipe-y', `${offset}px`)
      stage.style.setProperty('--swipe', String(Math.min(1, (3 * offset) / height())))
    }

    function settle() {
      delete stage.dataset.swipe
      stage.style.removeProperty('--swipe-y')
      stage.style.removeProperty('--swipe')
    }

    function close() {
      stage.dataset.swipe = 'close'
      const finish = () => {
        latestRef.current.onClose()
        closeTimer = window.setTimeout(settle, CLOSE_FALLBACK_MS)
      }
      if (exit === 'now') {
        finish()
        return
      }
      follow(height())
      closeTimer = window.setTimeout(finish, latestRef.current.reduceMotion ? 0 : SWIPE_CLOSE_MS)
    }

    function syncZoom() {
      if (isZoomedIn()) stage.dataset.zoomed = ''
      else delete stage.dataset.zoomed
    }

    /**
     * A touch's events always go to the element it started on, even once React has removed that
     * element from the page (a card that finished loading, say): they no longer bubble up to the
     * stage then, so they are taken at that element.
     */
    function watch(target: EventTarget | null) {
      if (!(target instanceof Node) || target === stage) return
      watching = new AbortController()
      const { signal } = watching
      const detached = () => !stage.contains(target)
      target.addEventListener(
        'touchmove',
        (event) => {
          if (detached()) onTouchMove(event as TouchEvent)
        },
        { passive: false, signal },
      )
      for (const type of ['touchend', 'touchcancel']) {
        target.addEventListener(
          type,
          (event) => {
            if (detached()) onTouchEnd(event as TouchEvent)
          },
          { signal },
        )
      }
    }

    function release() {
      press = null
      watching?.abort()
      watching = null
    }

    /** The pointer goes to the stage from now on, so its release is not a press of what lies under the finger. */
    function capturePointer() {
      if (pointerId === null) return
      try {
        stage.setPointerCapture(pointerId)
      } catch {
        // No longer an active pointer: the browser took the touch over, which ended any press.
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (event.isPrimary) pointerId = event.pointerId
    }

    function onTouchStart(event: TouchEvent) {
      if (stage.dataset.swipe === 'close') return
      // Another finger (a pinch is the browser's) or a new touch: a swipe in progress glides back.
      if (press && press.originY !== null) settle()
      release()
      if (event.touches.length !== 1 || isZoomedIn() || document.fullscreenElement) return
      if ((scrollerRef?.current?.scrollTop ?? 0) >= 1) return
      const touch = event.touches[0]
      press = { id: touch.identifier, startX: touch.clientX, startY: touch.clientY, originY: null, offset: 0, samples: [] }
      watch(event.target)
    }

    function onTouchMove(event: TouchEvent) {
      if (!press) return
      const touch = findTouch(event.touches, press.id)
      if (!touch) return
      if (press.originY === null) {
        const dx = touch.clientX - press.startX
        const dy = touch.clientY - press.startY
        if (Math.hypot(dx, dy) < SLOP_PX) return
        // Sideways (the photos), upward (the content) or adjusting a text selection: not a swipe down.
        if (dy <= Math.abs(dx) || hasSelectionIn(stage)) {
          release()
          return
        }
        press.originY = touch.clientY
        stage.dataset.swipe = 'drag'
        capturePointer()
      }
      // No scrolling, bouncing or pull-to-refresh while the stage follows the finger.
      if (event.cancelable) event.preventDefault()
      press.offset = Math.max(0, touch.clientY - press.originY)
      press.samples.push([event.timeStamp, touch.clientY])
      if (press.samples.length > 8) press.samples.shift()
      follow(press.offset)
    }

    function onTouchEnd(event: TouchEvent) {
      if (!press || !findTouch(event.changedTouches, press.id)) return
      const { originY, offset, samples } = press
      release()
      if (originY === null) return
      const closes = event.type === 'touchend' && swipeCloses(offset, releaseVelocity(samples, event.timeStamp), height())
      if (closes) close()
      else settle()
    }

    syncZoom()
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', syncZoom)
    stage.addEventListener('pointerdown', onPointerDown, { capture: true })
    stage.addEventListener('touchstart', onTouchStart, { passive: true })
    stage.addEventListener('touchmove', onTouchMove, { passive: false })
    stage.addEventListener('touchend', onTouchEnd)
    stage.addEventListener('touchcancel', onTouchEnd)
    return () => {
      window.clearTimeout(closeTimer)
      release()
      viewport?.removeEventListener('resize', syncZoom)
      stage.removeEventListener('pointerdown', onPointerDown, { capture: true })
      stage.removeEventListener('touchstart', onTouchStart)
      stage.removeEventListener('touchmove', onTouchMove)
      stage.removeEventListener('touchend', onTouchEnd)
      stage.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [ref, scrollerRef, enabled, exit])
}