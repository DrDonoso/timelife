import { describe, expect, it } from 'vitest'
import { CENTRED_CROP, clampCrop, cropBox, framedImageStyle, normalizeCrop, panCrop, sameCrop, zoomCrop } from './crop'

const LANDSCAPE = { width: 1600, height: 1200 }
const PORTRAIT = { width: 600, height: 1200 }

describe('crop math (mirrors src/timelife/crops.py)', () => {
  it('treats the centred square as no framing', () => {
    expect(normalizeCrop(CENTRED_CROP, LANDSCAPE)).toBeNull()
    expect(normalizeCrop({ x: 0.50001, y: 0.49999, zoom: 1.00001 }, LANDSCAPE)).toBeNull()
    expect(normalizeCrop({ x: 0.1, y: 0.9, zoom: 1 }, { width: 800, height: 800 })).toBeNull()
    expect(normalizeCrop(null, LANDSCAPE)).toBeNull()
  })

  it('keeps the square inside the picture and rounds like the server', () => {
    expect(normalizeCrop({ x: 0, y: 0, zoom: 1 }, LANDSCAPE)).toEqual({ x: 0.375, y: 0.5, zoom: 1 })
    expect(normalizeCrop({ x: 0, y: 1, zoom: 2 }, PORTRAIT)).toEqual({ x: 0.25, y: 0.875, zoom: 2 })
    expect(normalizeCrop({ x: 0.3, y: 0.4, zoom: 9 }, { width: 1000, height: 1000 })).toEqual({ x: 0.3, y: 0.4, zoom: 4 })
    expect(normalizeCrop({ x: 0.345678, y: 0.5, zoom: 2 }, { width: 1000, height: 1000 })).toEqual({ x: 0.3457, y: 0.5, zoom: 2 })
    expect(clampCrop({ x: Number.NaN, y: 0.5, zoom: Number.NaN }, LANDSCAPE)).toEqual(CENTRED_CROP)
  })

  it('compares framings once normalized', () => {
    expect(sameCrop(null, CENTRED_CROP, LANDSCAPE)).toBe(true)
    expect(sameCrop({ x: 0, y: 0, zoom: 1 }, { x: 0.375, y: 0.5, zoom: 1 }, LANDSCAPE)).toBe(true)
    expect(sameCrop({ x: 0.4, y: 0.5, zoom: 1 }, null, LANDSCAPE)).toBe(false)
  })

  it('computes the box and an image style showing exactly that box', () => {
    expect(cropBox({ x: 0.5, y: 0.5, zoom: 1 }, LANDSCAPE)).toEqual({ left: 200, top: 0, side: 1200 })
    expect(cropBox({ x: 0.25, y: 0.75, zoom: 2 }, { width: 1000, height: 1000 })).toEqual({ left: 0, top: 500, side: 500 })
    expect(framedImageStyle({ x: 0.25, y: 0.75, zoom: 2 }, { width: 1000, height: 1000 })).toMatchObject({
      width: '200%',
      height: '200%',
      left: '0%',
      top: '-100%',
    })
    // No framing: the centred square.
    const style = framedImageStyle(null, LANDSCAPE)
    expect(parseFloat(String(style.left))).toBeCloseTo(-16.667, 2)
    expect(style.top).toBe('0%')
  })

  it('pans by dragging, inside the picture', () => {
    // Zoom 2 on 1000 × 1000 in a 250 px viewport: 500 image px on screen, 2 image px per screen px.
    const crop = { x: 0.5, y: 0.5, zoom: 2 }
    expect(panCrop(crop, 50, -25, 250, { width: 1000, height: 1000 })).toEqual({ x: 0.4, y: 0.55, zoom: 2 })
    expect(panCrop(crop, 1000, 0, 250, { width: 1000, height: 1000 })).toEqual({ x: 0.25, y: 0.5, zoom: 2 })
  })

  it('zooms around a point that stays in place', () => {
    const size = { width: 1000, height: 1000 }
    expect(zoomCrop(CENTRED_CROP, 2, size)).toEqual({ x: 0.5, y: 0.5, zoom: 2 })
    // Zooming on the top-left corner keeps it there.
    expect(zoomCrop(CENTRED_CROP, 2, size, { x: 0, y: 0 })).toEqual({ x: 0.25, y: 0.25, zoom: 2 })
    expect(zoomCrop({ x: 0.25, y: 0.25, zoom: 2 }, 1, size)).toEqual(CENTRED_CROP)
    expect(zoomCrop(CENTRED_CROP, 10, size).zoom).toBe(4)
  })
})
