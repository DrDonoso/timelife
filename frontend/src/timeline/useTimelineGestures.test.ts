import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useTimelineGestures } from './useTimelineGestures'

/** Phone viewport (vertical line) whose scroll offset the browser rounds to whole pixels. */
function viewport(): HTMLElement {
  const element = document.createElement('div')
  let top = 0
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 800 },
    scrollHeight: { configurable: true, value: 20_000 },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.round(value)
      },
    },
  })
  return element
}

/** Animation frames, run by the test. */
function frames() {
  const callbacks = new Map<number, FrameRequestCallback>()
  let last = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    last += 1
    callbacks.set(last, callback)
    return last
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  return {
    get pending() {
      return callbacks.size
    },
    run(count: number) {
      for (let index = 0; index < count && callbacks.size > 0; index += 1) {
        const due = [...callbacks.values()]
        callbacks.clear()
        for (const callback of due) callback(index * 16)
      }
    },
  }
}

function scroller(element: HTMLElement) {
  return renderHook(() => useTimelineGestures({ current: element }, 'vertical', { onZoom: () => {} })).result.current
}

it('lands an eased scroll whose last steps the browser rounds back to the same offset', () => {
  const clock = frames()
  const element = viewport()
  // The centre of a milestone can fall on half a pixel: from 715, a fifth of the way rounds back to 715.
  scroller(element).scrollTo(716.5)
  clock.run(200)
  expect(clock.pending).toBe(0)
  expect(element.scrollTop).toBe(717)
})

it('hands the line over to a finger that touches it during an eased scroll', () => {
  const clock = frames()
  const element = viewport()
  scroller(element).scrollTo(5000)
  clock.run(3)
  const touch = new Event('touchstart')
  Object.defineProperty(touch, 'touches', { value: [{ clientX: 200, clientY: 400 }] })
  element.dispatchEvent(touch)
  // The finger drags the line back up: nothing pulls it on towards the milestone any more.
  element.scrollTop = 300
  clock.run(10)
  expect(element.scrollTop).toBe(300)
  expect(clock.pending).toBe(0)
})
