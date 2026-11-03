import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import type { Orientation } from './types'
import { createZoomAccumulator, normalizeWheelDelta, pinchStep, type ZoomDirection } from './zoom'

export interface GestureHandlers {
  /** One zoom level step; `pointer` = physical main-axis offset of the pointer inside the viewport (`null` = centre). */
  onZoom: (direction: ZoomDirection, pointer: number | null) => void
}

export interface Scroller {
  /** Scrolls the main axis to the physical offset `target` (eased unless `smooth` is false). */
  scrollTo: (target: number, smooth?: boolean) => void
  /** Cancels eased scrolling and drag momentum. */
  stop: () => void
}

const DRAG_THRESHOLD = 5
const WHEEL_EASE = 0.2
const MOMENTUM_FRICTION = 0.94
const VELOCITY_WINDOW = 90

/** Largest scroll offset of the main axis. */
export function maxScrollOf(element: HTMLElement, orientation: Orientation): number {
  return orientation === 'horizontal'
    ? Math.max(0, element.scrollWidth - element.clientWidth)
    : Math.max(0, element.scrollHeight - element.clientHeight)
}

/**
 * Scroll offset of the main axis: physical (from the left / top), or logical (from the newest end)
 * when the frame is `reversed` (newest at the right / bottom).
 */
export function readScroll(element: HTMLElement, orientation: Orientation, reversed = false): number {
  const physical = orientation === 'horizontal' ? element.scrollLeft : element.scrollTop
  return reversed ? maxScrollOf(element, orientation) - physical : physical
}

/** Writes a scroll offset read like {@link readScroll}. */
export function writeScroll(element: HTMLElement, orientation: Orientation, value: number, reversed = false): void {
  const physical = reversed ? maxScrollOf(element, orientation) - value : value
  if (orientation === 'horizontal') element.scrollLeft = physical
  else element.scrollTop = physical
}

/**
 * Pointer & wheel behaviour of the timeline viewport:
 * - Ctrl/⌘ + wheel and trackpad pinch (wheel + ctrlKey) → accumulated zoom steps;
 * - vertical mouse wheel → eased horizontal scroll (desktop); trackpads keep native scrolling;
 * - mouse drag → pan with momentum (the click after a drag is swallowed);
 * - two-finger touch pinch → zoom steps.
 */
export function useTimelineGestures(
  containerRef: RefObject<HTMLElement | null>,
  orientation: Orientation,
  handlers: GestureHandlers,
): Scroller {
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => {
    handlersRef.current = handlers
  })
  const controlsRef = useRef<Scroller>({ scrollTo: () => {}, stop: () => {} })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Typed non-null binding: the hoisted handlers below cannot see the narrowing above.
    const element: HTMLElement = container
    const horizontal = orientation === 'horizontal'
    const read = () => readScroll(element, orientation)
    const write = (value: number) => writeScroll(element, orientation, value)
    const clamp = (value: number) => Math.min(maxScrollOf(element, orientation), Math.max(0, value))
    const pointerOffset = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect()
      return horizontal ? clientX - rect.left : clientY - rect.top
    }

    // ── Eased scrolling & momentum (one rAF loop at a time) ──────────────────────────
    let frame = 0
    let target = read()
    let velocity = 0
    let mode: 'ease' | 'momentum' | null = null
    let lastTick = 0

    function stop() {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      mode = null
    }

    function tick(now: number) {
      frame = 0
      if (mode === 'ease') {
        const current = read()
        const next = current + (target - current) * WHEEL_EASE
        if (Math.abs(target - next) < 0.75) {
          write(target)
          mode = null
          return
        }
        write(next)
      } else if (mode === 'momentum') {
        const elapsed = Math.min(48, now - lastTick || 16)
        lastTick = now
        const before = read()
        write(clamp(before + velocity * elapsed))
        velocity *= MOMENTUM_FRICTION ** (elapsed / 16)
        if (Math.abs(velocity) < 0.02 || read() === before) {
          mode = null
          return
        }
      } else {
        return
      }
      frame = requestAnimationFrame(tick)
    }

    function easeTo(value: number) {
      if (mode !== 'ease') target = read()
      target = clamp(value)
      mode = 'ease'
      if (!frame) frame = requestAnimationFrame(tick)
    }

    controlsRef.current = {
      scrollTo(value, smooth = true) {
        if (smooth) easeTo(value)
        else {
          stop()
          write(clamp(value))
        }
      },
      stop,
    }

    // ── Wheel ───────────────────────────────────────────────────────────────────────
    const accumulator = createZoomAccumulator()
    function onWheel(event: WheelEvent) {
      const page = horizontal ? element.clientWidth : element.clientHeight
      if (event.ctrlKey || event.metaKey) {
        // Browser zoom stays untouched: Ctrl/⌘ + wheel and pinch zoom the timeline instead.
        event.preventDefault()
        stop()
        const direction = accumulator.push(normalizeWheelDelta(event.deltaY, event.deltaMode, page), event.timeStamp)
        if (direction) handlersRef.current.onZoom(direction, pointerOffset(event.clientX, event.clientY))
        return
      }
      if (!horizontal) {
        if (mode) stop()
        return
      }
      const dx = normalizeWheelDelta(event.deltaX, event.deltaMode, page)
      const dy = normalizeWheelDelta(event.deltaY, event.deltaMode, page)
      if (Math.abs(dy) <= Math.abs(dx)) {
        if (mode) stop()
        return
      }
      event.preventDefault()
      // Mouse wheels send coarse notches (eased); trackpads send fine deltas (applied directly).
      if (event.deltaMode !== 0 || Math.abs(dy) >= 40) easeTo((mode === 'ease' ? target : read()) + dy)
      else {
        stop()
        write(clamp(read() + dy))
      }
    }

    // ── Mouse drag to pan ───────────────────────────────────────────────────────────
    let drag: { id: number; start: number; startScroll: number; moved: boolean; samples: Array<[number, number]> } | null = null
    let swallowClick = false

    function onPointerDown(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      stop()
      const position = horizontal ? event.clientX : event.clientY
      drag = { id: event.pointerId, start: position, startScroll: read(), moved: false, samples: [[event.timeStamp, position]] }
    }

    function onPointerMove(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.id) return
      const position = horizontal ? event.clientX : event.clientY
      const delta = position - drag.start
      if (!drag.moved) {
        if (Math.abs(delta) < DRAG_THRESHOLD) return
        drag.moved = true
        element.setPointerCapture?.(event.pointerId)
        element.dataset.dragging = 'true'
      }
      write(clamp(drag.startScroll - delta))
      drag.samples.push([event.timeStamp, position])
      if (drag.samples.length > 8) drag.samples.shift()
    }

    function endDrag(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.id) return
      const finished = drag
      drag = null
      if (!finished.moved) return
      delete element.dataset.dragging
      if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId)
      swallowClick = true
      window.setTimeout(() => {
        swallowClick = false
      }, 0)
      if (event.type === 'pointercancel') return
      const recent = finished.samples.filter(([time]) => event.timeStamp - time <= VELOCITY_WINDOW)
      if (recent.length >= 2) {
        const [firstTime, firstPosition] = recent[0]
        const [lastTime, lastPosition] = recent.at(-1) ?? recent[0]
        const elapsed = lastTime - firstTime
        if (elapsed > 0) {
          velocity = -(lastPosition - firstPosition) / elapsed
          if (Math.abs(velocity) > 0.15) {
            mode = 'momentum'
            lastTick = performance.now()
            if (!frame) frame = requestAnimationFrame(tick)
          }
        }
      }
    }

    function onClickCapture(event: MouseEvent) {
      if (!swallowClick) return
      swallowClick = false
      event.preventDefault()
      event.stopPropagation()
    }

    function onDragStart(event: DragEvent) {
      event.preventDefault()
    }

    // ── Two-finger pinch ────────────────────────────────────────────────────────────
    let pinch: { distance: number } | null = null
    const touchDistance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length === 2) {
        stop()
        pinch = { distance: touchDistance(event.touches) }
      }
    }

    function onTouchMove(event: TouchEvent) {
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      const distance = touchDistance(event.touches)
      const direction = pinchStep(pinch.distance, distance)
      if (!direction) return
      pinch.distance = distance
      const [a, b] = [event.touches[0], event.touches[1]]
      handlersRef.current.onZoom(direction, pointerOffset((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2))
    }

    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) pinch = null
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', endDrag)
    element.addEventListener('pointercancel', endDrag)
    element.addEventListener('click', onClickCapture, true)
    element.addEventListener('dragstart', onDragStart)
    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd)
    element.addEventListener('touchcancel', onTouchEnd)
    return () => {
      stop()
      delete element.dataset.dragging
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', endDrag)
      element.removeEventListener('pointercancel', endDrag)
      element.removeEventListener('click', onClickCapture, true)
      element.removeEventListener('dragstart', onDragStart)
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [containerRef, orientation])

  return useMemo<Scroller>(
    () => ({
      scrollTo: (value, smooth) => controlsRef.current.scrollTo(value, smooth),
      stop: () => controlsRef.current.stop(),
    }),
    [],
  )
}
