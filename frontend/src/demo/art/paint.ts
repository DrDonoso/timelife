/**
 * SVG drawing primitives of the demo pictures: colours (Python colorsys ports, as in
 * src/timelife/demo.py), a {@link Painting} that collects definitions and shapes in painting order,
 * and Pillow-like shapes (ellipses and rectangles from bounding boxes, pie slices, polylines).
 */
import { Random } from '../random'

export type Rgb = readonly [number, number, number]
export type Point = readonly [number, number]

export const WHITE: Rgb = [255, 255, 255]
export const INK: Rgb = [62, 44, 40]

// Colours --------------------------------------------------------------------------------------

export function rgb(hex: string): Rgb {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)]
}

export function hex(color: Rgb): string {
  return `#${color.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`
}

function fraction(value: number): number {
  return ((value % 1) + 1) % 1
}

function toHls([red, green, blue]: readonly [number, number, number]): [number, number, number] {
  const high = Math.max(red, green, blue)
  const low = Math.min(red, green, blue)
  const lightness = (high + low) / 2
  if (high === low) return [0, lightness, 0]
  const range = high - low
  const saturation = lightness <= 0.5 ? range / (high + low) : range / (2 - high - low)
  const r = (high - red) / range
  const g = (high - green) / range
  const b = (high - blue) / range
  const hue = red === high ? b - g : green === high ? 2 + r - b : 4 + g - r
  return [fraction(hue / 6), lightness, saturation]
}

function channel(m1: number, m2: number, hue: number): number {
  const h = fraction(hue)
  if (h < 1 / 6) return m1 + (m2 - m1) * h * 6
  if (h < 0.5) return m2
  if (h < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - h) * 6
  return m1
}

function fromHls(hue: number, lightness: number, saturation: number): [number, number, number] {
  if (saturation === 0) return [lightness, lightness, lightness]
  const m2 = lightness <= 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const m1 = 2 * lightness - m2
  return [channel(m1, m2, hue + 1 / 3), channel(m1, m2, hue), channel(m1, m2, hue - 1 / 3)]
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** `value` (#rrggbb or RGB) with its hue rotated and its lightness/saturation shifted. */
export function tone(value: string | Rgb, hue = 0, light = 0, saturation = 0): Rgb {
  const color = typeof value === 'string' ? rgb(value) : value
  const [h, l, s] = toHls(color.map((part) => part / 255) as [number, number, number])
  return fromHls(fraction(h + hue), clamp01(l + light), clamp01(s + saturation)).map((part) => Math.round(part * 255)) as [
    number,
    number,
    number,
  ]
}

export function lighter(color: Rgb, amount: number): Rgb {
  return color.map((part) => Math.min(255, part + amount)) as [number, number, number]
}

export function darker(color: Rgb, amount: number): Rgb {
  return color.map((part) => Math.max(0, part - amount)) as [number, number, number]
}

/** Weighted average of colours. */
export function mix(parts: ReadonlyArray<readonly [Rgb, number]>): Rgb {
  const total = parts.reduce((sum, [, weight]) => sum + weight, 0)
  return [0, 1, 2].map((index) => parts.reduce((sum, [color, weight]) => sum + color[index] * weight, 0) / total) as [
    number,
    number,
    number,
  ]
}

// Markup ---------------------------------------------------------------------------------------

export const n = (value: number) => String(Math.round(value * 10) / 10)

export function paint(color: Rgb | string, opacity = 1): string {
  const fill = typeof color === 'string' ? color : hex(color)
  return opacity >= 1 ? `fill="${fill}"` : `fill="${fill}" fill-opacity="${Math.round(opacity * 100) / 100}"`
}

export function points(list: readonly Point[]): string {
  return list.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')
}

/** Point of the ellipse inscribed in a box at `degrees` (clockwise from 3 o'clock, y down). */
export function onEllipse(cx: number, cy: number, rx: number, ry: number, degrees: number): Point {
  const angle = (degrees * Math.PI) / 180
  return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** One SVG picture: definitions (gradients, filters, masks) and the shapes, in painting order. */
export class Painting {
  private readonly defs: string[] = []
  private readonly layers: string[][] = [[]]
  private count = 0
  readonly width: number
  readonly height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  get unit(): number {
    return Math.min(this.width, this.height)
  }

  id(prefix: string): string {
    this.count += 1
    return `${prefix}${this.count}`
  }

  define(markup: string): void {
    this.defs.push(markup)
  }

  add(markup: string): void {
    this.layers[this.layers.length - 1].push(markup)
  }

  /** Shapes drawn by `draw`, wrapped in `<g {attributes}>` (transforms, filters, opacity). */
  group(attributes: string, draw: () => void): void {
    this.layers.push([])
    try {
      draw()
    } finally {
      const shapes = this.layers.pop() as string[]
      this.add(`<g ${attributes}>${shapes.join('')}</g>`)
    }
  }

  /** Shapes mirrored around the vertical line x = `axis` (figures facing the other way). */
  mirrored(axis: number, mirror: boolean, draw: () => void): void {
    if (!mirror) draw()
    else this.group(`transform="translate(${n(2 * axis)} 0) scale(-1 1)"`, draw)
  }

  /** Vertical gradient spanning the whole picture (the area it fills only shows part of it). */
  vertical(top: Rgb, bottom: Rgb): string {
    return this.gradient(top, bottom, 0, this.height)
  }

  /** Vertical gradient from `top` at y = `from` to `bottom` at y = `to`. */
  gradient(top: Rgb, bottom: Rgb, from: number, to: number): string {
    const id = this.id('v')
    this.define(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(from)}" x2="0" y2="${n(to)}">` +
        `<stop offset="0" stop-color="${hex(top)}"/><stop offset="1" stop-color="${hex(bottom)}"/></linearGradient>`,
    )
    return `url(#${id})`
  }

  background(top: Rgb, bottom: Rgb): void {
    this.add(`<rect width="${this.width}" height="${this.height}" fill="${this.vertical(top, bottom)}"/>`)
  }

  /** Soft round light: `strength` (0..1) at the centre, fading out by `radius`. */
  glow([x, y]: Point, radius: number, color: Rgb, strength: number): void {
    const id = this.id('g')
    const stops = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]
      .map((offset) => `<stop offset="${offset}" stop-color="${hex(color)}" stop-opacity="${Math.round((1 - offset) ** 1.6 * strength * 1000) / 1000}"/>`)
      .join('')
    this.define(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(x)}" cy="${n(y)}" r="${n(radius)}">${stops}</radialGradient>`)
    this.add(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="url(#${id})"/>`)
  }

  /** Shapes drawn on a blurred layer (bokeh, light, shadows). */
  blurred(blur: number, draw: () => void): void {
    const id = this.id('b')
    this.define(`<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${n(blur)}"/></filter>`)
    this.group(`filter="url(#${id})"`, draw)
  }

  /** Area under `curve` down to the bottom edge, filled with a vertical gradient. */
  fillBelow(curve: readonly Point[], top: Rgb, bottom: Rgb): void {
    const outline: Point[] = [[0, this.height], ...curve, [this.width, this.height]]
    this.add(`<polygon points="${points(outline)}" fill="${this.vertical(top, bottom)}"/>`)
  }

  /** Crescent: the disc of `radius` at `center` minus the same disc moved by `offset`. */
  crescent([x, y]: Point, radius: number, [dx, dy]: Point, color: Rgb): void {
    const id = this.id('m')
    this.define(
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${this.width}" height="${this.height}">` +
        `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="#fff"/>` +
        `<circle cx="${n(x + dx)}" cy="${n(y + dy)}" r="${n(radius)}" fill="#000"/></mask>`,
    )
    this.add(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" ${paint(color)} mask="url(#${id})"/>`)
  }

  /** Photographic finish: a colour grade of its own (photos of one scene still differ) and a vignette. */
  finish(grade: Rgb | null, strength: number): void {
    if (grade) {
      this.add(`<rect width="${this.width}" height="${this.height}" ${paint(grade, strength)} style="mix-blend-mode:soft-light"/>`)
    }
    const id = this.id('n')
    this.define(
      `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.7071">` +
        '<stop offset="0.47" stop-color="#281e23" stop-opacity="0"/><stop offset="1" stop-color="#281e23" stop-opacity="0.37"/></radialGradient>',
    )
    this.add(`<rect width="${this.width}" height="${this.height}" fill="url(#${id})"/>`)
  }

  /**
   * The SVG document: the whole picture, or a square of it (`square`, default the centred one)
   * at `thumb` × `thumb` pixels.
   */
  render(thumb: number | null, square: { left: number; top: number; side: number } | null = null): string {
    let box = `0 0 ${this.width} ${this.height}`
    let size = `width="${this.width}" height="${this.height}"`
    if (thumb !== null) {
      const { left, top, side } = square ?? { left: (this.width - this.unit) / 2, top: (this.height - this.unit) / 2, side: this.unit }
      box = `${n(left)} ${n(top)} ${n(side)} ${n(side)}`
      size = `width="${thumb}" height="${thumb}"`
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="${box}">` +
      `<defs>${this.defs.join('')}</defs>${this.layers[0].join('')}</svg>`
    )
  }
}

// Shapes ---------------------------------------------------------------------------------------

export function circle([x, y]: Point, radius: number, color: Rgb, opacity = 1): string {
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" ${paint(color, opacity)}/>`
}

/** Ellipse inscribed in the box (left, top, right, bottom), as Pillow draws it. */
export function ellipse(left: number, top: number, right: number, bottom: number, color: Rgb, opacity = 1): string {
  return `<ellipse cx="${n((left + right) / 2)}" cy="${n((top + bottom) / 2)}" rx="${n(Math.abs(right - left) / 2)}" ry="${n(Math.abs(bottom - top) / 2)}" ${paint(color, opacity)}/>`
}

/** Ellipse from its centre and radii, optionally rotated by `angle` degrees. */
export function oval([x, y]: Point, rx: number, ry: number, color: Rgb, opacity = 1, angle = 0): string {
  const rotation = angle ? ` transform="rotate(${n(angle)} ${n(x)} ${n(y)})"` : ''
  return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}"${rotation} ${paint(color, opacity)}/>`
}

export function rect(left: number, top: number, right: number, bottom: number, color: Rgb, opacity = 1, radius = 0): string {
  const corner = radius > 0 ? ` rx="${n(radius)}"` : ''
  return `<rect x="${n(Math.min(left, right))}" y="${n(Math.min(top, bottom))}" width="${n(Math.abs(right - left))}" height="${n(Math.abs(bottom - top))}"${corner} ${paint(color, opacity)}/>`
}

export function polygon(list: readonly Point[], color: Rgb, opacity = 1): string {
  return `<polygon points="${points(list)}" ${paint(color, opacity)}/>`
}

export function line(list: readonly Point[], color: Rgb, width: number, opacity = 1, cap: 'butt' | 'round' = 'butt'): string {
  const alpha = opacity >= 1 ? '' : ` stroke-opacity="${Math.round(opacity * 100) / 100}"`
  return `<polyline points="${points(list)}" fill="none" stroke="${hex(color)}"${alpha} stroke-width="${n(width)}" stroke-linecap="${cap}" stroke-linejoin="round"/>`
}

/** Filled path (`d` uses absolute commands). */
export function shape(d: string, color: Rgb, opacity = 1): string {
  return `<path d="${d}" ${paint(color, opacity)}/>`
}

/** Stroked path, round ends. */
export function stroke(d: string, color: Rgb, width: number, opacity = 1): string {
  const alpha = opacity >= 1 ? '' : ` stroke-opacity="${Math.round(opacity * 100) / 100}"`
  return `<path d="${d}" fill="none" stroke="${hex(color)}"${alpha} stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`
}

/** Outline-only circle. */
export function ring([x, y]: Point, radius: number, color: Rgb, width: number, opacity = 1): string {
  const alpha = opacity >= 1 ? '' : ` stroke-opacity="${Math.round(opacity * 100) / 100}"`
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="none" stroke="${hex(color)}"${alpha} stroke-width="${n(width)}"/>`
}

/** Pie slice of the ellipse inscribed in a box, from `start` to `end` degrees (clockwise). */
export function pieslice(left: number, top: number, right: number, bottom: number, start: number, end: number, color: Rgb): string {
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2
  const rx = (right - left) / 2
  const ry = (bottom - top) / 2
  const [x1, y1] = onEllipse(cx, cy, rx, ry, start)
  const [x2, y2] = onEllipse(cx, cy, rx, ry, end)
  const large = end - start > 180 ? 1 : 0
  return `<path d="M${n(cx)},${n(cy)} L${n(x1)},${n(y1)} A${n(rx)},${n(ry)} 0 ${large},1 ${n(x2)},${n(y2)} Z" ${paint(color)}/>`
}

/** Rounded trapezoid: `top` and `bottom` widths centred on `x` (shirts, dresses, cakes). */
export function trapezoid(x: number, top: number, bottom: number, topWidth: number, bottomWidth: number, radius: number, color: Rgb, opacity = 1): string {
  const [a, b] = [topWidth / 2, bottomWidth / 2]
  const r = Math.min(radius, (bottom - top) / 2, a, b)
  const d =
    `M${n(x - a)},${n(top + r)} Q${n(x - a)},${n(top)} ${n(x - a + r)},${n(top)} L${n(x + a - r)},${n(top)} ` +
    `Q${n(x + a)},${n(top)} ${n(x + a)},${n(top + r)} L${n(x + b)},${n(bottom - r)} Q${n(x + b)},${n(bottom)} ${n(x + b - r)},${n(bottom)} ` +
    `L${n(x - b + r)},${n(bottom)} Q${n(x - b)},${n(bottom)} ${n(x - b)},${n(bottom - r)} Z`
  return shape(d, color, opacity)
}

export function text([x, y]: Point, content: string, size: number, color: Rgb, { weight = 800, anchor = 'middle' }: { weight?: number; anchor?: 'start' | 'middle' | 'end' } = {}): string {
  return (
    `<text x="${n(x)}" y="${n(y)}" font-family="'Segoe UI', system-ui, -apple-system, Roboto, sans-serif" font-size="${n(size)}" ` +
    `font-weight="${weight}" text-anchor="${anchor}" ${paint(color)}>${escape(content)}</text>`
  )
}

/** Points of a smooth random curve across the picture around height `base`. */
export function wave(width: number, base: number, amplitude: number, random: Random, steps = 48): Point[] {
  const phases = [0, 1, 2].map(() => random.uniform(0, Math.PI * 2))
  const frequencies = [random.uniform(0.6, 1.4), random.uniform(1.8, 3.2), random.uniform(4, 6)]
  const weights = [1, 0.35, 0.12]
  return Array.from({ length: steps + 1 }, (_, step) => {
    const offset = weights.reduce(
      (sum, weight, index) => sum + weight * Math.sin(frequencies[index] * Math.PI * 2 * (step / steps) + phases[index]),
      0,
    )
    return [(width * step) / steps, base + amplitude * offset] as const
  })
}

/** Height of `curve` (from {@link wave}) at `x`. */
export function curveAt(curve: readonly Point[], x: number): number {
  for (let index = 1; index < curve.length; index += 1) {
    const [x0, y0] = curve[index - 1]
    const [x1, y1] = curve[index]
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / Math.max(1e-6, x1 - x0)
  }
  return curve[curve.length - 1][1]
}

/** Soft out-of-focus lights. */
export function bokeh(picture: Painting, random: Random, colors: readonly Rgb[], count: number, unit: number): void {
  const { width, height } = picture
  picture.blurred(unit * 0.008, () => {
    for (let index = 0; index < count; index += 1) {
      const radius = unit * random.uniform(0.02, 0.07)
      const center: Point = [random.uniform(0, width), random.uniform(0, height)]
      picture.add(circle(center, radius, random.choice(colors), random.between(50, 120) / 255))
    }
  })
}

/** Soft contact shadow under a figure or an object. */
export function shadow(picture: Painting, [x, y]: Point, rx: number, ry: number, opacity = 0.22): void {
  picture.blurred(Math.max(2, ry * 0.5), () => picture.add(oval([x, y], rx, ry, [40, 30, 35], opacity)))
}
