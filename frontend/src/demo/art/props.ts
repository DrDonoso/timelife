/**
 * Props of the demo photos, in the flat style of the figures: party and food, toys, furniture and
 * baby gear, rides and animals, speech bubbles. Sizes are multiples of `s`, usually the head radius
 * of the child next to them, so props keep their proportions at any framing.
 */
import type { Random } from '../random'
import {
  INK,
  WHITE,
  circle,
  darker,
  lighter,
  line,
  n,
  oval,
  polygon,
  rect,
  ring,
  shadow,
  shape,
  stroke,
  text,
  trapezoid,
  type Painting,
  type Point,
  type Rgb,
} from './paint'

export const WOOD: Rgb = [196, 146, 98]
export const CARDBOARD: Rgb = [214, 170, 112]
const STEEL: Rgb = [200, 206, 216]
const GOLD: Rgb = [250, 204, 21]
const SPRINKLES: readonly Rgb[] = [[244, 114, 182], [96, 165, 250], [250, 204, 21], [74, 222, 128], [192, 132, 252]]

// Shapes ---------------------------------------------------------------------------------------

export function starPoints([x, y]: Point, outer: number, inner = outer * 0.45, rotation = 0): Point[] {
  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + rotation + (index * Math.PI) / 5
    return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius] as const
  })
}

export function star(p: Painting, center: Point, outer: number, color: Rgb, rotation = 0, opacity = 1): void {
  p.add(polygon(starPoints(center, outer, outer * 0.45, rotation), color, opacity))
}

export function heart(p: Painting, [x, y]: Point, s: number, color: Rgb, opacity = 1): void {
  const d =
    `M${n(x)},${n(y + s * 0.9)} C${n(x - s * 1.4)},${n(y - s * 0.2)} ${n(x - s * 0.6)},${n(y - s * 1.2)} ${n(x)},${n(y - s * 0.35)} ` +
    `C${n(x + s * 0.6)},${n(y - s * 1.2)} ${n(x + s * 1.4)},${n(y - s * 0.2)} ${n(x)},${n(y + s * 0.9)} Z`
  p.add(shape(d, color, opacity))
}

/** Shapes drawn by `draw` turned by `degrees` around `center`. */
export function rotated(p: Painting, [x, y]: Point, degrees: number, draw: () => void): void {
  p.group(`transform="rotate(${n(degrees)} ${n(x)} ${n(y)})"`, draw)
}

/** Little lines around a moving figure (behind it, on the side it comes from). */
export function motion(p: Painting, [x, y]: Point, s: number, direction: -1 | 1, color: Rgb = WHITE): void {
  for (const [dy, length] of [[-0.6, 1.0], [0, 1.4], [0.6, 0.9]]) {
    const x0 = x - direction * 0.2 * s
    p.add(line([[x0, y + dy * s], [x0 - direction * length * s, y + dy * s]], color, 0.14 * s, 0.85, 'round'))
  }
}

/** Joy marks: three short strokes fanning out of a point. */
export function sparks(p: Painting, [x, y]: Point, s: number, color: Rgb = [250, 204, 21]): void {
  for (const angle of [-150, -110, -70, -30]) {
    const radians = (angle * Math.PI) / 180
    const [c, d] = [Math.cos(radians), Math.sin(radians)]
    p.add(line([[x + c * 0.55 * s, y + d * 0.55 * s], [x + c * 1.05 * s, y + d * 1.05 * s]], color, 0.13 * s, 1, 'round'))
  }
}

export function notes(p: Painting, [x, y]: Point, s: number, color: Rgb): void {
  for (const [dx, dy, size] of [[0, 0, 1], [0.9, -0.7, 0.8], [1.7, 0.1, 0.7]]) {
    const [nx, ny, k] = [x + dx * s, y + dy * s, size * s]
    p.add(oval([nx, ny], 0.26 * k, 0.2 * k, color, 1, -20))
    p.add(line([[nx + 0.22 * k, ny - 0.05 * k], [nx + 0.22 * k, ny - 1.0 * k]], color, 0.09 * k))
    p.add(line([[nx + 0.22 * k, ny - 1.0 * k], [nx + 0.55 * k, ny - 0.75 * k]], color, 0.12 * k, 1, 'round'))
  }
}

/** Speech bubble centred on (x, y) with its tail pointing at `tail` (a mouth). */
export function bubble(p: Painting, [x, y]: Point, content: string, size: number, tail: Point): void {
  const width = Math.max(content.length * size * 0.6 + size * 1.3, size * 2.4)
  const height = size * 1.9
  const [left, right] = [x - width / 2, x + width / 2]
  const bx = Math.min(right - height * 0.6, Math.max(left + height * 0.6, tail[0]))
  const below = tail[1] > y
  const edge = below ? y + height / 2 - size * 0.12 : y - height / 2 + size * 0.12
  const outline: Rgb = [214, 205, 210]
  const pad = size * 0.09
  p.add(polygon([[bx - size * 0.38 - pad, edge], [bx + size * 0.38 + pad, edge], tail], outline))
  p.add(rect(left - pad, y - height / 2 - pad, right + pad, y + height / 2 + pad, outline, 1, height / 2 + pad))
  p.add(rect(left, y - height / 2, right, y + height / 2, WHITE, 1, height / 2))
  p.add(polygon([[bx - size * 0.38, edge], [bx + size * 0.38, edge], [tail[0] + (bx - tail[0]) * 0.12, tail[1] + (edge - tail[1]) * 0.12]], WHITE))
  p.add(text([x, y + size * 0.36], content, size, INK))
}

/** A string of flags from `left` to `right`, sagging by `sag`; `letters` go on the flags. */
export function bunting(p: Painting, left: number, right: number, y: number, sag: number, size: number, colors: readonly Rgb[], letters = ''): void {
  const at = (t: number): Point => [left + (right - left) * t, y + sag * 4 * t * (1 - t)]
  const steps = Array.from({ length: 21 }, (_, index) => at(index / 20))
  p.add(line(steps, WHITE, size * 0.06, 0.9, 'round'))
  const count = letters ? letters.length : Math.max(3, Math.round((right - left) / (size * 1.4)))
  for (let index = 0; index < count; index += 1) {
    const letter = letters ? letters[index] : ''
    if (letter === ' ') continue
    const t = (index + 0.5) / count
    const [fx, fy] = at(t)
    const half = Math.min(size * 0.55, ((right - left) / count) * 0.42)
    const color = colors[index % colors.length]
    p.add(polygon([[fx - half, fy], [fx + half, fy], [fx, fy + half * 2.3]], color))
    if (letter) p.add(text([fx, fy + half * 1.15], letter, half * 1.15, WHITE))
  }
}

// Party and food -------------------------------------------------------------------------------

export type CakeTheme = 'party' | 'carrot' | 'chocolate' | 'unicorn' | 'dinosaur'

const CAKES: Readonly<Record<CakeTheme, { body: Rgb; icing: Rgb; filling: Rgb }>> = {
  party: { body: [255, 214, 226], icing: [255, 251, 251], filling: [244, 114, 182] },
  carrot: { body: [205, 133, 63], icing: [255, 248, 236], filling: [255, 230, 200] },
  chocolate: { body: [123, 74, 50], icing: [86, 50, 34], filling: [181, 120, 80] },
  unicorn: { body: [255, 250, 252], icing: [243, 232, 255], filling: [251, 207, 232] },
  dinosaur: { body: [132, 204, 22], icing: [101, 163, 13], filling: [217, 249, 157] },
}

function candle(p: Painting, x: number, base: number, s: number, color: Rgb, lit: boolean): void {
  const top = base - 0.6 * s
  p.add(rect(x - 0.07 * s, top, x + 0.07 * s, base, color, 1, 0.03 * s))
  for (const t of [0.25, 0.6]) p.add(line([[x - 0.07 * s, top + t * 0.6 * s], [x + 0.07 * s, top + (t + 0.12) * 0.6 * s]], WHITE, 0.035 * s))
  p.add(line([[x, top], [x, top - 0.08 * s]], INK, 0.025 * s))
  if (lit) {
    p.glow([x, top - 0.22 * s], 0.7 * s, [255, 214, 120], 0.55)
    const flame = (k: number, color: Rgb) =>
      shape(`M${n(x)},${n(top - 0.08 * s - 0.36 * s * k)} Q${n(x + 0.15 * s * k)},${n(top - 0.14 * s)} ${n(x)},${n(top - 0.06 * s)} Q${n(x - 0.15 * s * k)},${n(top - 0.14 * s)} ${n(x)},${n(top - 0.08 * s - 0.36 * s * k)} Z`, color)
    p.add(flame(1, [251, 146, 60]))
    p.add(flame(0.6, [254, 240, 138]))
  } else {
    p.add(stroke(`M${n(x)},${n(top - 0.1 * s)} q${n(0.15 * s)},${n(-0.2 * s)} 0,${n(-0.4 * s)} q${n(-0.15 * s)},${n(-0.2 * s)} 0,${n(-0.4 * s)}`, [170, 170, 180], 0.05 * s, 0.6))
  }
}

/** A cake on its plate standing on `y` (the table top), its candles lit or just blown out. */
export function cake(p: Painting, [x, y]: Point, s: number, { candles = 0, theme = 'party' as CakeTheme, lit = true, eaten = false } = {}): void {
  const { body, icing, filling } = CAKES[theme]
  const half = 1.25 * s
  const top = y - 1.2 * s
  p.add(oval([x, y], half * 1.32, 0.24 * s, [214, 222, 232]))
  p.add(oval([x, y - 0.04 * s], half * 1.2, 0.17 * s, WHITE))
  p.add(rect(x - half, top, x + half, y - 0.1 * s, body, 1, 0.12 * s))
  p.add(rect(x - half, top + 0.55 * s, x + half, top + 0.68 * s, filling))
  p.add(oval([x, top], half, 0.24 * s, icing))
  p.add(rect(x - half, top, x + half, top + 0.16 * s, icing))
  ;[0.32, 0.5, 0.26, 0.44, 0.3, 0.52, 0.28].forEach((length, index, all) => {
    const dx = x - half + ((index + 0.5) * 2 * half) / all.length
    p.add(rect(dx - 0.11 * s, top, dx + 0.11 * s, top + length * s, icing, 1, 0.11 * s))
  })
  switch (theme) {
    case 'party':
    case 'chocolate':
      for (let index = 0; index < 14; index += 1) {
        const dx = ((index * 37) % 23) / 23 - 0.5
        const dy = ((index * 17) % 11) / 11
        const color = theme === 'party' ? SPRINKLES[index % SPRINKLES.length] : GOLD
        p.add(rect(x + dx * 2 * half * 0.9 - 0.06 * s, top + 0.35 * s + dy * 0.75 * s, x + dx * 2 * half * 0.9 + 0.06 * s, top + 0.4 * s + dy * 0.75 * s, color, 1, 0.03 * s))
      }
      if (theme === 'chocolate') for (const dx of [-0.9, -0.3, 0.3, 0.9]) p.add(circle([x + dx * s, top - 0.02 * s], 0.15 * s, [66, 38, 26]))
      break
    case 'carrot':
      for (const dx of [-0.75, 0, 0.75]) {
        const [cx, cy] = [x + dx * s, top - 0.05 * s]
        p.add(polygon([[cx - 0.22 * s, cy - 0.06 * s], [cx + 0.22 * s, cy - 0.06 * s], [cx + 0.02 * s, cy + 0.12 * s]], [249, 115, 22]))
        p.add(oval([cx - 0.08 * s, cy - 0.14 * s], 0.06 * s, 0.12 * s, [74, 163, 60], 1, -30))
        p.add(oval([cx + 0.06 * s, cy - 0.15 * s], 0.06 * s, 0.12 * s, [74, 163, 60], 1, 30))
      }
      break
    case 'unicorn': {
      p.add(polygon([[x - 0.18 * s, top - 0.05 * s], [x + 0.18 * s, top - 0.05 * s], [x + 0.05 * s, top - 1.1 * s]], GOLD))
      for (const t of [0.3, 0.6]) p.add(line([[x - 0.14 * s * (1 - t), top - 0.05 * s - t * s], [x + 0.16 * s * (1 - t), top - 0.15 * s - t * s]], [234, 179, 8], 0.05 * s))
      for (const side of [-1, 1]) {
        p.add(polygon([[x + side * 0.45 * s, top - 0.02 * s], [x + side * 0.85 * s, top - 0.04 * s], [x + side * 0.7 * s, top - 0.48 * s]], WHITE))
        p.add(polygon([[x + side * 0.55 * s, top - 0.06 * s], [x + side * 0.77 * s, top - 0.07 * s], [x + side * 0.69 * s, top - 0.32 * s]], [251, 207, 232]))
        const [ex, ey] = [x + side * 0.42 * s, top + 0.62 * s]
        p.add(stroke(`M${n(ex - 0.2 * s)},${n(ey)} Q${n(ex)},${n(ey + 0.18 * s)} ${n(ex + 0.2 * s)},${n(ey)}`, INK, 0.05 * s))
        for (const k of [-1, 0, 1]) p.add(line([[ex + k * 0.13 * s, ey + 0.08 * s], [ex + k * 0.18 * s, ey + 0.2 * s]], INK, 0.035 * s))
      }
      for (const [dx, dy, color] of [[-1.15, 0.0, [244, 114, 182]], [-1.25, 0.35, [192, 132, 252]], [-1.18, 0.7, [96, 165, 250]], [-0.85, -0.12, [251, 191, 36]]] as const) {
        p.add(circle([x + dx * s, top + dy * s], 0.24 * s, color))
      }
      break
    }
    case 'dinosaur': {
      for (let index = 0; index < 9; index += 1) {
        const dx = -1.1 + index * 0.275
        p.add(polygon([[x + (dx - 0.12) * s, top + 0.02 * s], [x + (dx + 0.12) * s, top + 0.02 * s], [x + dx * s, top - 0.28 * s]], [249, 115, 22]))
      }
      for (const [dx, dy] of [[-0.8, 0.5], [0.1, 0.8], [0.7, 0.4], [-0.3, 0.3], [0.9, 0.9]]) p.add(circle([x + dx * s, top + dy * s], 0.11 * s, [217, 249, 157]))
      for (const side of [-1, 1]) {
        p.add(circle([x + side * 0.35 * s, top + 0.45 * s], 0.13 * s, WHITE))
        p.add(circle([x + side * 0.35 * s, top + 0.47 * s], 0.07 * s, INK))
      }
      break
    }
  }
  if (eaten) {
    p.add(circle([x + 0.65 * s, top + 0.15 * s], 0.42 * s, darker(body, 25)))
    for (const [dx, dy] of [[1.5, 1.05], [1.8, 1.1], [-1.6, 1.12], [1.2, 1.15]]) p.add(circle([x + dx * s, top + dy * s], 0.09 * s, body))
  }
  const candleColors: readonly Rgb[] = [[96, 165, 250], [244, 114, 182], [250, 204, 21]]
  const offset = theme === 'unicorn' || theme === 'dinosaur' ? 0.55 * s : 0
  for (let index = 0; index < candles; index += 1) {
    candle(p, x + offset + (index - (candles - 1) / 2) * 0.38 * s, top + 0.02 * s, s, candleColors[index % 3], lit)
  }
}

/** A table seen across from the camera: its far edge at `y`, the top filling the picture below. */
export function tableTop(p: Painting, y: number, color: Rgb, cloth?: Rgb): void {
  const { width, height } = p
  p.add(`<rect x="0" y="${n(y)}" width="${width}" height="${n(height - y)}" fill="${p.vertical(lighter(color, 22), darker(color, 10))}"/>`)
  p.add(line([[0, y], [width, y]], darker(color, 40), Math.max(2, (height - y) * 0.02)))
  if (cloth) {
    const step = Math.max(20, (height - y) / 5)
    for (let x = step / 2; x < width; x += step * 2) p.add(rect(x, y, x + step, height, cloth, 0.35))
    for (let row = y + step / 2; row < height; row += step * 2) p.add(rect(0, row, width, row + step, cloth, 0.35))
  }
}

export function present(p: Painting, [x, bottom]: Point, width: number, height: number, color: Rgb, ribbon: Rgb = WHITE): void {
  const top = bottom - height
  p.add(rect(x - width / 2, top, x + width / 2, bottom, color, 1, width * 0.04))
  p.add(rect(x - width * 0.55, top - height * 0.14, x + width * 0.55, top + height * 0.1, darker(color, 18), 1, width * 0.04))
  p.add(rect(x - width * 0.08, top - height * 0.14, x + width * 0.08, bottom, ribbon))
  for (const side of [-1, 1]) p.add(oval([x + side * width * 0.16, top - height * 0.24], width * 0.17, height * 0.11, ribbon, 1, side * 25))
  p.add(circle([x, top - height * 0.16], width * 0.07, darker(ribbon, 25)))
}

export function balloon(p: Painting, [x, y]: Point, r: number, color: Rgb, end: Point): void {
  p.add(stroke(`M${n(x)},${n(y + 1.25 * r)} Q${n(x + 0.4 * r)},${n((y + end[1]) / 2)} ${n(end[0])},${n(end[1])}`, [255, 255, 255], Math.max(1, r * 0.05), 0.9))
  p.add(oval([x, y], r, r * 1.18, color))
  p.add(polygon([[x - r * 0.13, y + r * 1.28], [x + r * 0.13, y + r * 1.28], [x, y + r * 1.13]], color))
  p.add(oval([x - r * 0.38, y - r * 0.45], r * 0.18, r * 0.3, WHITE, 0.45, 25))
}

/** Balloons held in `hand`. */
export function balloons(p: Painting, [x, y]: Point, s: number, colors: readonly Rgb[]): void {
  const spots: readonly Point[] = [[-0.9, -4.6], [0.5, -5.2], [1.5, -4.2]]
  spots.forEach(([dx, dy], index) => balloon(p, [x + dx * s, y + dy * s], 0.75 * s, colors[index % colors.length], [x, y]))
}

export function stocking(p: Painting, [x, top]: Point, s: number, color: Rgb, label = ''): void {
  const half = 0.36 * s
  const d =
    `M${n(x - half)},${n(top)} L${n(x + half)},${n(top)} L${n(x + half)},${n(top + 1.35 * s)} Q${n(x + half + 0.75 * s)},${n(top + 1.4 * s)} ${n(x + half + 0.7 * s)},${n(top + 1.75 * s)} ` +
    `Q${n(x + half + 0.6 * s)},${n(top + 2.05 * s)} ${n(x)},${n(top + 1.95 * s)} Q${n(x - half - 0.1 * s)},${n(top + 1.85 * s)} ${n(x - half)},${n(top + 1.45 * s)} Z`
  p.add(shape(d, color))
  for (const dy of [0.75, 1.15]) p.add(line([[x - half, top + dy * s], [x + half, top + dy * s]], WHITE, 0.06 * s, 0.7))
  p.add(rect(x - half - 0.08 * s, top - 0.1 * s, x + half + 0.08 * s, top + 0.38 * s, WHITE, 1, 0.1 * s))
  if (label) p.add(text([x, top + 0.26 * s], label, 0.3 * s, color))
}

export function fireplace(p: Painting, x: number, floor: number, width: number, height: number): { mantel: number } {
  const [left, right, top] = [x - width / 2, x + width / 2, floor - height]
  p.add(rect(left, top, right, floor, [190, 112, 88]))
  const course = height / 9
  for (let row = 1; row < 9; row += 1) {
    const y = top + row * course
    p.add(line([[left, y], [right, y]], [222, 170, 150], course * 0.12))
    for (let column = 0; column < 7; column += 1) {
      const bx = left + ((column + (row % 2) * 0.5) * width) / 6
      if (bx > left && bx < right) p.add(line([[bx, y - course], [bx, y]], [222, 170, 150], course * 0.1))
    }
  }
  const opening = width * 0.3
  const archTop = floor - height * 0.62
  p.add(shape(`M${n(x - opening)},${n(floor)} L${n(x - opening)},${n(archTop + opening * 0.5)} Q${n(x - opening)},${n(archTop)} ${n(x)},${n(archTop)} Q${n(x + opening)},${n(archTop)} ${n(x + opening)},${n(archTop + opening * 0.5)} L${n(x + opening)},${n(floor)} Z`, [46, 30, 34]))
  p.glow([x, floor - height * 0.15], width * 0.5, [255, 170, 80], 0.6)
  for (const [dx, k, color] of [[-0.12, 0.8, [234, 88, 12]], [0.1, 0.95, [249, 115, 22]], [0, 0.6, [253, 224, 71]]] as const) {
    const [fx, base] = [x + dx * width, floor - height * 0.06]
    const tip = base - height * 0.32 * k
    p.add(shape(`M${n(fx)},${n(tip)} Q${n(fx + width * 0.1 * k)},${n(base - height * 0.1)} ${n(fx)},${n(base)} Q${n(fx - width * 0.1 * k)},${n(base - height * 0.1)} ${n(fx)},${n(tip)} Z`, color))
  }
  p.add(rect(x - opening * 0.9, floor - height * 0.06, x + opening * 0.9, floor, [92, 64, 51], 1, height * 0.02))
  const mantel = top - height * 0.02
  p.add(rect(left - width * 0.08, mantel - height * 0.08, right + width * 0.08, mantel + height * 0.04, [120, 82, 60], 1, height * 0.015))
  return { mantel: mantel + height * 0.04 }
}

/** Back and legs of a high chair for a child sitting at `seat`; `tray()` draws the tray in front. */
export function highChair(p: Painting, [x, seat]: Point, s: number, color: Rgb, floor: number): () => Point {
  for (const side of [-1, 1]) p.add(line([[x + side * 0.95 * s, seat + 0.2 * s], [x + side * 1.65 * s, floor]], darker(color, 30), 0.22 * s, 1, 'round'))
  p.add(line([[x - 1.35 * s, floor - 0.9 * s], [x + 1.35 * s, floor - 0.9 * s]], darker(color, 30), 0.16 * s, 1, 'round'))
  p.add(rect(x - 1.2 * s, seat - 3.0 * s, x + 1.2 * s, seat + 0.35 * s, color, 1, 0.55 * s))
  p.add(rect(x - 1.0 * s, seat - 2.8 * s, x + 1.0 * s, seat + 0.1 * s, lighter(color, 30), 1, 0.45 * s))
  return () => {
    p.add(rect(x - 1.9 * s, seat - 1.05 * s, x + 1.9 * s, seat - 0.5 * s, WHITE, 1, 0.22 * s))
    p.add(rect(x - 1.9 * s, seat - 0.68 * s, x + 1.9 * s, seat - 0.5 * s, darker(color, 10), 1, 0.09 * s))
    return [x, seat - 0.72 * s]
  }
}

export function bowl(p: Painting, [x, y]: Point, s: number, food: Rgb, color: Rgb = [125, 211, 252]): void {
  p.add(shape(`M${n(x - 0.72 * s)},${n(y - 0.42 * s)} A${n(0.72 * s)},${n(0.48 * s)} 0 0,0 ${n(x + 0.72 * s)},${n(y - 0.42 * s)} Z`, color))
  p.add(oval([x, y - 0.42 * s], 0.72 * s, 0.15 * s, darker(color, 30)))
  p.add(oval([x, y - 0.4 * s], 0.6 * s, 0.1 * s, food))
}

export function spoon(p: Painting, from: Point, to: Point, s: number, food?: Rgb): void {
  p.add(line([from, to], STEEL, 0.1 * s, 1, 'round'))
  p.add(oval(to, 0.2 * s, 0.13 * s, lighter(STEEL, 20)))
  if (food) p.add(oval([to[0], to[1] - 0.03 * s], 0.15 * s, 0.09 * s, food))
}

export function cup(p: Painting, [x, y]: Point, s: number, color: Rgb, drink: Rgb = [255, 255, 255]): void {
  p.add(ring([x + 0.42 * s, y - 0.45 * s], 0.2 * s, darker(color, 15), 0.08 * s))
  p.add(trapezoid(x, y - 0.85 * s, y, 0.78 * s, 0.6 * s, 0.1 * s, color))
  p.add(oval([x, y - 0.85 * s], 0.39 * s, 0.1 * s, drink))
}

/** An ice cream cone held at `hand` (the middle of the cone). */
export function iceCream(p: Painting, [x, y]: Point, s: number, flavour: Rgb): void {
  p.add(polygon([[x - 0.34 * s, y - 0.45 * s], [x + 0.34 * s, y - 0.45 * s], [x, y + 0.75 * s]], [234, 179, 98]))
  for (const t of [0.15, 0.45]) {
    p.add(line([[x - 0.34 * s * (1 - t), y - 0.45 * s + t * 1.2 * s], [x + 0.2 * s * (1 - t), y - 0.45 * s + (t + 0.3) * 1.2 * s]], [200, 140, 70], 0.04 * s))
  }
  p.add(circle([x, y - 0.68 * s], 0.42 * s, flavour))
  p.add(oval([x - 0.2 * s, y - 0.42 * s], 0.12 * s, 0.2 * s, flavour))
  p.add(circle([x + 0.05 * s, y - 1.1 * s], 0.11 * s, [220, 38, 38]))
  p.add(oval([x - 0.15 * s, y - 0.82 * s], 0.08 * s, 0.12 * s, WHITE, 0.5, 30))
}

export function plate(p: Painting, [x, y]: Point, s: number): void {
  p.add(oval([x, y], 1.0 * s, 0.3 * s, [214, 222, 232]))
  p.add(oval([x, y - 0.03 * s], 0.85 * s, 0.22 * s, WHITE))
}

/** Biscuits on a baking tray, iced or still plain. */
export function biscuits(p: Painting, [x, y]: Point, s: number, iced: number): void {
  p.add(rect(x - 1.9 * s, y - 0.55 * s, x + 1.9 * s, y, [120, 126, 138], 1, 0.12 * s))
  p.add(rect(x - 1.75 * s, y - 0.5 * s, x + 1.75 * s, y - 0.08 * s, [160, 166, 178], 1, 0.08 * s))
  const icing: readonly Rgb[] = [WHITE, [239, 68, 68], [74, 222, 128], [250, 204, 21]]
  for (let index = 0; index < 5; index += 1) {
    const center: Point = [x + (index - 2) * 0.68 * s, y - 0.3 * s]
    const dough: Rgb = [222, 172, 108]
    if (index % 2 === 0) star(p, center, 0.3 * s, dough)
    else p.add(polygon([[center[0], center[1] - 0.3 * s], [center[0] + 0.25 * s, center[1] + 0.18 * s], [center[0] - 0.25 * s, center[1] + 0.18 * s]], dough))
    if (index < iced) {
      ;[[-0.08, 0], [0.09, 0.06], [0, -0.12]].forEach(([dx, dy], dot) => p.add(circle([center[0] + dx * s, center[1] + dy * s], 0.06 * s, icing[(index + dot) % icing.length])))
    }
  }
}

export function teaSet(p: Painting, [x, y]: Point, s: number, color: Rgb): void {
  const [tx, ty] = [x - 0.9 * s, y - 0.5 * s]
  p.add(polygon([[tx - 0.45 * s, ty], [tx - 0.95 * s, ty - 0.45 * s], [tx - 0.85 * s, ty - 0.5 * s], [tx - 0.4 * s, ty - 0.18 * s]], color))
  p.add(ring([tx + 0.55 * s, ty - 0.02 * s], 0.22 * s, darker(color, 20), 0.09 * s))
  p.add(oval([tx, ty], 0.58 * s, 0.48 * s, color))
  p.add(oval([tx, ty - 0.46 * s], 0.32 * s, 0.09 * s, darker(color, 20)))
  p.add(circle([tx, ty - 0.58 * s], 0.09 * s, darker(color, 20)))
  for (const [dx, dy] of [[-0.2, -0.05], [0.18, 0.12], [-0.05, 0.25]]) p.add(circle([tx + dx * s, ty + dy * s], 0.07 * s, WHITE))
  for (const dx of [0.35, 1.25]) {
    p.add(oval([x + dx * s, y - 0.05 * s], 0.42 * s, 0.1 * s, lighter(color, 40)))
    cup(p, [x + dx * s, y - 0.08 * s], 0.5 * s, color, [196, 132, 82])
  }
}
// Toys -----------------------------------------------------------------------------------------

export function rattle(p: Painting, [x, y]: Point, s: number, angle: number, color: Rgb): void {
  rotated(p, [x, y], angle, () => {
    p.add(rect(x - 0.08 * s, y - 0.35 * s, x + 0.08 * s, y + 0.3 * s, lighter(color, 40), 1, 0.08 * s))
    p.add(ring([x, y + 0.38 * s], 0.16 * s, color, 0.07 * s))
    p.add(circle([x, y - 0.65 * s], 0.38 * s, color))
    p.add(oval([x, y - 0.65 * s], 0.38 * s, 0.1 * s, WHITE, 0.8))
    p.add(circle([x - 0.13 * s, y - 0.8 * s], 0.08 * s, WHITE, 0.6))
  })
}

/** Stacking rings toy: the cone with rings, or one ring when `ring` is set. */
export function stacker(p: Painting, [x, ground]: Point, s: number, colors: readonly Rgb[]): void {
  p.add(oval([x, ground - 0.1 * s], 0.75 * s, 0.2 * s, [234, 179, 98]))
  p.add(rect(x - 0.07 * s, ground - 1.7 * s, x + 0.07 * s, ground - 0.1 * s, [234, 179, 98], 1, 0.07 * s))
  for (let level = 0; level < 4; level += 1) {
    const half = (0.65 - level * 0.11) * s
    p.add(oval([x, ground - (0.32 + level * 0.32) * s], half, 0.17 * s, colors[level % colors.length]))
  }
  p.add(circle([x, ground - 1.75 * s], 0.15 * s, colors[4 % colors.length]))
}

export function crayons(p: Painting, [x, y]: Point, s: number, random: Random, count = 4): void {
  const colors: readonly Rgb[] = [[239, 68, 68], [59, 130, 246], [34, 197, 94], [250, 204, 21], [168, 85, 247]]
  for (let index = 0; index < count; index += 1) {
    const [cx, cy] = [x + (index - (count - 1) / 2) * 0.55 * s + random.uniform(-0.1, 0.1) * s, y + random.uniform(-0.15, 0.15) * s]
    const angle = random.uniform(-40, 40)
    const color = colors[index % colors.length]
    rotated(p, [cx, cy], angle, () => {
      p.add(rect(cx - 0.45 * s, cy - 0.08 * s, cx + 0.35 * s, cy + 0.08 * s, color, 1, 0.04 * s))
      p.add(polygon([[cx + 0.35 * s, cy - 0.08 * s], [cx + 0.55 * s, cy], [cx + 0.35 * s, cy + 0.08 * s]], darker(color, 30)))
      p.add(rect(cx - 0.2 * s, cy - 0.08 * s, cx, cy + 0.08 * s, WHITE, 0.5))
    })
  }
}

/** One crayon held at `hand`, pointing down to the paper. */
export function heldCrayon(p: Painting, [x, y]: Point, s: number, color: Rgb): void {
  p.add(line([[x - 0.1 * s, y - 0.25 * s], [x + 0.12 * s, y + 0.45 * s]], color, 0.16 * s, 1, 'round'))
}

export type Drawing = 'scribble' | 'face' | 'E' | 'butterfly'

/** A sheet of paper centred on (x, y) with a child's drawing on it. */
export function paper(p: Painting, [x, y]: Point, width: number, height: number, drawing: Drawing, random: Random, angle = 0): void {
  rotated(p, [x, y], angle, () => {
    p.add(rect(x - width / 2 + width * 0.02, y - height / 2 + width * 0.03, x + width / 2 + width * 0.02, y + height / 2 + width * 0.03, [60, 40, 40], 0.12))
    p.add(rect(x - width / 2, y - height / 2, x + width / 2, y + height / 2, WHITE))
    const k = Math.min(width, height)
    const thick = k * 0.04
    switch (drawing) {
      case 'scribble':
        for (const color of [[239, 68, 68], [59, 130, 246], [34, 197, 94], [250, 204, 21]] as const) {
          const loop: Point[] = Array.from({ length: 9 }, () => [x + random.uniform(-0.38, 0.38) * width, y + random.uniform(-0.36, 0.36) * height] as const)
          p.add(line(loop, color, thick, 0.9, 'round'))
        }
        break
      case 'face': {
        const r = k * 0.28
        p.add(`<circle cx="${n(x)}" cy="${n(y + k * 0.05)}" r="${n(r)}" fill="none" stroke="#f97316" stroke-width="${n(thick)}"/>`)
        for (let index = 0; index < 9; index += 1) {
          const a = Math.PI * (1.1 + (index * 0.8) / 8)
          const [c, d] = [Math.cos(a), Math.sin(a)]
          p.add(line([[x + c * r, y + k * 0.05 + d * r], [x + c * r * 1.55, y + k * 0.05 + d * r * 1.55 + k * 0.03]], [120, 72, 40], thick * 0.8, 1, 'round'))
        }
        for (const side of [-1, 1]) p.add(circle([x + side * r * 0.38, y - r * 0.1], thick * 0.9, [37, 99, 235]))
        p.add(stroke(`M${n(x - r * 0.45)},${n(y + r * 0.35)} Q${n(x)},${n(y + r * 0.85)} ${n(x + r * 0.45)},${n(y + r * 0.35)}`, [220, 38, 38], thick))
        break
      }
      case 'E': {
        const [left, top, h] = [x - k * 0.22, y - k * 0.32, k * 0.64]
        const red: Rgb = [220, 38, 38]
        p.add(line([[left + k * 0.3, top], [left, top], [left, top + h], [left + k * 0.32, top + h]], red, thick * 1.4, 1, 'round'))
        p.add(line([[left, top + h * 0.5], [left + k * 0.24, top + h * 0.48]], red, thick * 1.4, 1, 'round'))
        p.add(line([[left, top + h * 0.25], [left + k * 0.18, top + h * 0.27]], red, thick * 1.1, 0.9, 'round'))
        p.add(line([[left + k * 0.45, top + h * 0.2], [left + k * 0.42, top + h * 0.75]], [59, 130, 246], thick, 0.8, 'round'))
        break
      }
      case 'butterfly':
        butterfly(p, [x, y], k * 0.22, [168, 85, 247], 0)
        break
    }
  })
}

export function book(p: Painting, [x, y]: Point, s: number, cover: Rgb): void {
  p.add(rect(x - 1.15 * s, y - 0.72 * s, x + 1.15 * s, y + 0.72 * s, cover, 1, 0.08 * s))
  for (const side of [-1, 1]) {
    const outer = x + side * 1.05 * s
    p.add(polygon([[x, y - 0.55 * s], [outer, y - 0.65 * s], [outer, y + 0.62 * s], [x, y + 0.68 * s]], [255, 252, 245]))
  }
  p.add(line([[x, y - 0.55 * s], [x, y + 0.68 * s]], [214, 205, 190], 0.05 * s))
  p.add(circle([x - 0.55 * s, y - 0.18 * s], 0.2 * s, [250, 204, 21]))
  p.add(shape(`M${n(x - 0.95 * s)},${n(y + 0.5 * s)} Q${n(x - 0.55 * s)},${n(y + 0.05 * s)} ${n(x - 0.12 * s)},${n(y + 0.5 * s)} Z`, [134, 239, 172]))
  for (const dy of [-0.3, -0.1, 0.1, 0.3]) p.add(line([[x + 0.2 * s, y + dy * s], [x + 0.85 * s, y + dy * s]], [190, 182, 175], 0.06 * s, 1, 'round'))
}

/** A six-piece puzzle on the floor, one piece missing (it is in the child's hand). */
export function puzzle(p: Painting, [x, y]: Point, s: number): void {
  const colors: readonly Rgb[] = [[125, 211, 252], [125, 211, 252], [250, 204, 21], [134, 239, 172], [74, 222, 128], [134, 239, 172]]
  const [w, h] = [0.9 * s, 0.75 * s]
  p.add(rect(x - 1.5 * w, y - h - 0.1 * s, x + 1.5 * w, y + h + 0.1 * s, [180, 140, 100], 1, 0.1 * s))
  colors.forEach((color, index) => {
    if (index === 5) return
    const [column, row] = [index % 3, Math.floor(index / 3)]
    const [left, top] = [x - 1.5 * w + column * w, y - h + row * h]
    p.add(rect(left + 0.02 * s, top + 0.02 * s, left + w - 0.02 * s, top + h - 0.02 * s, color, 1, 0.05 * s))
    if (column < 2) p.add(circle([left + w, top + h / 2], 0.13 * s, color))
  })
  p.add(circle([x + 0.2 * w, y - 0.45 * h], 0.28 * s, [253, 186, 116]))
}

export function puzzlePiece(p: Painting, [x, y]: Point, s: number): void {
  p.add(rect(x - 0.42 * s, y - 0.36 * s, x + 0.42 * s, y + 0.36 * s, [134, 239, 172], 1, 0.05 * s))
  p.add(circle([x - 0.42 * s, y], 0.13 * s, [134, 239, 172]))
}

export function shapeSorter(p: Painting, [x, ground]: Point, s: number): void {
  const side = 1.3 * s
  p.add(polygon([[x - side / 2, ground - side], [x + side / 2, ground - side], [x + side * 0.75, ground - side * 1.25], [x - side * 0.25, ground - side * 1.25]], [254, 240, 138]))
  p.add(rect(x - side / 2, ground - side, x + side / 2, ground, [239, 68, 68], 1, 0.06 * s))
  p.add(polygon([[x + side / 2, ground - side], [x + side * 0.75, ground - side * 1.25], [x + side * 0.75, ground - side * 0.25], [x + side / 2, ground]], [200, 50, 50]))
  const top = ground - side * 1.12
  p.add(oval([x - 0.2 * s, top], 0.17 * s, 0.07 * s, INK))
  p.add(rect(x + 0.08 * s, top - 0.06 * s, x + 0.3 * s, top + 0.06 * s, INK))
  p.add(rect(x - 0.25 * s, ground - 0.75 * s, x + 0.25 * s, ground - 0.25 * s, [254, 226, 226], 0.9, 0.06 * s))
}

export function sorterShape(p: Painting, [x, y]: Point, s: number, kind: 'circle' | 'square' | 'triangle'): void {
  if (kind === 'circle') p.add(circle([x, y], 0.3 * s, [250, 204, 21]))
  else if (kind === 'square') p.add(rect(x - 0.27 * s, y - 0.27 * s, x + 0.27 * s, y + 0.27 * s, [59, 130, 246], 1, 0.05 * s))
  else p.add(polygon([[x, y - 0.32 * s], [x + 0.32 * s, y + 0.25 * s], [x - 0.32 * s, y + 0.25 * s]], [34, 197, 94]))
}

/** A tower of blocks from `ground` up (or tumbling when `fallen`). */
export function blocks(p: Painting, [x, ground]: Point, s: number, labels: readonly string[], colors: readonly Rgb[], fallen = false): void {
  const side = 0.95 * s
  labels.forEach((label, index) => {
    const [cx, cy, angle] = fallen
      ? [x + (index - 1) * 1.15 * s, ground - side / 2 - (index === 1 ? 0.9 * s : 0), [12, -25, 35][index % 3]]
      : [x + [0, 0.08, -0.06, 0.05][index % 4] * s, ground - side / 2 - index * side, 0]
    rotated(p, [cx, cy], angle, () => {
      const color = colors[index % colors.length]
      p.add(rect(cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2, color, 1, side * 0.1))
      p.add(rect(cx - side * 0.36, cy - side * 0.36, cx + side * 0.36, cy + side * 0.36, lighter(color, 60), 1, side * 0.08))
      p.add(text([cx, cy + side * 0.2], label, side * 0.55, darker(color, 40)))
    })
  })
}

export function ball(p: Painting, [x, y]: Point, r: number, kind: 'beach' | 'football' = 'beach'): void {
  if (kind === 'football') {
    p.add(circle([x, y], r, WHITE))
    p.add(polygon(Array.from({ length: 5 }, (_, index) => {
      const a = -Math.PI / 2 + (index * 2 * Math.PI) / 5
      return [x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.35] as const
    }), INK))
    for (let index = 0; index < 5; index += 1) {
      const a = -Math.PI / 2 + Math.PI / 5 + (index * 2 * Math.PI) / 5
      p.add(circle([x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85], r * 0.18, INK))
    }
    p.add(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="none" stroke="#3e2c28" stroke-width="${n(r * 0.05)}"/>`)
    return
  }
  const colors: readonly Rgb[] = [[239, 68, 68], [255, 255, 255], [59, 130, 246], [255, 255, 255], [250, 204, 21], [255, 255, 255]]
  colors.forEach((color, index) => {
    const a0 = (index * Math.PI) / 3
    const a1 = a0 + Math.PI / 3
    p.add(shape(`M${n(x)},${n(y)} L${n(x + Math.cos(a0) * r)},${n(y + Math.sin(a0) * r)} A${n(r)},${n(r)} 0 0,1 ${n(x + Math.cos(a1) * r)},${n(y + Math.sin(a1) * r)} Z`, color))
  })
  p.add(circle([x, y], r * 0.18, WHITE))
  p.add(oval([x - r * 0.4, y - r * 0.45], r * 0.2, r * 0.12, WHITE, 0.6, -35))
}

export function teddy(p: Painting, [x, ground]: Point, s: number, fur: Rgb = [198, 139, 89]): void {
  const dark: Rgb = [60, 40, 30]
  shadow(p, [x, ground], 1.0 * s, 0.14 * s, 0.18)
  for (const side of [-1, 1]) p.add(oval([x + side * 0.55 * s, ground - 0.25 * s], 0.35 * s, 0.28 * s, fur))
  p.add(oval([x, ground - 0.85 * s], 0.75 * s, 0.8 * s, fur))
  p.add(oval([x, ground - 0.75 * s], 0.42 * s, 0.48 * s, lighter(fur, 35)))
  for (const side of [-1, 1]) p.add(oval([x + side * 0.75 * s, ground - 1.0 * s], 0.22 * s, 0.38 * s, fur, 1, side * 30))
  const hy = ground - 2.0 * s
  for (const side of [-1, 1]) {
    p.add(circle([x + side * 0.5 * s, hy - 0.45 * s], 0.25 * s, fur))
    p.add(circle([x + side * 0.5 * s, hy - 0.45 * s], 0.13 * s, lighter(fur, 35)))
  }
  p.add(circle([x, hy], 0.62 * s, fur))
  p.add(oval([x, hy + 0.2 * s], 0.28 * s, 0.22 * s, lighter(fur, 40)))
  p.add(oval([x, hy + 0.12 * s], 0.1 * s, 0.07 * s, dark))
  for (const side of [-1, 1]) p.add(circle([x + side * 0.24 * s, hy - 0.1 * s], 0.07 * s, dark))
  p.add(rect(x - 0.4 * s, hy + 0.5 * s, x + 0.4 * s, hy + 0.62 * s, [239, 68, 68], 1, 0.05 * s))
}

export function duck(p: Painting, [x, y]: Point, s: number): void {
  p.add(oval([x, y], 0.62 * s, 0.38 * s, [253, 224, 71]))
  p.add(polygon([[x + 0.45 * s, y - 0.15 * s], [x + 0.8 * s, y - 0.35 * s], [x + 0.55 * s, y - 0.02 * s]], [253, 224, 71]))
  p.add(circle([x - 0.3 * s, y - 0.45 * s], 0.3 * s, [253, 224, 71]))
  p.add(oval([x - 0.62 * s, y - 0.4 * s], 0.15 * s, 0.07 * s, [249, 115, 22]))
  p.add(circle([x - 0.36 * s, y - 0.53 * s], 0.05 * s, INK))
  p.add(oval([x + 0.08 * s, y - 0.06 * s], 0.25 * s, 0.13 * s, [250, 204, 21], 1, -15))
}

export function bunny(p: Painting, [x, ground]: Point, s: number, fur: Rgb = [244, 238, 250]): void {
  shadow(p, [x, ground], 0.8 * s, 0.12 * s, 0.16)
  for (const side of [-1, 1]) {
    p.add(oval([x + side * 0.28 * s, ground - 2.15 * s], 0.18 * s, 0.55 * s, fur, 1, side * 10))
    p.add(oval([x + side * 0.28 * s, ground - 2.1 * s], 0.08 * s, 0.38 * s, [251, 207, 232], 1, side * 10))
  }
  p.add(oval([x, ground - 0.6 * s], 0.62 * s, 0.62 * s, fur))
  p.add(circle([x, ground - 1.45 * s], 0.5 * s, fur))
  for (const side of [-1, 1]) p.add(circle([x + side * 0.18 * s, ground - 1.5 * s], 0.06 * s, INK))
  p.add(circle([x, ground - 1.36 * s], 0.06 * s, [244, 114, 182]))
}
// Furniture and baby gear ----------------------------------------------------------------------

/** A sofa standing on `ground`; returns the height of its seat. */
export function sofa(p: Painting, x: number, ground: number, width: number, s: number, color: Rgb): number {
  const [left, right] = [x - width / 2, x + width / 2]
  const seat = ground - 2.5 * s
  p.add(rect(left + 0.4 * s, ground - 5.0 * s, right - 0.4 * s, seat + 0.3 * s, darker(color, 12), 1, 0.7 * s))
  const cushions = Math.max(2, Math.round(width / (4 * s)))
  for (let index = 0; index < cushions; index += 1) {
    const cx0 = left + 0.7 * s + (index * (width - 1.4 * s)) / cushions
    const cx1 = left + 0.7 * s + ((index + 1) * (width - 1.4 * s)) / cushions
    p.add(rect(cx0 + 0.08 * s, ground - 4.6 * s, cx1 - 0.08 * s, seat, lighter(color, 8), 1, 0.5 * s))
  }
  p.add(rect(left + 0.4 * s, seat - 0.15 * s, right - 0.4 * s, seat + 0.55 * s, lighter(color, 22), 1, 0.3 * s))
  p.add(rect(left + 0.4 * s, seat + 0.45 * s, right - 0.4 * s, ground - 0.35 * s, color, 1, 0.2 * s))
  for (const side of [-1, 1]) {
    const ax = side < 0 ? left : right - 1.0 * s
    p.add(rect(ax, ground - 3.4 * s, ax + 1.0 * s, ground - 0.35 * s, darker(color, 6), 1, 0.45 * s))
    p.add(rect(x + side * (width / 2 - 0.9 * s) - 0.12 * s, ground - 0.4 * s, x + side * (width / 2 - 0.9 * s) + 0.12 * s, ground, [92, 64, 51]))
  }
  return seat
}

/** A bed seen from the side, headboard on the left; returns the pillow centre and a duvet painter. */
export function bed(p: Painting, x: number, floor: number, width: number, s: number, color: Rgb, duvet: Rgb): { pillow: Point; cover: () => void } {
  const [left, right] = [x - width / 2, x + width / 2]
  const top = floor - 2.4 * s
  p.add(rect(left, floor - 5.2 * s, left + 0.7 * s, floor, color, 1, 0.35 * s))
  p.add(rect(right - 0.5 * s, floor - 3.6 * s, right, floor, color, 1, 0.25 * s))
  p.add(rect(left + 0.3 * s, top, right - 0.2 * s, floor - 1.0 * s, WHITE, 1, 0.3 * s))
  p.add(rect(left + 0.3 * s, floor - 1.3 * s, right - 0.2 * s, floor - 0.8 * s, darker(color, 15)))
  const pillow: Point = [left + 1.9 * s, top - 0.45 * s]
  p.add(oval(pillow, 1.3 * s, 0.6 * s, [241, 245, 249]))
  return {
    pillow,
    cover: () => {
      const start = left + 2.2 * s
      const d =
        `M${n(start)},${n(top + 0.2 * s)} Q${n(start + 0.3 * s)},${n(top - 1.6 * s)} ${n(start + 2.2 * s)},${n(top - 1.2 * s)} ` +
        `Q${n(right - 1.2 * s)},${n(top - 0.9 * s)} ${n(right - 0.15 * s)},${n(top - 0.2 * s)} L${n(right - 0.15 * s)},${n(floor - 1.05 * s)} L${n(start - 0.4 * s)},${n(floor - 1.05 * s)} Z`
      p.add(shape(d, duvet))
      for (const [dx, dy] of [[0.9, -0.6], [2.3, -0.4], [3.6, 0.2], [1.6, 0.5], [4.6, -0.1], [3.0, 0.9]]) {
        if (start + dx * s < right - 0.4 * s) star(p, [start + dx * s, top + dy * s], 0.22 * s, lighter(duvet, 60))
      }
      p.add(stroke(`M${n(start)},${n(top + 0.2 * s)} Q${n(start + 0.3 * s)},${n(top - 1.6 * s)} ${n(start + 2.2 * s)},${n(top - 1.2 * s)}`, lighter(duvet, 40), 0.25 * s))
    },
  }
}

/** A baby bath: the back and the water (before the child), then `front()` with bubbles. */
export function babyBath(p: Painting, [x, rim]: Point, s: number, color: Rgb): () => void {
  p.add(oval([x, rim], 2.6 * s, 0.6 * s, darker(color, 25)))
  p.add(oval([x, rim + 0.08 * s], 2.4 * s, 0.48 * s, [165, 222, 245]))
  return () => {
    p.add(shape(`M${n(x - 2.6 * s)},${n(rim)} Q${n(x - 2.5 * s)},${n(rim + 2.4 * s)} ${n(x)},${n(rim + 2.4 * s)} Q${n(x + 2.5 * s)},${n(rim + 2.4 * s)} ${n(x + 2.6 * s)},${n(rim)} Q${n(x)},${n(rim + 0.7 * s)} ${n(x - 2.6 * s)},${n(rim)} Z`, color))
    p.add(oval([x - 1.3 * s, rim + 1.2 * s], 0.5 * s, 0.25 * s, lighter(color, 40), 0.6, -20))
    for (const [dx, dy, r] of [[-1.9, 0.05, 0.32], [-1.45, -0.15, 0.25], [-1.1, 0.1, 0.36], [1.2, 0.08, 0.34], [1.6, -0.12, 0.26], [2.0, 0.06, 0.3], [-0.6, 0.18, 0.22], [0.7, 0.2, 0.24]]) {
      p.add(circle([x + dx * s, rim + dy * s], r * s, WHITE, 0.92))
    }
    duck(p, [x + 1.55 * s, rim - 0.3 * s], 0.55 * s)
  }
}

/** A play gym's arches seen from above, crossing over a baby lying at `center`. */
export function playGym(p: Painting, [x, y]: Point, s: number): void {
  const colors: readonly Rgb[] = [[244, 114, 182], [96, 165, 250]]
  const ends: readonly (readonly [Point, Point])[] = [
    [[x - 3.2 * s, y - 2.6 * s], [x + 3.2 * s, y + 2.2 * s]],
    [[x + 3.2 * s, y - 2.6 * s], [x - 3.2 * s, y + 2.2 * s]],
  ]
  ends.forEach(([a, b], index) => {
    p.add(circle(a, 0.45 * s, darker(colors[index], 20)))
    p.add(circle(b, 0.45 * s, darker(colors[index], 20)))
    p.add(line([a, b], colors[index], 0.42 * s, 0.95, 'round'))
  })
  const center: Point = [x, y - 0.2 * s]
  star(p, [center[0] - 1.1 * s, center[1] - 0.75 * s], 0.45 * s, [250, 204, 21])
  p.add(circle([center[0] + 1.1 * s, center[1] - 0.8 * s], 0.38 * s, [74, 222, 128]))
  p.add(circle(center, 0.3 * s, WHITE))
  heart(p, [center[0] + 1.05 * s, center[1] + 0.85 * s], 0.32 * s, [239, 68, 68])
}

/** A baby car seat on the floor: shell (before the baby), then `front()` with the handle. */
export function carSeat(p: Painting, [x, ground]: Point, s: number, color: Rgb): () => void {
  p.add(shape(`M${n(x - 1.8 * s)},${n(ground - 3.6 * s)} Q${n(x - 2.4 * s)},${n(ground)} ${n(x)},${n(ground)} L${n(x + 1.9 * s)},${n(ground)} Q${n(x + 2.3 * s)},${n(ground - 0.8 * s)} ${n(x + 1.6 * s)},${n(ground - 1.4 * s)} L${n(x - 1.0 * s)},${n(ground - 3.8 * s)} Z`, color))
  p.add(shape(`M${n(x - 1.4 * s)},${n(ground - 3.3 * s)} Q${n(x - 1.8 * s)},${n(ground - 0.4 * s)} ${n(x)},${n(ground - 0.4 * s)} L${n(x + 1.5 * s)},${n(ground - 0.5 * s)} L${n(x - 0.8 * s)},${n(ground - 3.4 * s)} Z`, [226, 232, 240]))
  return () => {
    p.add(shape(`M${n(x - 1.9 * s)},${n(ground - 1.2 * s)} Q${n(x - 1.6 * s)},${n(ground)} ${n(x)},${n(ground)} L${n(x + 1.9 * s)},${n(ground)} Q${n(x + 2.2 * s)},${n(ground - 0.9 * s)} ${n(x + 1.4 * s)},${n(ground - 1.2 * s)} Z`, darker(color, 15)))
    p.add(stroke(`M${n(x - 1.7 * s)},${n(ground - 1.4 * s)} Q${n(x)},${n(ground - 5.6 * s)} ${n(x + 1.7 * s)},${n(ground - 1.4 * s)}`, [55, 65, 81], 0.3 * s))
  }
}

/** A pushchair facing right: frame and canopy (before the child at `seat`), then `front()`. */
export function pushchair(p: Painting, x: number, ground: number, s: number, color: Rgb): { seat: Point; front: () => void } {
  const frame: Rgb = [71, 85, 105]
  const seat: Point = [x, ground - 2.0 * s]
  p.add(line([[x - 1.2 * s, ground - 0.7 * s], [x - 2.0 * s, ground - 5.0 * s], [x - 2.7 * s, ground - 5.1 * s]], frame, 0.2 * s, 1, 'round'))
  p.add(shape(`M${n(x - 1.9 * s)},${n(ground - 2.2 * s)} Q${n(x - 2.1 * s)},${n(ground - 5.4 * s)} ${n(x + 0.6 * s)},${n(ground - 5.0 * s)} L${n(x + 0.8 * s)},${n(ground - 4.2 * s)} Q${n(x - 1.0 * s)},${n(ground - 4.5 * s)} ${n(x - 1.0 * s)},${n(ground - 2.2 * s)} Z`, color))
  p.add(rect(x - 1.5 * s, ground - 4.4 * s, x + 0.2 * s, ground - 1.8 * s, darker(color, 25), 1, 0.4 * s))
  return {
    seat,
    front: () => {
      p.add(rect(x - 1.7 * s, ground - 2.1 * s, x + 1.4 * s, ground - 1.5 * s, color, 1, 0.3 * s))
      p.add(line([[x + 1.2 * s, ground - 1.7 * s], [x + 1.6 * s, ground - 0.7 * s]], frame, 0.2 * s, 1, 'round'))
      p.add(line([[x - 1.2 * s, ground - 1.7 * s], [x - 1.4 * s, ground - 0.7 * s]], frame, 0.2 * s, 1, 'round'))
      p.add(line([[x + 0.9 * s, ground - 3.0 * s], [x + 1.5 * s, ground - 3.1 * s]], frame, 0.18 * s, 1, 'round'))
      for (const dx of [-1.5, 1.6]) {
        p.add(circle([x + dx * s, ground - 0.55 * s], 0.55 * s, [40, 40, 48]))
        p.add(circle([x + dx * s, ground - 0.55 * s], 0.22 * s, [148, 163, 184]))
      }
    },
  }
}

/** A baby bouncer: frame and seat behind a swaddled or lying baby centred at (x, y). */
export function bouncer(p: Painting, [x, y]: Point, s: number, color: Rgb, ground: number): void {
  p.add(stroke(`M${n(x - 2.4 * s)},${n(ground)} Q${n(x - 0.5 * s)},${n(ground - 0.9 * s)} ${n(x + 2.0 * s)},${n(ground - 0.2 * s)}`, [148, 163, 184], 0.18 * s))
  p.add(oval([x - 0.2 * s, y + 0.2 * s], 1.6 * s, 2.5 * s, color, 1, -35))
  p.add(oval([x - 0.2 * s, y + 0.2 * s], 1.35 * s, 2.25 * s, lighter(color, 35), 1, -35))
}

export function salonChair(p: Painting, [x, seat]: Point, s: number, floor: number): void {
  p.add(oval([x, floor - 0.1 * s], 1.4 * s, 0.3 * s, [148, 163, 184]))
  p.add(rect(x - 0.2 * s, seat + 0.4 * s, x + 0.2 * s, floor - 0.1 * s, [203, 213, 225]))
  p.add(rect(x - 1.5 * s, seat - 0.1 * s, x + 1.5 * s, seat + 0.6 * s, [30, 41, 59], 1, 0.3 * s))
}

export function scissors(p: Painting, [x, y]: Point, s: number, angle: number): void {
  rotated(p, [x, y], angle, () => {
    p.add(polygon([[x, y - 0.06 * s], [x + 1.1 * s, y - 0.2 * s], [x + 1.1 * s, y - 0.12 * s], [x, y + 0.06 * s]], STEEL))
    p.add(polygon([[x, y - 0.06 * s], [x + 1.1 * s, y + 0.12 * s], [x + 1.1 * s, y + 0.2 * s], [x, y + 0.06 * s]], darker(STEEL, 25)))
    for (const dy of [-0.25, 0.25]) p.add(ring([x - 0.32 * s, y + dy * s], 0.2 * s, [239, 68, 68], 0.09 * s))
    p.add(circle([x, y], 0.06 * s, INK))
  })
}

export function hairBits(p: Painting, random: Random, [x, y]: Point, width: number, s: number, color: Rgb): void {
  for (let index = 0; index < 16; index += 1) {
    const [bx, by] = [x + random.uniform(-0.5, 0.5) * width, y + random.uniform(-0.3, 0.3) * s]
    p.add(stroke(`M${n(bx)},${n(by)} q${n(0.15 * s)},${n(-0.12 * s)} ${n(0.3 * s)},${n(random.uniform(-0.05, 0.08) * s)}`, color, 0.06 * s))
  }
}

export function christmasTree(p: Painting, x: number, ground: number, s: number, random: Random): void {
  p.add(rect(x - 0.55 * s, ground - 1.0 * s, x + 0.55 * s, ground, [185, 28, 28], 1, 0.12 * s))
  p.add(rect(x - 0.2 * s, ground - 1.4 * s, x + 0.2 * s, ground - 0.9 * s, [110, 70, 50]))
  const green: Rgb = [46, 125, 79]
  for (let tier = 0; tier < 4; tier += 1) {
    const half = (2.3 - tier * 0.5) * s
    const bottom = ground - 1.2 * s - tier * 1.25 * s
    p.add(polygon([[x - half, bottom], [x + half, bottom], [x, bottom - 2.1 * s]], lighter(green, tier * 8)))
  }
  const top = ground - 1.2 * s - 3 * 1.25 * s - 2.1 * s
  for (let row = 0; row < 3; row += 1) {
    const y0 = ground - (2.3 + row * 1.5) * s
    p.add(stroke(`M${n(x - (1.8 - row * 0.45) * s)},${n(y0)} Q${n(x)},${n(y0 + 0.6 * s)} ${n(x + (1.8 - row * 0.45) * s)},${n(y0 - 0.3 * s)}`, [250, 204, 21], 0.1 * s, 0.9))
  }
  const baubles: readonly Rgb[] = [[239, 68, 68], [250, 204, 21], [96, 165, 250], WHITE, [244, 114, 182]]
  for (let index = 0; index < 16; index += 1) {
    const level = random.uniform(0.04, 0.9)
    const y = ground - 1.3 * s - level * 5.6 * s
    const half = 2.1 * s * (1 - level * 0.85)
    const bx = x + random.uniform(-0.85, 0.85) * half
    const color = random.choice(baubles)
    p.glow([bx, y], 0.45 * s, color, 0.35)
    p.add(circle([bx, y], 0.17 * s, color))
  }
  p.glow([x, top], 1.4 * s, [255, 225, 140], 0.7)
  star(p, [x, top], 0.55 * s, [253, 224, 71])
}

/** A big cardboard box: back and inside (before the child), then `front()`. */
export function bigBox(p: Painting, x: number, ground: number, width: number, height: number): () => void {
  const top = ground - height
  p.add(polygon([[x - width / 2, top], [x - width * 0.62, top - height * 0.38], [x - width * 0.1, top - height * 0.3], [x - width * 0.05, top]], darker(CARDBOARD, 18)))
  p.add(polygon([[x + width / 2, top], [x + width * 0.66, top - height * 0.3], [x + width * 0.12, top - height * 0.34], [x + width * 0.05, top]], darker(CARDBOARD, 10)))
  p.add(rect(x - width / 2, top - height * 0.05, x + width / 2, ground, darker(CARDBOARD, 45)))
  return () => {
    p.add(rect(x - width / 2, top, x + width / 2, ground, CARDBOARD))
    p.add(rect(x - width * 0.08, top, x + width * 0.08, top + height * 0.35, [232, 205, 160], 0.9))
    p.add(text([x, top + height * 0.62], 'THIS WAY UP', height * 0.1, darker(CARDBOARD, 70)))
    for (const side of [-1, 1]) {
      const ax = x + side * width * 0.32
      p.add(line([[ax, top + height * 0.9], [ax, top + height * 0.7]], darker(CARDBOARD, 70), height * 0.03))
      p.add(polygon([[ax - height * 0.05, top + height * 0.72], [ax + height * 0.05, top + height * 0.72], [ax, top + height * 0.64]], darker(CARDBOARD, 70)))
    }
    p.add(polygon([[x - width / 2, top], [x + width / 2, top], [x + width * 0.46, top + height * 0.12], [x - width * 0.46, top + height * 0.12]], darker(CARDBOARD, 12)))
  }
}

/** Coat pegs on a board with name labels; `highlight` is the child's own peg. */
export function pegs(p: Painting, left: number, right: number, y: number, s: number, names: readonly string[], highlight: number, coats: readonly (Rgb | null)[] = []): Point[] {
  p.add(rect(left, y - 0.45 * s, right, y + 0.45 * s, WOOD, 1, 0.12 * s))
  const step = (right - left) / names.length
  return names.map((name, index) => {
    const px = left + (index + 0.5) * step
    const coat = coats[index]
    if (coat) {
      p.add(trapezoid(px, y + 0.1 * s, y + 2.7 * s, 1.1 * s, 1.7 * s, 0.25 * s, coat))
      p.add(oval([px, y + 0.25 * s], 0.5 * s, 0.32 * s, darker(coat, 25)))
    }
    p.add(circle([px, y], 0.16 * s, [148, 163, 184]))
    const card: Rgb = index === highlight ? [253, 224, 71] : WHITE
    const [cy, half] = [y - 1.15 * s, Math.max(0.65 * s, name.length * 0.17 * s)]
    p.add(rect(px - half, cy - 0.38 * s, px + half, cy + 0.38 * s, card, 1, 0.1 * s))
    p.add(text([px, cy + 0.13 * s], name, 0.36 * s, INK))
    return [px, cy] as const
  })
}
// Outdoors, rides and animals ------------------------------------------------------------------

export function fence(p: Painting, left: number, right: number, ground: number, height: number, color: Rgb = WOOD): void {
  for (const level of [0.72, 0.32]) p.add(rect(left, ground - height * level - height * 0.07, right, ground - height * level + height * 0.07, darker(color, 10)))
  const step = height * 0.9
  for (let x = left + step / 2; x < right; x += step) {
    p.add(polygon([[x - height * 0.09, ground], [x - height * 0.09, ground - height * 0.92], [x, ground - height], [x + height * 0.09, ground - height * 0.92], [x + height * 0.09, ground]], color))
  }
}

export function giraffe(p: Painting, x: number, ground: number, s: number, mirror = false): void {
  const fur: Rgb = [244, 188, 92]
  const patch: Rgb = [190, 116, 52]
  p.mirrored(x, mirror, () => {
    for (const dx of [-1.4, -0.9, 0.9, 1.4]) p.add(rect(x + dx * s - 0.17 * s, ground - 4.6 * s, x + dx * s + 0.17 * s, ground, dx < 0 && dx > -1 ? darker(fur, 15) : fur, 1, 0.1 * s))
    p.add(oval([x, ground - 4.8 * s], 2.0 * s, 1.05 * s, fur))
    p.add(polygon([[x + 0.9 * s, ground - 5.3 * s], [x + 1.7 * s, ground - 5.0 * s], [x + 2.75 * s, ground - 8.9 * s], [x + 2.15 * s, ground - 9.1 * s]], fur))
    p.add(oval([x + 2.7 * s, ground - 9.3 * s], 0.85 * s, 0.48 * s, fur, 1, 20))
    for (const dx of [2.35, 2.75]) {
      p.add(line([[x + dx * s, ground - 9.6 * s], [x + (dx - 0.1) * s, ground - 10.25 * s]], fur, 0.12 * s))
      p.add(circle([x + (dx - 0.1) * s, ground - 10.3 * s], 0.13 * s, patch))
    }
    p.add(oval([x + 2.0 * s, ground - 9.55 * s], 0.3 * s, 0.12 * s, fur, 1, -25))
    p.add(circle([x + 2.8 * s, ground - 9.45 * s], 0.09 * s, INK))
    p.add(oval([x + 3.35 * s, ground - 9.1 * s], 0.25 * s, 0.2 * s, lighter(fur, 25), 1, 20))
    for (const [dx, dy, r] of [[-1.2, -4.9, 0.32], [-0.4, -5.2, 0.36], [0.5, -4.7, 0.3], [-0.6, -4.4, 0.22], [1.3, -5.1, 0.26], [0.2, -5.45, 0.2], [1.75, -6.1, 0.24], [2.05, -7.0, 0.22], [2.3, -7.9, 0.2], [2.5, -8.6, 0.16]]) {
      p.add(oval([x + dx * s, ground + dy * s], r * s, r * 0.85 * s, patch, 1, 15))
    }
    p.add(line([[x - 1.95 * s, ground - 4.9 * s], [x - 2.5 * s, ground - 3.9 * s]], fur, 0.12 * s, 1, 'round'))
    p.add(circle([x - 2.5 * s, ground - 3.8 * s], 0.14 * s, patch))
  })
}

export function penguin(p: Painting, [x, ground]: Point, s: number, mirror = false): void {
  p.mirrored(x, mirror, () => {
    shadow(p, [x, ground], 0.7 * s, 0.1 * s, 0.2)
    for (const side of [-1, 1]) p.add(oval([x + side * 0.25 * s, ground - 0.05 * s], 0.22 * s, 0.09 * s, [249, 115, 22]))
    p.add(oval([x, ground - 1.0 * s], 0.62 * s, 1.0 * s, [30, 41, 59]))
    p.add(oval([x + 0.12 * s, ground - 0.85 * s], 0.42 * s, 0.75 * s, WHITE))
    p.add(oval([x - 0.55 * s, ground - 0.95 * s], 0.15 * s, 0.5 * s, [30, 41, 59], 1, 20))
    p.add(circle([x + 0.22 * s, ground - 1.6 * s], 0.09 * s, WHITE))
    p.add(circle([x + 0.24 * s, ground - 1.6 * s], 0.05 * s, INK))
    p.add(polygon([[x + 0.42 * s, ground - 1.5 * s], [x + 0.75 * s, ground - 1.42 * s], [x + 0.42 * s, ground - 1.35 * s]], [249, 115, 22]))
  })
}

/** A playground swing: frame, ropes and seat back; `front()` closes the bucket seat. */
export function swing(p: Painting, x: number, ground: number, seat: number, s: number, color: Rgb): () => void {
  const frame: Rgb = [37, 99, 235]
  const top = seat - 6.5 * s
  for (const side of [-1, 1]) {
    p.add(line([[x + side * 3.4 * s, top], [x + side * 4.6 * s, ground]], frame, 0.32 * s, 1, 'round'))
    p.add(line([[x + side * 3.4 * s, top], [x + side * 2.3 * s, ground]], darker(frame, 25), 0.28 * s, 1, 'round'))
  }
  p.add(line([[x - 3.8 * s, top], [x + 3.8 * s, top]], frame, 0.38 * s, 1, 'round'))
  for (const side of [-1, 1]) p.add(line([[x + side * 1.15 * s, top], [x + side * 1.2 * s, seat - 0.4 * s]], [120, 113, 108], 0.09 * s))
  p.add(rect(x - 1.3 * s, seat - 1.8 * s, x + 1.3 * s, seat + 0.2 * s, darker(color, 25), 1, 0.4 * s))
  return () => {
    p.add(shape(`M${n(x - 1.4 * s)},${n(seat - 0.45 * s)} L${n(x + 1.4 * s)},${n(seat - 0.45 * s)} L${n(x + 1.2 * s)},${n(seat + 0.55 * s)} Q${n(x)},${n(seat + 0.9 * s)} ${n(x - 1.2 * s)},${n(seat + 0.55 * s)} Z`, color))
    p.add(oval([x, seat - 0.45 * s], 1.4 * s, 0.16 * s, lighter(color, 30)))
  }
}

function wheel(p: Painting, center: Point, r: number): void {
  p.add(circle(center, r, [40, 40, 48]))
  p.add(circle(center, r * 0.62, [226, 232, 240]))
  p.add(circle(center, r * 0.18, [148, 163, 184]))
}

/** A tricycle facing right; the child perches on `seat` and holds `bar`; `front()` adds the front wheel. */
export function trike(p: Painting, x: number, ground: number, s: number, color: Rgb): { seat: Point; bar: Point; front: () => void } {
  wheel(p, [x - 1.6 * s, ground - 0.6 * s], 0.6 * s)
  p.add(line([[x - 1.6 * s, ground - 0.6 * s], [x - 0.2 * s, ground - 1.6 * s], [x + 1.5 * s, ground - 1.0 * s]], color, 0.32 * s, 1, 'round'))
  p.add(line([[x + 1.5 * s, ground - 1.0 * s], [x + 1.15 * s, ground - 3.3 * s]], darker(color, 20), 0.26 * s, 1, 'round'))
  const bar: Point = [x + 1.3 * s, ground - 3.4 * s]
  p.add(line([[x + 0.8 * s, ground - 3.4 * s], [x + 1.6 * s, ground - 3.45 * s]], [55, 65, 81], 0.2 * s, 1, 'round'))
  p.add(oval([x - 0.25 * s, ground - 1.85 * s], 0.75 * s, 0.25 * s, [55, 65, 81]))
  return {
    seat: [x - 0.25 * s, ground - 2.0 * s],
    bar,
    front: () => {
      wheel(p, [x - 1.0 * s, ground - 0.6 * s], 0.6 * s)
      wheel(p, [x + 1.5 * s, ground - 1.0 * s], 1.0 * s)
      p.add(line([[x + 1.5 * s, ground - 1.0 * s], [x + 1.85 * s, ground - 0.7 * s]], [55, 65, 81], 0.14 * s, 1, 'round'))
    },
  }
}

export function balanceBike(p: Painting, x: number, ground: number, s: number, color: Rgb): { seat: Point; bar: Point; front: () => void } {
  wheel(p, [x - 1.7 * s, ground - 0.8 * s], 0.8 * s)
  p.add(line([[x - 1.7 * s, ground - 0.8 * s], [x - 0.4 * s, ground - 1.9 * s], [x + 1.4 * s, ground - 1.7 * s]], color, 0.3 * s, 1, 'round'))
  p.add(line([[x + 1.7 * s, ground - 0.8 * s], [x + 1.3 * s, ground - 3.1 * s]], darker(color, 20), 0.24 * s, 1, 'round'))
  p.add(line([[x + 0.9 * s, ground - 3.15 * s], [x + 1.7 * s, ground - 3.2 * s]], [55, 65, 81], 0.2 * s, 1, 'round'))
  p.add(oval([x - 0.5 * s, ground - 2.05 * s], 0.75 * s, 0.22 * s, [55, 65, 81]))
  return {
    seat: [x - 0.5 * s, ground - 2.15 * s],
    bar: [x + 1.4 * s, ground - 3.15 * s],
    front: () => wheel(p, [x + 1.7 * s, ground - 0.8 * s], 0.8 * s),
  }
}

/** A nursery book bag hanging from `hand`. */
export function bookBag(p: Painting, [x, y]: Point, s: number, color: Rgb): void {
  p.add(stroke(`M${n(x - 0.3 * s)},${n(y + 0.3 * s)} Q${n(x)},${n(y - 0.25 * s)} ${n(x + 0.3 * s)},${n(y + 0.3 * s)}`, darker(color, 30), 0.1 * s))
  p.add(rect(x - 0.65 * s, y + 0.25 * s, x + 0.65 * s, y + 1.35 * s, color, 1, 0.12 * s))
  p.add(rect(x - 0.65 * s, y + 0.25 * s, x + 0.65 * s, y + 0.55 * s, darker(color, 18), 1, 0.12 * s))
  p.add(rect(x - 0.25 * s, y + 0.75 * s, x + 0.25 * s, y + 1.12 * s, WHITE, 0.9, 0.05 * s))
  star(p, [x, y + 0.94 * s], 0.13 * s, color)
}

/** School railings with an open gate between two brick pillars and a sign over the gate. */
export function schoolGate(p: Painting, left: number, right: number, ground: number, height: number, sign: string, signY = ground - height * 1.75): void {
  const rail: Rgb = [30, 58, 95]
  for (let x = left; x <= right; x += height * 0.16) {
    p.add(line([[x, ground], [x, ground - height]], rail, height * 0.035))
    p.add(polygon([[x - height * 0.035, ground - height], [x + height * 0.035, ground - height], [x, ground - height * 1.07]], rail))
  }
  for (const level of [0.15, 0.85]) p.add(line([[left, ground - height * level], [right, ground - height * level]], rail, height * 0.04))
  const middle = (left + right) / 2
  for (const side of [-1, 1]) {
    const px = middle + side * height * 0.95
    p.add(rect(px - height * 0.17, ground - height * 1.45, px + height * 0.17, ground, [176, 98, 78]))
    p.add(rect(px - height * 0.21, ground - height * 1.52, px + height * 0.21, ground - height * 1.4, [148, 80, 64]))
  }
  p.add(rect(middle - height * 0.78, ground - height * 1.05, middle + height * 0.78, ground + height * 0.01, [214, 196, 160], 0.55))
  p.add(rect(middle - height * 0.75, signY - height * 0.2, middle + height * 0.75, signY + height * 0.2, WHITE, 1, height * 0.05))
  p.add(text([middle, signY + height * 0.07], sign, height * 0.2, [30, 58, 95]))
}

export function butterfly(p: Painting, [x, y]: Point, s: number, color: Rgb, angle: number): void {
  rotated(p, [x, y], angle, () => {
    for (const side of [-1, 1]) {
      p.add(oval([x + side * 0.55 * s, y - 0.35 * s], 0.55 * s, 0.45 * s, color, 1, side * 20))
      p.add(oval([x + side * 0.45 * s, y + 0.35 * s], 0.38 * s, 0.32 * s, lighter(color, 40), 1, side * -20))
      p.add(circle([x + side * 0.55 * s, y - 0.38 * s], 0.15 * s, WHITE, 0.7))
    }
    p.add(oval([x, y], 0.1 * s, 0.6 * s, INK))
    for (const side of [-1, 1]) p.add(stroke(`M${n(x)},${n(y - 0.55 * s)} q${n(side * 0.1 * s)},${n(-0.3 * s)} ${n(side * 0.3 * s)},${n(-0.4 * s)}`, INK, 0.05 * s))
  })
}

export function puddle(p: Painting, [x, y]: Point, width: number, splash: boolean): void {
  p.add(oval([x, y], width / 2, width * 0.12, [96, 165, 250], 0.75))
  p.add(oval([x - width * 0.08, y - width * 0.02], width * 0.3, width * 0.06, [191, 219, 254], 0.7))
  if (splash) {
    for (const [dx, dy, r] of [[-0.42, -0.25, 0.035], [-0.3, -0.42, 0.03], [0.35, -0.38, 0.032], [0.45, -0.2, 0.028], [-0.12, -0.5, 0.025], [0.15, -0.55, 0.027]]) {
      p.add(oval([x + dx * width, y + dy * width], r * width, r * width * 1.4, [147, 197, 253]))
    }
  }
}

export function rockPool(p: Painting, [x, y]: Point, width: number): void {
  p.add(oval([x, y], width / 2, width * 0.16, [45, 160, 170]))
  p.add(oval([x - width * 0.05, y - width * 0.02], width * 0.38, width * 0.1, [94, 200, 205]))
  for (const [dx, dy, rx, ry] of [[-0.48, -0.02, 0.13, 0.09], [-0.36, 0.1, 0.12, 0.07], [0.46, 0.0, 0.14, 0.1], [0.32, 0.12, 0.1, 0.06], [0.1, -0.14, 0.11, 0.06], [-0.18, -0.15, 0.09, 0.05]]) {
    p.add(oval([x + dx * width, y + dy * width], rx * width, ry * width, [148, 140, 132]))
    p.add(oval([x + dx * width - rx * width * 0.2, y + dy * width - ry * width * 0.3], rx * width * 0.5, ry * width * 0.4, [176, 168, 160]))
  }
  star(p, [x + width * 0.12, y + width * 0.04], width * 0.05, [249, 115, 22], 0.3)
  const [cx, cy] = [x - width * 0.15, y + width * 0.02]
  for (const side of [-1, 1]) {
    p.add(line([[cx + side * width * 0.04, cy], [cx + side * width * 0.08, cy - width * 0.04]], [220, 38, 38], width * 0.012))
    p.add(circle([cx + side * width * 0.085, cy - width * 0.05], width * 0.018, [220, 38, 38]))
  }
  p.add(oval([cx, cy], width * 0.05, width * 0.03, [239, 68, 68]))
  for (const side of [-1, 1]) p.add(circle([cx + side * width * 0.015, cy - width * 0.03], width * 0.007, INK))
}

export function sandcastle(p: Painting, [x, ground]: Point, s: number): void {
  const sand: Rgb = [232, 196, 138]
  const dark = darker(sand, 30)
  p.add(rect(x - 1.5 * s, ground - 1.2 * s, x + 1.5 * s, ground, sand, 1, 0.1 * s))
  for (const dx of [-1.1, 1.1]) {
    p.add(rect(x + dx * s - 0.45 * s, ground - 2.3 * s, x + dx * s + 0.45 * s, ground - 0.9 * s, sand))
    for (const k of [-1, 0, 1]) p.add(rect(x + dx * s + k * 0.3 * s - 0.1 * s, ground - 2.55 * s, x + dx * s + k * 0.3 * s + 0.1 * s, ground - 2.25 * s, sand))
  }
  p.add(rect(x - 0.5 * s, ground - 2.9 * s, x + 0.5 * s, ground - 1.0 * s, lighter(sand, 10)))
  p.add(line([[x, ground - 2.9 * s], [x, ground - 3.9 * s]], [120, 113, 108], 0.06 * s))
  p.add(polygon([[x, ground - 3.9 * s], [x + 0.6 * s, ground - 3.7 * s], [x, ground - 3.5 * s]], [239, 68, 68]))
  p.add(shape(`M${n(x - 0.25 * s)},${n(ground)} L${n(x - 0.25 * s)},${n(ground - 0.55 * s)} A${n(0.25 * s)},${n(0.25 * s)} 0 0,1 ${n(x + 0.25 * s)},${n(ground - 0.55 * s)} L${n(x + 0.25 * s)},${n(ground)} Z`, dark))
  for (const dx of [-1.1, 1.1]) p.add(rect(x + dx * s - 0.12 * s, ground - 1.9 * s, x + dx * s + 0.12 * s, ground - 1.55 * s, dark, 1, 0.1 * s))
}

export function bucket(p: Painting, [x, ground]: Point, s: number, color: Rgb, upsideDown = false): void {
  if (upsideDown) p.add(trapezoid(x, ground - 1.0 * s, ground, 0.85 * s, 1.15 * s, 0.1 * s, color))
  else {
    p.add(stroke(`M${n(x - 0.55 * s)},${n(ground - 1.0 * s)} Q${n(x)},${n(ground - 1.9 * s)} ${n(x + 0.55 * s)},${n(ground - 1.0 * s)}`, darker(color, 30), 0.07 * s))
    p.add(trapezoid(x, ground - 1.0 * s, ground, 1.15 * s, 0.85 * s, 0.1 * s, color))
    p.add(oval([x, ground - 1.0 * s], 0.58 * s, 0.12 * s, darker(color, 30)))
  }
}

/** A spade held at `hand`, its blade at `blade`. */
export function spade(p: Painting, hand: Point, blade: Point, s: number, color: Rgb): void {
  p.add(line([hand, blade], color, 0.12 * s, 1, 'round'))
  const [bx, by] = blade
  p.add(shape(`M${n(bx - 0.32 * s)},${n(by - 0.1 * s)} L${n(bx + 0.32 * s)},${n(by - 0.1 * s)} L${n(bx + 0.25 * s)},${n(by + 0.4 * s)} Q${n(bx)},${n(by + 0.6 * s)} ${n(bx - 0.25 * s)},${n(by + 0.4 * s)} Z`, color))
}

export function wateringCan(p: Painting, [x, y]: Point, s: number, color: Rgb, pouring: boolean): void {
  p.add(ring([x, y + 0.2 * s], 0.32 * s, darker(color, 20), 0.12 * s))
  p.add(rect(x - 0.6 * s, y + 0.3 * s, x + 0.6 * s, y + 1.4 * s, color, 1, 0.2 * s))
  p.add(line([[x + 0.5 * s, y + 1.1 * s], [x + 1.5 * s, y + 0.4 * s]], color, 0.16 * s, 1, 'round'))
  p.add(oval([x + 1.58 * s, y + 0.35 * s], 0.16 * s, 0.22 * s, darker(color, 20), 1, 35))
  if (pouring) for (const [dx, dy] of [[1.75, 0.7], [1.95, 1.05], [1.7, 1.25], [2.05, 1.5], [1.85, 1.8]]) p.add(oval([x + dx * s, y + dy * s], 0.05 * s, 0.1 * s, [96, 165, 250]))
}

/** A vegetable bed: dark soil from `left` to `right` around `y`, with rows of seedlings. */
export function vegPatch(p: Painting, left: number, right: number, y: number, s: number, random: Random): void {
  p.add(rect(left, y - 0.9 * s, right, y + 0.9 * s, [133, 94, 66], 1, 0.6 * s))
  p.add(rect(left + 0.2 * s, y - 0.75 * s, right - 0.2 * s, y + 0.75 * s, [101, 67, 33], 1, 0.5 * s))
  for (const row of [-0.35, 0.35]) {
    for (let x = left + 0.7 * s; x < right - 0.5 * s; x += 0.9 * s) {
      const [sx, sy] = [x + random.uniform(-0.1, 0.1) * s, y + row * s]
      if (row < 0) {
        for (const angle of [-35, 0, 35]) p.add(oval([sx + Math.sin((angle * Math.PI) / 180) * 0.2 * s, sy - 0.22 * s], 0.06 * s, 0.22 * s, [74, 163, 60], 1, angle))
      } else {
        p.add(oval([sx - 0.1 * s, sy - 0.12 * s], 0.18 * s, 0.1 * s, [101, 163, 13], 1, -30))
        p.add(oval([sx + 0.1 * s, sy - 0.12 * s], 0.18 * s, 0.1 * s, [132, 204, 22], 1, 30))
      }
    }
  }
}

export function carrotSeedling(p: Painting, [x, y]: Point, s: number): void {
  p.add(polygon([[x - 0.12 * s, y], [x + 0.12 * s, y], [x, y + 0.7 * s]], [249, 115, 22]))
  for (const angle of [-30, 0, 30]) p.add(oval([x + Math.sin((angle * Math.PI) / 180) * 0.2 * s, y - 0.25 * s], 0.06 * s, 0.25 * s, [74, 163, 60], 1, angle))
}

const LEAF_COLORS: readonly Rgb[] = [[234, 88, 12], [220, 38, 38], [234, 179, 8], [180, 83, 9], [249, 115, 22]]

export function leaf(p: Painting, [x, y]: Point, s: number, color: Rgb, angle: number): void {
  rotated(p, [x, y], angle, () => {
    p.add(shape(`M${n(x - s)},${n(y)} Q${n(x)},${n(y - 0.6 * s)} ${n(x + s)},${n(y)} Q${n(x)},${n(y + 0.6 * s)} ${n(x - s)},${n(y)} Z`, color))
    p.add(line([[x - s * 1.2, y], [x + s * 0.8, y]], darker(color, 40), s * 0.08))
  })
}

/** Leaves scattered over a box (left, top, right, bottom). */
export function leaves(p: Painting, random: Random, [left, top, right, bottom]: readonly [number, number, number, number], count: number, s: number): void {
  for (let index = 0; index < count; index += 1) {
    leaf(p, [random.uniform(left, right), random.uniform(top, bottom)], s * random.uniform(0.7, 1.2), random.choice(LEAF_COLORS), random.uniform(0, 360))
  }
}

export function medal(p: Painting, [x, y]: Point, s: number, label: string): void {
  p.add(polygon([[x - 0.45 * s, y], [x - 0.15 * s, y], [x + 0.05 * s, y + 1.1 * s], [x - 0.2 * s, y + 1.1 * s]], [59, 130, 246]))
  p.add(polygon([[x + 0.45 * s, y], [x + 0.15 * s, y], [x - 0.05 * s, y + 1.1 * s], [x + 0.2 * s, y + 1.1 * s]], [239, 68, 68]))
  p.add(circle([x, y + 1.4 * s], 0.45 * s, [203, 213, 225]))
  p.add(circle([x, y + 1.4 * s], 0.34 * s, [226, 232, 240]))
  p.add(text([x, y + 1.55 * s], label, 0.38 * s, [100, 116, 139]))
}

/** Egg and spoon held at `hand`, the egg ahead of it. */
export function eggAndSpoon(p: Painting, [x, y]: Point, s: number, direction: -1 | 1): void {
  const tip: Point = [x + direction * 1.1 * s, y - 0.1 * s]
  p.add(line([[x, y], tip], STEEL, 0.1 * s, 1, 'round'))
  p.add(oval(tip, 0.28 * s, 0.14 * s, lighter(STEEL, 15)))
  p.add(oval([tip[0], tip[1] - 0.26 * s], 0.22 * s, 0.28 * s, [255, 250, 240]))
}

export function finishTape(p: Painting, x: number, ground: number, s: number): void {
  for (const side of [-1, 1]) p.add(line([[x + side * 2.5 * s, ground], [x + side * 2.5 * s, ground - 5.0 * s]], WHITE, 0.2 * s))
  p.add(stroke(`M${n(x - 2.5 * s)},${n(ground - 3.0 * s)} Q${n(x)},${n(ground - 2.6 * s)} ${n(x + 2.5 * s)},${n(ground - 3.0 * s)}`, [239, 68, 68], 0.14 * s))
}

// Seasonal ------------------------------------------------------------------------------------

export function jackOLantern(p: Painting, [x, ground]: Point, s: number): void {
  p.glow([x, ground - 0.6 * s], 1.6 * s, [251, 146, 60], 0.35)
  for (const [dx, rx] of [[-0.45, 0.55], [0.45, 0.55], [0, 0.6]]) p.add(oval([x + dx * s, ground - 0.62 * s], rx * s, 0.62 * s, dx === 0 ? [249, 115, 22] : [234, 88, 12]))
  p.add(rect(x - 0.08 * s, ground - 1.45 * s, x + 0.08 * s, ground - 1.15 * s, [77, 124, 15], 1, 0.04 * s))
  const glow: Rgb = [254, 240, 138]
  for (const side of [-1, 1]) p.add(polygon([[x + side * 0.42 * s, ground - 0.95 * s], [x + side * 0.2 * s, ground - 0.62 * s], [x + side * 0.62 * s, ground - 0.62 * s]], glow))
  p.add(polygon([[x - 0.5 * s, ground - 0.42 * s], [x - 0.25 * s, ground - 0.25 * s], [x, ground - 0.4 * s], [x + 0.25 * s, ground - 0.25 * s], [x + 0.5 * s, ground - 0.42 * s], [x + 0.3 * s, ground - 0.15 * s], [x - 0.3 * s, ground - 0.15 * s]], glow))
}

/** A pumpkin bucket hanging from `hand`. */
export function pumpkinBucket(p: Painting, [x, y]: Point, s: number): void {
  p.add(stroke(`M${n(x - 0.55 * s)},${n(y + 0.55 * s)} Q${n(x)},${n(y - 0.25 * s)} ${n(x + 0.55 * s)},${n(y + 0.55 * s)}`, INK, 0.07 * s))
  for (const [dx, color] of [[0.08, [250, 204, 21]], [-0.15, [239, 68, 68]], [0.3, [168, 85, 247]]] as const) p.add(rect(x + dx * s - 0.12 * s, y + 0.3 * s, x + dx * s + 0.12 * s, y + 0.55 * s, color, 1, 0.05 * s))
  jackOLantern(p, [x, y + 1.75 * s], 0.85 * s)
}

export function broom(p: Painting, hand: Point, s: number): void {
  const [x, y] = hand
  p.add(line([[x - 0.9 * s, y - 1.1 * s], [x + 0.9 * s, y + 2.1 * s]], [120, 82, 60], 0.14 * s, 1, 'round'))
  p.add(polygon([[x + 0.65 * s, y + 1.65 * s], [x + 1.05 * s, y + 1.55 * s], [x + 1.6 * s, y + 2.9 * s], [x + 0.6 * s, y + 3.1 * s]], [214, 170, 80]))
  p.add(line([[x + 0.6 * s, y + 1.8 * s], [x + 1.08 * s, y + 1.7 * s]], [146, 64, 14], 0.12 * s))
}

/** Plate with a mince pie and a carrot for the reindeer, and a glass of milk. */
export function treats(p: Painting, [x, y]: Point, s: number): void {
  p.add(rect(x + 0.9 * s, y - 1.0 * s, x + 1.35 * s, y, [241, 245, 249], 0.95, 0.06 * s))
  p.add(rect(x + 0.93 * s, y - 0.75 * s, x + 1.32 * s, y - 0.03 * s, WHITE))
  plate(p, [x, y], 0.85 * s)
  p.add(circle([x - 0.25 * s, y - 0.1 * s], 0.3 * s, [205, 140, 80]))
  star(p, [x - 0.25 * s, y - 0.12 * s], 0.15 * s, [255, 247, 235])
  p.add(polygon([[x + 0.05 * s, y - 0.05 * s], [x + 0.55 * s, y - 0.18 * s], [x + 0.08 * s, y + 0.1 * s]], [249, 115, 22]))
  p.add(oval([x + 0.02 * s, y - 0.02 * s], 0.1 * s, 0.06 * s, [74, 163, 60]))
}

export function pancakes(p: Painting, [x, y]: Point, s: number): void {
  plate(p, [x, y], s)
  for (let level = 0; level < 3; level += 1) p.add(oval([x, y - 0.12 * s - level * 0.16 * s], 0.65 * s, 0.17 * s, level % 2 ? [217, 160, 84] : [234, 179, 98]))
  p.add(oval([x, y - 0.5 * s], 0.5 * s, 0.11 * s, [180, 90, 30], 0.85))
  for (const [dx, dy] of [[-0.2, -0.56], [0.15, -0.6], [0.3, -0.52]]) p.add(circle([x + dx * s, y + dy * s], 0.08 * s, [99, 102, 241]))
}

export function roast(p: Painting, [x, y]: Point, s: number): void {
  p.add(oval([x, y], 1.5 * s, 0.4 * s, [214, 222, 232]))
  p.add(oval([x, y - 0.35 * s], 1.0 * s, 0.6 * s, [180, 100, 50]))
  p.add(oval([x - 0.2 * s, y - 0.5 * s], 0.5 * s, 0.25 * s, [210, 140, 80], 0.7))
  for (const side of [-1, 1]) {
    p.add(line([[x + side * 0.8 * s, y - 0.5 * s], [x + side * 1.3 * s, y - 0.9 * s]], [180, 100, 50], 0.3 * s, 1, 'round'))
    p.add(circle([x + side * 1.35 * s, y - 0.95 * s], 0.12 * s, WHITE))
  }
  for (const dx of [-1.1, 1.0]) p.add(circle([x + dx * s, y - 0.1 * s], 0.13 * s, [74, 163, 60]))
}

export function cracker(p: Painting, [x, y]: Point, s: number, color: Rgb, angle: number): void {
  rotated(p, [x, y], angle, () => {
    p.add(rect(x - 0.7 * s, y - 0.2 * s, x + 0.7 * s, y + 0.2 * s, color, 1, 0.05 * s))
    for (const side of [-1, 1]) p.add(polygon([[x + side * 0.7 * s, y - 0.12 * s], [x + side * 1.1 * s, y - 0.28 * s], [x + side * 1.1 * s, y + 0.28 * s], [x + side * 0.7 * s, y + 0.12 * s]], color))
    p.add(rect(x - 0.3 * s, y - 0.2 * s, x + 0.3 * s, y + 0.2 * s, GOLD, 0.8))
  })
}
