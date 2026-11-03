import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageOut } from '../api/schema.gen'
import {
  dotWindow,
  orderImages,
  ownsArrowKeys,
  parseEventId,
  previousEntryIs,
  readOriginRect,
  readPhotoIndex,
  withPhotoIndex,
} from './detailUtils'

function image(id: string): ImageOut {
  return {
    id,
    name: id,
    kind: 'image',
    width: 100,
    height: 100,
    dominant_color: '#808080',
    crop: null,
    thumb_url: `/api/media/${id}/thumb`,
    display_url: `/api/media/${id}/display`,
    video_status: null,
    video_url: null,
    duration: null,
    live: false,
  }
}

describe('parseEventId', () => {
  it('accepts positive integer ids within the API range', () => {
    expect(parseEventId('5')).toBe(5)
    expect(parseEventId('2147483647')).toBe(2147483647)
  })

  it('rejects anything else', () => {
    for (const value of [undefined, '', '0', '-3', '1.5', 'abc', '5abc', '2147483648', '99999999999', ' 5']) {
      expect(parseEventId(value)).toBeNull()
    }
  })
})

describe('orderImages', () => {
  const images = [image('a'), image('b'), image('c'), image('d')]

  it('puts the cover first and keeps the saved order for the rest', () => {
    expect(orderImages(images, 'c').map((item) => item.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('keeps the saved order without a (known) cover', () => {
    expect(orderImages(images, null).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(orderImages(images, 'missing').map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(orderImages([], 'a')).toEqual([])
  })

  it('does not mutate the input', () => {
    orderImages(images, 'd')
    expect(images.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('readOriginRect', () => {
  it('reads the rect set by the timeline', () => {
    expect(readOriginRect({ originRect: { x: 10, y: 20, width: 104, height: 104 } })).toEqual({
      x: 10,
      y: 20,
      width: 104,
      height: 104,
    })
  })

  it('ignores missing or malformed state', () => {
    for (const state of [null, undefined, 'x', {}, { originRect: null }, { originRect: { x: 1, y: 2 } }]) {
      expect(readOriginRect(state)).toBeNull()
    }
    expect(readOriginRect({ originRect: { x: Number.NaN, y: 0, width: 10, height: 10 } })).toBeNull()
    expect(readOriginRect({ originRect: { x: 0, y: 0, width: 0, height: 10 } })).toBeNull()
  })
})

describe('readPhotoIndex / withPhotoIndex', () => {
  it('reads the full-screen photo of the router state, within the album', () => {
    expect(readPhotoIndex({ photo: 2 }, 3)).toBe(2)
    expect(readPhotoIndex({ photo: 0, originRect: {} }, 1)).toBe(0)
    for (const state of [null, undefined, 'x', {}, { photo: 3 }, { photo: -1 }, { photo: 1.5 }, { photo: '1' }]) {
      expect(readPhotoIndex(state, 3)).toBeNull()
    }
  })

  it('adds the photo to the current state, keeping the rest', () => {
    const originRect = { x: 1, y: 2, width: 3, height: 4 }
    expect(withPhotoIndex({ originRect }, 1)).toEqual({ originRect, photo: 1 })
    expect(withPhotoIndex(null, 0)).toEqual({ photo: 0 })
    expect(withPhotoIndex({ photo: 4 }, 2)).toEqual({ photo: 2 })
  })
})

describe('dotWindow', () => {
  it('shows every dot when they fit', () => {
    expect(dotWindow(5, 3)).toEqual({ start: 0, end: 5 })
  })

  it('slides a window of 7 dots around the current photo', () => {
    expect(dotWindow(12, 0)).toEqual({ start: 0, end: 7 })
    expect(dotWindow(12, 6)).toEqual({ start: 3, end: 10 })
    expect(dotWindow(12, 11)).toEqual({ start: 5, end: 12 })
  })
})

describe('ownsArrowKeys', () => {
  it('leaves arrows to text fields, sliders and composite widgets', () => {
    const input = document.createElement('input')
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' })
    const textarea = document.createElement('textarea')
    const option = document.createElement('div')
    const listbox = document.createElement('div')
    listbox.setAttribute('role', 'listbox')
    listbox.append(option)
    const button = document.createElement('button')
    expect(ownsArrowKeys(input)).toBe(true)
    expect(ownsArrowKeys(textarea)).toBe(true)
    // A focused video player seeks with the arrows.
    expect(ownsArrowKeys(document.createElement('video'))).toBe(true)
    expect(ownsArrowKeys(option)).toBe(true)
    expect(ownsArrowKeys(checkbox)).toBe(false)
    expect(ownsArrowKeys(button)).toBe(false)
    expect(ownsArrowKeys(document.body)).toBe(false)
    expect(ownsArrowKeys(null)).toBe(false)
  })
})

describe('previousEntryIs', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  function stubNavigation(urls: string[], index: number) {
    vi.stubGlobal('navigation', {
      currentEntry: { index },
      entries: () => urls.map((url) => ({ url: new URL(url, window.location.origin).href })),
    })
  }

  it('is true when the previous history entry is the timeline the card returns to', () => {
    window.history.replaceState(null, '', '/c/ana/e/5?zoom=events')
    stubNavigation(['/c/ana?zoom=events', '/c/ana/e/5?zoom=events'], 1)
    expect(previousEntryIs('/c/ana?zoom=events', '/c/ana/e/5?zoom=events')).toBe(true)
  })

  it('is false for other previous entries, deep links and memory routers', () => {
    window.history.replaceState(null, '', '/c/ana/e/5?zoom=events')
    stubNavigation(['/c/ana?q=pasos', '/c/ana/e/5?zoom=events'], 1)
    expect(previousEntryIs('/c/ana?zoom=events', '/c/ana/e/5?zoom=events')).toBe(false)
    stubNavigation(['/c/ana/e/5?zoom=events'], 0)
    expect(previousEntryIs('/c/ana?zoom=events', '/c/ana/e/5?zoom=events')).toBe(false)
    // The router's location is not the browser's (memory router in tests).
    stubNavigation(['/c/ana?zoom=events', '/c/ana/e/5?zoom=events'], 1)
    expect(previousEntryIs('/c/ana?zoom=events', '/c/leo/e/5')).toBe(false)
  })

  it('is false without the Navigation API', () => {
    window.history.replaceState(null, '', '/c/ana/e/5')
    vi.stubGlobal('navigation', undefined)
    expect(previousEntryIs('/c/ana', '/c/ana/e/5')).toBe(false)
  })
})
