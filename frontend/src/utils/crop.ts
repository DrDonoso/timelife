import type { CSSProperties } from 'react'
import type { ImageCrop } from '../api/schema.gen'

/**
 * Thumbnail framing math, mirroring src/timelife/crops.py: a framing is the centre of the square
 * a thumbnail shows (fractions of the picture's width and height) and a zoom (1 = the square's
 * side is the picture's short edge).
 */

export type { ImageCrop }

/** Largest zoom (`MAX_ZOOM` in crops.py). */
export const MAX_CROP_ZOOM = 4

/** The centred square: what a thumbnail shows without a framing. */
export const CENTRED_CROP: ImageCrop = { x: 0.5, y: 0.5, zoom: 1 }

export interface PictureSize {
  width: number
  height: number
}

const DECIMALS = 4
const EPSILON = 10 ** -DECIMALS

function round(value: number): number {
  return Math.round(value * 10 ** DECIMALS) / 10 ** DECIMALS
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/** `crop` with its zoom in range and its square kept inside the picture (not rounded). */
export function clampCrop(crop: ImageCrop, { width, height }: PictureSize): ImageCrop {
  const zoom = Math.min(MAX_CROP_ZOOM, Math.max(1, finite(crop.zoom, 1)))
  const side = Math.min(width, height) / zoom
  const halfX = side / 2 / width
  const halfY = side / 2 / height
  return {
    x: Math.min(1 - halfX, Math.max(halfX, finite(crop.x, 0.5))),
    y: Math.min(1 - halfY, Math.max(halfY, finite(crop.y, 0.5))),
    zoom,
  }
}

/** The framing the server stores (`normalize` in crops.py): clamped, rounded, null when centred. */
export function normalizeCrop(crop: ImageCrop | null | undefined, size: PictureSize): ImageCrop | null {
  if (!crop) return null
  const clamped = clampCrop(crop, size)
  const result = { x: round(clamped.x), y: round(clamped.y), zoom: round(clamped.zoom) }
  const centred = Math.abs(result.x - 0.5) < EPSILON && Math.abs(result.y - 0.5) < EPSILON && Math.abs(result.zoom - 1) < EPSILON
  return centred ? null : result
}

/** Same framing (both null, or the same values once normalized). */
export function sameCrop(a: ImageCrop | null | undefined, b: ImageCrop | null | undefined, size: PictureSize): boolean {
  const left = normalizeCrop(a, size)
  const right = normalizeCrop(b, size)
  if (!left || !right) return left === right
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom
}

/** Pixel square (`left`, `top`, `side`) a framing shows of a picture. */
export function cropBox(crop: ImageCrop, { width, height }: PictureSize): { left: number; top: number; side: number } {
  const side = Math.min(width, height) / crop.zoom
  return {
    left: Math.min(Math.max(crop.x * width - side / 2, 0), width - side),
    top: Math.min(Math.max(crop.y * height - side / 2, 0), height - side),
    side,
  }
}

/**
 * Style of an `<img>` of the whole picture inside a square, `overflow: hidden`, positioned box so
 * that the box shows exactly the framing (percentages: any box size works).
 */
export function framedImageStyle(crop: ImageCrop | null | undefined, size: PictureSize): CSSProperties {
  const { left, top, side } = cropBox(clampCrop(crop ?? CENTRED_CROP, size), size)
  return {
    position: 'absolute',
    width: `${(size.width / side) * 100}%`,
    height: `${(size.height / side) * 100}%`,
    left: `${(-left / side) * 100}%`,
    top: `${(-top / side) * 100}%`,
    right: 'auto',
    bottom: 'auto',
    maxWidth: 'none',
    objectFit: 'fill',
  }
}

/** Framing after dragging the picture by `dx`, `dy` px inside a `viewport` px square. */
export function panCrop(crop: ImageCrop, dx: number, dy: number, viewport: number, size: PictureSize): ImageCrop {
  const scale = Math.min(size.width, size.height) / crop.zoom / viewport
  return clampCrop({ ...crop, x: crop.x - (dx * scale) / size.width, y: crop.y - (dy * scale) / size.height }, size)
}

/**
 * Framing at `zoom`, keeping the picture point under `anchor` (fractions of the square; default
 * its centre) where it is.
 */
export function zoomCrop(crop: ImageCrop, zoom: number, size: PictureSize, anchor = { x: 0.5, y: 0.5 }): ImageCrop {
  const box = cropBox(clampCrop(crop, size), size)
  const pointX = box.left + anchor.x * box.side
  const pointY = box.top + anchor.y * box.side
  const next = Math.min(MAX_CROP_ZOOM, Math.max(1, zoom))
  const side = Math.min(size.width, size.height) / next
  return clampCrop(
    { x: (pointX - anchor.x * side + side / 2) / size.width, y: (pointY - anchor.y * side + side / 2) / size.height, zoom: next },
    size,
  )
}
