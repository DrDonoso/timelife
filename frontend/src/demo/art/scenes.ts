/**
 * Backdrops of the demo photos: the places of the family's milestones (park, beach, pool, the rooms
 * of the house, hospital, nursery, parties, Christmas…). They fill the whole picture but keep its
 * centre free for the people, whose feet stand on `ground`.
 */
import type { Random } from '../random'
import {
  WHITE,
  bokeh,
  circle,
  curveAt,
  darker,
  lighter,
  line,
  mix,
  n,
  oval,
  pieslice,
  polygon,
  rect,
  shape,
  stroke,
  text,
  tone,
  wave,
  type Painting,
  type Point,
  type Rgb,
} from './paint'
import { WOOD, balloon, bunting, butterfly, christmasTree, heart, jackOLantern, star } from './props'

/** The picture and its centred square (the thumbnail), where the people go. */
export interface Frame {
  width: number
  height: number
  unit: number
  cx: number
  cy: number
  /** x of a fraction of the centred square, from its left edge. */
  X: (fraction: number) => number
  /** y of a fraction of the centred square, from its top edge. */
  Y: (fraction: number) => number
}

export function frameOf(p: Painting): Frame {
  const unit = Math.min(p.width, p.height)
  const left = (p.width - unit) / 2
  const top = (p.height - unit) / 2
  return {
    width: p.width,
    height: p.height,
    unit,
    cx: p.width / 2,
    cy: p.height / 2,
    X: (fraction) => left + fraction * unit,
    Y: (fraction) => top + fraction * unit,
  }
}

export type Backdrop =
  | 'park'
  | 'zoo'
  | 'garden'
  | 'autumn'
  | 'beach'
  | 'sunset'
  | 'pool'
  | 'home'
  | 'playroom'
  | 'hospital'
  | 'bathroom'
  | 'kitchen'
  | 'party'
  | 'halloween'
  | 'bedroom'
  | 'classroom'
  | 'stage'
  | 'christmas'
  | 'blanket'
  | 'cot'
  | 'salon'
  | 'street'

export interface Place {
  /** Where the people stand: the floor or the grass under their feet. */
  ground: number
  /** The side that keeps the window, the tree or the door (-1 left, 1 right). */
  side: -1 | 1
  /** Text of a sign: nursery door, school gate, birthday bunting, classroom name. */
  sign?: string
  /** Blanket or sheet colour of the views from above. */
  color?: Rgb
  /** Christmas tree in the living room (default true). */
  tree?: boolean
  /** Evening light (a street at Halloween, a bedroom). */
  night?: boolean
}

type Painter = (p: Painting, f: Frame, random: Random, hue: number, place: Place) => void

/** Fairy lights and window boxes. */
const FAIRY: readonly Rgb[] = [[253, 224, 71], [244, 114, 182], [125, 211, 252], [74, 222, 128], [255, 255, 255]]

// Pieces ---------------------------------------------------------------------------------------

/** x positions near the left and right edges of the square, alternating sides. */
function aside(f: Frame, random: Random, count: number, first: -1 | 1): number[] {
  return Array.from({ length: count }, (_, index) => {
    const side = index % 2 === 0 ? first : -first
    return side < 0 ? f.X(random.uniform(-0.35, 0.2)) : f.X(random.uniform(0.8, 1.35))
  })
}

function clouds(p: Painting, f: Frame, random: Random, count: number): void {
  for (let cloud = 0; cloud < count; cloud += 1) {
    const cx = random.uniform(0, f.width)
    const cy = f.Y(random.uniform(-0.2, 0.22))
    for (let puff = 0; puff < 4; puff += 1) {
      const ox = random.uniform(-0.07, 0.07) * f.unit
      p.add(oval([cx + ox, cy + random.uniform(-0.01, 0.01) * f.unit], f.unit * random.uniform(0.05, 0.09), f.unit * random.uniform(0.025, 0.04), WHITE, 0.78))
    }
  }
}

function sun(p: Painting, f: Frame, random: Random, hue: number, side: -1 | 1): void {
  const center: Point = [side < 0 ? f.X(random.uniform(0.04, 0.2)) : f.X(random.uniform(0.8, 0.96)), f.Y(random.uniform(0.05, 0.15))]
  p.glow(center, f.unit * 0.4, tone('#fff3b0', hue / 4), 0.75)
  p.add(circle(center, f.unit * 0.05, tone('#ffe27a', hue / 4)))
}

function tree(p: Painting, x: number, base: number, size: number, leaves: Rgb): void {
  const trunk = size * 0.15
  p.add(rect(x - trunk, base - size, x + trunk, base + size * 0.1, [120, 84, 60], 1, trunk))
  for (const [dx, dy, r] of [[0, -0.42, 0.62], [-0.38, 0, 0.46], [0.38, -0.08, 0.5]]) p.add(circle([x + dx * size, base - size + dy * size], r * size, leaves))
  p.add(circle([x - 0.17 * size, base - size - 0.62 * size], 0.25 * size, lighter(leaves, 28)))
}

interface Outdoor {
  sky?: readonly [string, string]
  far?: string
  grass?: readonly [string, string]
  leaves?: readonly string[]
}

function outdoor(p: Painting, f: Frame, random: Random, hue: number, place: Place, look: Outdoor = {}): Point[] {
  const { width, unit } = f
  const [skyTop, skyBottom] = look.sky ?? ['#7cc4f5', '#fde9c9']
  p.background(tone(skyTop, hue), tone(skyBottom, hue / 3))
  sun(p, f, random, hue, place.side)
  clouds(p, f, random, random.between(2, 4))
  const hills = wave(width, place.ground - unit * 0.33, unit * 0.03, random)
  const far = look.far ?? '#b9dfa0'
  p.fillBelow(hills, tone(far, hue), tone(far, hue, -0.06))
  const leaves = look.leaves ?? ['#4f9a4a']
  for (const x of aside(f, random, random.between(2, 4), place.side)) {
    tree(p, x, curveAt(hills, x) + unit * 0.03, unit * random.uniform(0.09, 0.14), tone(random.choice(leaves), hue))
  }
  const lawn = wave(width, place.ground - unit * 0.18, unit * 0.012, random)
  const [grass, grassDark] = look.grass ?? ['#a3d977', '#6fae5a']
  p.fillBelow(lawn, tone(grass, hue), tone(grassDark, hue))
  for (let tuft = Math.floor(width / (unit * 0.05)); tuft > 0; tuft -= 1) {
    const [x, y] = [random.uniform(0, width), random.uniform(place.ground - unit * 0.14, f.height)]
    p.add(polygon([[x - unit * 0.008, y], [x, y - unit * 0.022], [x + unit * 0.008, y]], tone(grassDark, hue, -0.05), 0.7))
  }
  return lawn
}

function flowers(p: Painting, f: Frame, random: Random, place: Place, count: number): void {
  const colors: readonly Rgb[] = [WHITE, [255, 214, 102], [255, 160, 190], [196, 181, 253]]
  for (let index = 0; index < count; index += 1) {
    const x = random.uniform(0, f.width)
    const y = random.uniform(place.ground - f.unit * 0.12, f.height)
    if (Math.abs(x - f.cx) < f.unit * 0.25 && y < place.ground + f.unit * 0.05) continue
    const r = f.unit * random.uniform(0.006, 0.011)
    const color = random.choice(colors)
    for (let petal = 0; petal < 5; petal += 1) {
      const a = (petal * 2 * Math.PI) / 5
      p.add(circle([x + Math.cos(a) * r, y + Math.sin(a) * r], r * 0.75, color))
    }
    p.add(circle([x, y], r * 0.6, [250, 204, 21]))
  }
}

// Outdoors -------------------------------------------------------------------------------------

const park: Painter = (p, f, random, hue, place) => {
  outdoor(p, f, random, hue, place)
  flowers(p, f, random, place, Math.floor((40 * f.width) / f.unit))
}

const zoo: Painter = (p, f, random, hue, place) => {
  outdoor(p, f, random, hue, place, { leaves: ['#4f9a4a', '#3f8a3f'] })
  const x = place.side < 0 ? f.X(0.06) : f.X(0.94)
  const top = place.ground - f.unit * 0.42
  p.add(rect(x - f.unit * 0.008, top, x + f.unit * 0.008, place.ground - f.unit * 0.1, WOOD))
  p.add(rect(x - f.unit * 0.09, top - f.unit * 0.05, x + f.unit * 0.09, top + f.unit * 0.03, [101, 67, 33], 1, f.unit * 0.008))
  p.add(text([x, top], 'ZOO', f.unit * 0.04, [254, 243, 199]))
  flowers(p, f, random, place, Math.floor((20 * f.width) / f.unit))
}

const garden: Painter = (p, f, random, hue, place) => {
  const { width, unit } = f
  p.background(tone('#8fd0f7', hue), tone('#fdf0d5', hue / 3))
  sun(p, f, random, hue, place.side)
  clouds(p, f, random, 2)
  const back = place.ground - unit * 0.24
  p.add(rect(0, back - unit * 0.3, width, back, tone('#3f8a3f', hue)))
  for (let x = 0; x < width; x += unit * 0.06) p.add(circle([x, back - unit * 0.3], unit * 0.05, tone('#4f9a4a', hue)))
  for (let x = 0; x < width; x += unit * 0.1) {
    p.add(rect(x + unit * 0.004, back - unit * 0.2, x + unit * 0.096, back + unit * 0.02, tone('#c08a5a', hue / 4, (Math.floor(x / (unit * 0.1)) % 2) * 0.03)))
  }
  const shed = place.side < 0 ? f.X(-0.05) : f.X(0.86)
  p.add(rect(shed, back - unit * 0.32, shed + unit * 0.22, back + unit * 0.02, [120, 84, 60]))
  p.add(polygon([[shed - unit * 0.02, back - unit * 0.32], [shed + unit * 0.11, back - unit * 0.42], [shed + unit * 0.24, back - unit * 0.32]], [92, 64, 51]))
  p.add(rect(shed + unit * 0.07, back - unit * 0.2, shed + unit * 0.15, back + unit * 0.02, [92, 64, 51]))
  p.fillBelow(wave(width, place.ground - unit * 0.17, unit * 0.008, random), tone('#9fd67f', hue), tone('#6fae5a', hue))
  flowers(p, f, random, place, Math.floor((25 * width) / unit))
}

const autumn: Painter = (p, f, random, hue, place) => {
  outdoor(p, f, random, hue, place, { sky: ['#9cc9ec', '#fde2c4'], far: '#c9c58a', grass: ['#b5c97a', '#8a9f52'], leaves: ['#ea580c', '#d97706', '#dc2626', '#ca8a04'] })
  const colors: readonly Rgb[] = [[234, 88, 12], [220, 38, 38], [234, 179, 8], [180, 83, 9]]
  for (let index = Math.floor((60 * f.width) / f.unit); index > 0; index -= 1) {
    const [x, y] = [random.uniform(0, f.width), random.uniform(place.ground - f.unit * 0.12, f.height)]
    p.add(oval([x, y], f.unit * 0.014, f.unit * 0.007, random.choice(colors), 0.9, random.uniform(0, 180)))
  }
}

function seaside(p: Painting, f: Frame, random: Random, hue: number, place: Place, evening: boolean): void {
  const { width, height, unit } = f
  const horizon = place.ground - unit * 0.38
  if (evening) p.background(tone('#f9a8d4', hue / 2), tone('#fed7aa', hue / 3))
  else p.background(tone('#8fd3fe', hue), tone('#ffe3cc', hue / 2))
  const sunAt: Point = [place.side < 0 ? f.X(random.uniform(0.1, 0.25)) : f.X(random.uniform(0.75, 0.9)), evening ? horizon - unit * 0.05 : f.Y(random.uniform(0.06, 0.16))]
  p.glow(sunAt, unit * 0.5, evening ? [255, 200, 120] : tone('#fff1c1', hue / 3), 0.85)
  p.add(circle(sunAt, unit * (evening ? 0.075 : 0.05), evening ? [253, 186, 116] : tone('#ffe7a0', hue / 3)))
  if (!evening) clouds(p, f, random, 2)
  p.add(`<rect x="0" y="${n(horizon)}" width="${width}" height="${n(height - horizon)}" fill="${p.gradient(evening ? [124, 58, 117] : tone('#2f8fce', hue), evening ? [249, 168, 120] : tone('#5fd0d0', hue), horizon, place.ground)}"/>`)
  for (let row = 0; row < 8; row += 1) {
    const y = horizon + (row + 1) * unit * 0.016
    const half = unit * (0.02 + 0.012 * row) * random.uniform(0.7, 1.3)
    p.add(oval([sunAt[0], y], half, unit * 0.003, [255, 244, 214], 0.6))
  }
  const boat = place.side < 0 ? f.X(0.85) : f.X(0.12)
  p.add(polygon([[boat - unit * 0.03, horizon - unit * 0.005], [boat + unit * 0.03, horizon - unit * 0.005], [boat + unit * 0.02, horizon + unit * 0.008], [boat - unit * 0.02, horizon + unit * 0.008]], [71, 85, 105]))
  p.add(polygon([[boat, horizon - unit * 0.06], [boat, horizon - unit * 0.008], [boat + unit * 0.03, horizon - unit * 0.008]], WHITE))
  const shore = wave(width, place.ground - unit * 0.15, unit * 0.015, random)
  p.add(line(shore, WHITE, Math.max(2, unit * 0.012), 0.8, 'round'))
  p.fillBelow(shore.map(([x, y]) => [x, y + unit * 0.01] as const), tone('#f6deb0', hue / 4), tone('#e8c48a', hue / 4))
  for (let shell = 0; shell < 8; shell += 1) {
    const [x, y] = [random.uniform(0, width), random.uniform(place.ground, height)]
    if (Math.abs(x - f.cx) < unit * 0.3) continue
    p.add(pieslice(x - unit * 0.012, y - unit * 0.012, x + unit * 0.012, y + unit * 0.012, 180, 360, [253, 205, 200]))
  }
  const pole = place.side < 0 ? f.X(-0.02) : f.X(1.02)
  if (pole > 0 && pole < width) {
    const top = place.ground - unit * 0.5
    const span = unit * 0.2
    p.add(line([[pole, top], [pole, place.ground + unit * 0.06]], [250, 250, 250], Math.max(2, unit * 0.008)))
    for (let index = 0; index < 6; index += 1) {
      p.add(pieslice(pole - span, top - span * 0.55, pole + span, top + span * 0.55, 180 + index * 30, 210 + index * 30, index % 2 ? WHITE : tone('#ef6f6c', hue)))
    }
  }
}

const beach: Painter = (p, f, random, hue, place) => seaside(p, f, random, hue, place, false)
const sunset: Painter = (p, f, random, hue, place) => seaside(p, f, random, hue, place, true)

const pool: Painter = (p, f, random, hue, place) => {
  const { width, height, unit } = f
  const level = place.ground - unit * 0.3
  p.background(tone('#e0f2fe', hue / 2), tone('#cdeefc', hue / 2))
  for (let x = 0; x < width; x += unit * 0.06) p.add(line([[x, 0], [x, level]], WHITE, Math.max(1, unit * 0.003), 0.8))
  for (let y = level; y > 0; y -= unit * 0.06) p.add(line([[0, y], [width, y]], WHITE, Math.max(1, unit * 0.003), 0.8))
  for (let x = unit * 0.05; x < width; x += unit * 0.32) p.add(rect(x, f.Y(-0.25), x + unit * 0.24, f.Y(0.1), [240, 249, 255], 0.9, unit * 0.01))
  const ring: Point = [place.side < 0 ? f.X(0.08) : f.X(0.92), f.Y(0.3)]
  for (let index = 0; index < 8; index += 1) p.add(pieslice(ring[0] - unit * 0.06, ring[1] - unit * 0.06, ring[0] + unit * 0.06, ring[1] + unit * 0.06, index * 45, index * 45 + 45, index % 2 ? WHITE : [239, 68, 68]))
  p.add(circle(ring, unit * 0.032, tone('#e0f2fe', hue / 2)))
  p.add(rect(0, level - unit * 0.035, width, level, tone('#0369a1', hue / 2)))
  p.add(`<rect x="0" y="${n(level)}" width="${width}" height="${n(height - level)}" fill="${p.gradient(tone('#5fd3f5', hue / 2), tone('#0e7490', hue / 2), level, height)}"/>`)
  for (let index = 0; index < 14; index += 1) {
    const y = random.uniform(level + unit * 0.05, height)
    const x = random.uniform(0, width)
    p.add(stroke(`M${n(x)},${n(y)} q${n(unit * 0.03)},${n(-unit * 0.012)} ${n(unit * 0.06)},0 t${n(unit * 0.06)},0`, WHITE, Math.max(1, unit * 0.004), 0.35))
  }
}

/** Water in front of the people standing in the pool, from `level` down. */
export function water(p: Painting, f: Frame, level: number, hue: number): void {
  p.add(`<rect x="0" y="${n(level)}" width="${f.width}" height="${n(f.height - level)}" fill="${p.gradient(tone('#67d4f3', hue / 2), tone('#0e7490', hue / 2), level, f.height)}" fill-opacity="0.62"/>`)
  p.add(line([[0, level], [f.width, level]], WHITE, Math.max(2, f.unit * 0.006), 0.7))
  for (let x = f.unit * 0.02; x < f.width; x += f.unit * 0.09) {
    p.add(stroke(`M${n(x)},${n(level + f.unit * 0.02)} q${n(f.unit * 0.02)},${n(-f.unit * 0.01)} ${n(f.unit * 0.04)},0`, WHITE, Math.max(1, f.unit * 0.004), 0.6))
  }
}
// Rooms ----------------------------------------------------------------------------------------

interface Room {
  wall: readonly [string, string]
  floor: readonly [string, string]
  boards?: boolean
  window?: 'day' | 'night' | 'snow' | 'blinds' | null
  curtains?: string
  rug?: string | null
  frames?: boolean
}

/** Wall, floor, a window on `place.side`, pictures on the other side and a rug under the people. */
function room(p: Painting, f: Frame, random: Random, hue: number, place: Place, look: Room): { floor: number; window: readonly [number, number, number, number] } {
  const { width, height, unit } = f
  const floor = place.ground - unit * 0.2
  p.background(tone(look.wall[0], hue), tone(look.wall[1], hue))
  const side = place.side
  const [x0, x1] = side > 0 ? [f.X(0.7), f.X(0.98)] : [f.X(0.02), f.X(0.3)]
  const [y0, y1] = [f.Y(0.04), floor - unit * 0.24]
  const kind = look.window === undefined ? 'day' : look.window
  if (kind) {
    const frame = unit * 0.014
    p.add(rect(x0 - frame, y0 - frame, x1 + frame, y1 + frame, WHITE))
    const night = kind === 'night' || kind === 'snow'
    p.add(`<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" fill="${p.gradient(night ? [30, 42, 90] : tone('#a5d8ff', hue / 3), night ? [70, 60, 130] : tone('#fff4d6', hue / 3), y0, y1)}"/>`)
    if (night) {
      p.crescent([x0 + (x1 - x0) * 0.7, y0 + (y1 - y0) * 0.25], unit * 0.03, [unit * 0.016, -unit * 0.006], [255, 236, 179])
      for (let index = 0; index < 10; index += 1) p.add(circle([random.uniform(x0, x1), random.uniform(y0, y1)], unit * random.uniform(0.002, 0.004), WHITE, 0.9))
      if (kind === 'snow') {
        for (let index = 0; index < 26; index += 1) p.add(circle([random.uniform(x0, x1), random.uniform(y0, y1)], unit * random.uniform(0.003, 0.006), WHITE))
        p.add(rect(x0, y1 - unit * 0.025, x1, y1, WHITE))
      }
    } else if (kind === 'day') {
      p.add(circle([x0 + (x1 - x0) * 0.3, y1 - unit * 0.02], unit * 0.07, tone('#7cc47a', hue)))
      p.add(circle([x0 + (x1 - x0) * 0.62, y1 - unit * 0.01], unit * 0.06, tone('#5fae5d', hue)))
      p.add(oval([x0 + (x1 - x0) * 0.6, y0 + (y1 - y0) * 0.25], unit * 0.05, unit * 0.02, WHITE, 0.9))
    } else {
      for (let y = y0 + unit * 0.02; y < y1; y += unit * 0.03) p.add(line([[x0, y], [x1, y]], [226, 232, 240], unit * 0.016))
    }
    if (kind !== 'blinds') {
      p.add(line([[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]], WHITE, frame))
      p.add(line([[x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]], WHITE, frame))
    }
    p.add(rect(x0 - unit * 0.03, y1 + frame, x1 + unit * 0.03, y1 + frame + unit * 0.02, WHITE))
    if (look.curtains) {
      const cloth = tone(look.curtains, hue)
      for (const [left, right] of [[x0 - unit * 0.06, x0 + unit * 0.02], [x1 - unit * 0.02, x1 + unit * 0.06]]) {
        p.add(rect(left, y0 - unit * 0.05, right, y1 + unit * 0.06, cloth))
        for (let x = left + unit * 0.02; x < right; x += unit * 0.025) p.add(line([[x, y0 - unit * 0.05], [x, y1 + unit * 0.06]], darker(cloth, 25), unit * 0.004, 0.6))
      }
      p.add(rect(x0 - unit * 0.08, y0 - unit * 0.065, x1 + unit * 0.08, y0 - unit * 0.045, [120, 84, 60], 1, unit * 0.01))
    }
    if (!night) {
      p.blurred(unit * 0.03, () => p.add(polygon([[x0, floor], [x1, floor], [x1 - side * unit * 0.1, height], [x0 - side * unit * 0.25, height]], [255, 250, 230], 0.25)))
    }
  }
  if (look.frames !== false) {
    const fx = side > 0 ? f.X(0.06) : f.X(0.76)
    const colors: readonly Rgb[] = [tone('#fda4af', hue), tone('#93c5fd', hue), tone('#fde68a', hue)]
    for (const [dx, dy, w, h] of [[0, 0.1, 0.12, 0.09], [0.14, 0.06, 0.08, 0.11]]) {
      const [left, top] = [fx + dx * unit, f.Y(dy)]
      p.add(rect(left, top, left + w * unit, top + h * unit, [120, 84, 60], 1, unit * 0.004))
      p.add(rect(left + unit * 0.008, top + unit * 0.008, left + w * unit - unit * 0.008, top + h * unit - unit * 0.008, random.choice(colors)))
      p.add(circle([left + w * unit * 0.5, top + h * unit * 0.45], Math.min(w, h) * unit * 0.22, WHITE, 0.7))
    }
  }
  p.fillBelow([[0, floor], [width, floor]], tone(look.floor[0], hue / 3), tone(look.floor[1], hue / 3))
  if (look.boards !== false) {
    for (let index = 1; index < 7; index += 1) {
      const y = floor + (height - floor) * (index / 7) ** 1.4
      p.add(line([[0, y], [width, y]], [90, 60, 40], Math.max(1, unit * 0.003), 0.25))
    }
  }
  p.add(rect(0, floor - unit * 0.018, width, floor, lighter(tone(look.wall[1], hue), 25)))
  if (look.rug !== null) {
    p.add(oval([f.cx, place.ground + unit * 0.01], unit * 0.44, unit * 0.085, tone(look.rug ?? '#f4a6b8', hue * 2)))
    p.add(oval([f.cx, place.ground + unit * 0.01], unit * 0.38, unit * 0.065, lighter(tone(look.rug ?? '#f4a6b8', hue * 2), 25), 0.6))
  }
  return { floor, window: [x0, y0, x1, y1] }
}

const home: Painter = (p, f, random, hue, place) => {
  room(p, f, random, hue, place, { wall: ['#fbe7d3', '#f1c9a8'], floor: ['#c99a6e', '#a8764c'], curtains: '#e9a2b5' })
  const pot = place.side > 0 ? f.X(0.04) : f.X(0.96)
  p.add(polygon([[pot - f.unit * 0.04, place.ground - f.unit * 0.14], [pot + f.unit * 0.04, place.ground - f.unit * 0.14], [pot + f.unit * 0.03, place.ground - f.unit * 0.06], [pot - f.unit * 0.03, place.ground - f.unit * 0.06]], [214, 120, 80]))
  for (const [dx, dy, angle] of [[-0.03, -0.2, -30], [0.03, -0.21, 30], [0, -0.24, 0], [-0.045, -0.17, -55], [0.045, -0.17, 55]]) {
    p.add(oval([pot + dx * f.unit, place.ground + dy * f.unit], f.unit * 0.015, f.unit * 0.05, tone('#4f9a4a', hue), 1, angle))
  }
  bokeh(p, random, [[255, 244, 214], WHITE], 6, f.unit)
}

const playroom: Painter = (p, f, random, hue, place) => {
  const { floor } = room(p, f, random, hue, place, { wall: ['#e0f2fe', '#fef3c7'], floor: ['#a7d3a0', '#86b97f'], boards: false, curtains: '#93c5fd', rug: null })
  const colors = [0, 0.15, 0.33, 0.55].map((shift) => tone('#f87171', hue + shift, 0.08))
  const tile = f.unit * 0.12
  for (let row = 0; floor + row * tile * 0.5 < f.height; row += 1) {
    for (let column = -1; column * tile < f.width; column += 1) {
      const x = column * tile + (row % 2) * tile * 0.5
      p.add(rect(x, floor + f.unit * 0.04 + row * tile * 0.5, x + tile, floor + f.unit * 0.04 + (row + 1) * tile * 0.5, colors[(row + column + 8) % 4], 0.9))
    }
  }
  const shelf = place.side > 0 ? f.X(-0.08) : f.X(0.84)
  p.add(rect(shelf, floor - f.unit * 0.3, shelf + f.unit * 0.24, floor, [214, 170, 120], 1, f.unit * 0.008))
  for (const [dy, items] of [[0.15, 3], [0.29, 2]]) {
    for (let index = 0; index < items; index += 1) {
      p.add(rect(shelf + f.unit * (0.02 + index * 0.075), floor - f.unit * dy, shelf + f.unit * (0.08 + index * 0.075), floor - f.unit * (dy - 0.1), colors[(index + items) % 4], 1, f.unit * 0.008))
    }
  }
  bokeh(p, random, [WHITE], 5, f.unit)
}

const hospital: Painter = (p, f, random, hue, place) => {
  room(p, f, random, hue, place, { wall: ['#ecfdf5', '#d1fae5'], floor: ['#e2e8f0', '#cbd5e1'], boards: false, window: 'blinds', rug: null, frames: false })
  p.add(rect(0, f.Y(0.5), f.width, f.Y(0.52), [214, 190, 160]))
  const x = place.side > 0 ? f.X(0.1) : f.X(0.9)
  balloon(p, [x, f.Y(0.14)], f.unit * 0.055, place.color ?? [244, 114, 182], [x - f.unit * 0.02, place.ground - f.unit * 0.12])
  heart(p, [x, f.Y(0.14)], f.unit * 0.025, WHITE, 0.9)
}

const bathroom: Painter = (p, f, random, hue, place) => {
  const { floor } = room(p, f, random, hue, place, { wall: ['#e0f7fa', '#c8eef3'], floor: ['#d6dde5', '#b8c3cf'], boards: false, window: null, rug: '#93c5fd', frames: false })
  for (let x = 0; x < f.width; x += f.unit * 0.07) p.add(line([[x, 0], [x, floor]], WHITE, Math.max(1, f.unit * 0.003)))
  for (let y = floor; y > 0; y -= f.unit * 0.07) p.add(line([[0, y], [f.width, y]], WHITE, Math.max(1, f.unit * 0.003)))
  const x = place.side > 0 ? f.X(0.84) : f.X(0.04)
  p.add(rect(x - f.unit * 0.01, f.Y(0.18), x + f.unit * 0.13, f.Y(0.19), [148, 163, 184], 1, f.unit * 0.005))
  p.add(rect(x, f.Y(0.18), x + f.unit * 0.12, f.Y(0.42), tone('#fbbf24', hue), 1, f.unit * 0.01))
  for (const dy of [0.36, 0.38]) p.add(line([[x, f.Y(dy)], [x + f.unit * 0.12, f.Y(dy)]], WHITE, f.unit * 0.008))
  const mirror = place.side > 0 ? f.X(0.06) : f.X(0.8)
  p.add(rect(mirror, f.Y(0.05), mirror + f.unit * 0.14, f.Y(0.3), [226, 232, 240], 1, f.unit * 0.07))
  p.add(line([[mirror + f.unit * 0.03, f.Y(0.12)], [mirror + f.unit * 0.08, f.Y(0.08)]], WHITE, f.unit * 0.01, 0.8, 'round'))
}

const kitchen: Painter = (p, f, random, hue, place) => {
  room(p, f, random, hue, place, { wall: ['#fff7ed', '#ffedd5'], floor: ['#e7d3b9', '#cdb193'], window: 'day', rug: null, frames: false })
  const { width, unit } = f
  p.add(rect(0, f.Y(-0.6), width, f.Y(0.02), tone('#9ec5c0', hue / 2)))
  for (let x = unit * 0.01; x < width; x += unit * 0.16) {
    p.add(rect(x, f.Y(-0.55), x + unit * 0.14, f.Y(-0.01), lighter(tone('#9ec5c0', hue / 2), 18), 1, unit * 0.01))
    p.add(rect(x + unit * 0.06, f.Y(-0.04), x + unit * 0.08, f.Y(-0.025), [120, 113, 108]))
  }
  for (const [from, to] of [[-1, 0.2], [0.8, 2]]) {
    const [left, right] = [Math.max(0, f.X(from)), Math.min(width, f.X(to))]
    if (right <= left) continue
    p.add(rect(left, f.Y(0.42), right, place.ground - unit * 0.2, tone('#9ec5c0', hue / 2)))
    p.add(rect(left, f.Y(0.4), right, f.Y(0.44), [226, 214, 196]))
  }
  const jar = place.side > 0 ? f.X(0.06) : f.X(0.88)
  for (const [dx, h, color] of [[0, 0.07, [250, 204, 21]], [0.05, 0.09, [239, 68, 68]]] as const) {
    p.add(rect(jar + dx * unit, f.Y(0.4) - h * unit, jar + (dx + 0.04) * unit, f.Y(0.4), [226, 232, 240], 0.9, unit * 0.008))
    p.add(rect(jar + dx * unit + unit * 0.005, f.Y(0.4) - h * unit * 0.6, jar + (dx + 0.035) * unit, f.Y(0.4) - unit * 0.004, color, 0.8))
  }
}

const bedroom: Painter = (p, f, random, hue, place) => {
  room(p, f, random, hue, place, { wall: ['#2b3a78', '#1f2b5c'], floor: ['#5b4636', '#3e2f25'], window: 'night', curtains: '#5b6bb5', rug: '#7c86c9', frames: false })
  for (let index = 0; index < 14; index += 1) star(p, [random.uniform(0, f.width), f.Y(random.uniform(-0.2, 0.5))], f.unit * random.uniform(0.006, 0.012), [253, 230, 138], 0, 0.55)
  const lights = wave(f.width, f.Y(0.03), f.unit * 0.015, random, 24)
  p.add(line(lights, [40, 40, 60], Math.max(1, f.unit * 0.003)))
  lights.forEach(([x, y], index) => {
    if (index % 2) return
    const color = FAIRY[index % 3]
    p.glow([x, y + f.unit * 0.01], f.unit * 0.03, color, 0.6)
    p.add(circle([x, y + f.unit * 0.01], f.unit * 0.006, color))
  })
  const lamp: Point = [place.side > 0 ? f.X(0.05) : f.X(0.95), place.ground - f.unit * 0.14]
  p.glow(lamp, f.unit * 0.22, [255, 214, 140], 0.55)
  p.add(circle(lamp, f.unit * 0.035, [255, 237, 190]))
}

const classroom: Painter = (p, f, random, hue, place) => {
  room(p, f, random, hue, place, { wall: ['#fef9c3', '#fde68a'], floor: ['#93c5fd', '#60a5fa'], boards: false, rug: '#f9a8d4', frames: false })
  const colors = [0, 0.12, 0.3, 0.5, 0.62, 0.8].map((shift) => tone('#f87171', hue + shift))
  bunting(p, f.X(-0.1), f.X(1.1), f.Y(0.0), f.unit * 0.05, f.unit * 0.05, colors, 'ABCDEFGHIJ')
  const board = place.side > 0 ? f.X(0.03) : f.X(0.73)
  p.add(rect(board, f.Y(0.14), board + f.unit * 0.25, f.Y(0.42), [214, 170, 120], 1, f.unit * 0.008))
  for (const [dx, dy] of [[0.02, 0.02], [0.13, 0.03], [0.06, 0.15]]) {
    const [x, y] = [board + dx * f.unit, f.Y(0.14 + dy)]
    p.add(rect(x, y, x + f.unit * 0.1, y + f.unit * 0.1, WHITE, 1, 0))
    p.add(circle([x + f.unit * 0.05, y + f.unit * 0.05], f.unit * 0.025, random.choice(colors)))
    p.add(line([[x + f.unit * 0.02, y + f.unit * 0.085], [x + f.unit * 0.08, y + f.unit * 0.08]], random.choice(colors), f.unit * 0.006))
  }
  if (place.sign) {
    const x = f.cx
    p.add(rect(x - f.unit * 0.17, f.Y(0.08), x + f.unit * 0.17, f.Y(0.16), WHITE, 1, f.unit * 0.02))
    p.add(text([x, f.Y(0.135)], place.sign, f.unit * 0.045, [124, 58, 237]))
    for (const [dx, dy, angle] of [[-0.3, 0.12, -20], [0.28, 0.1, 15], [-0.42, 0.3, 10], [0.4, 0.28, -12]]) {
      butterfly(p, [x + dx * f.unit, f.Y(dy)], f.unit * 0.03, random.choice(colors), angle)
    }
  }
}

const salon: Painter = (p, f, random, hue, place) => {
  const { floor } = room(p, f, random, hue, place, { wall: ['#ccfbf1', '#99f6e4'], floor: ['#f1f5f9', '#e2e8f0'], boards: false, window: null, rug: null, frames: false })
  const tile = f.unit * 0.08
  for (let row = 0; floor + row * tile < f.height; row += 1) {
    for (let column = 0; column * tile < f.width; column += 1) {
      if ((row + column) % 2) p.add(rect(column * tile, floor + row * tile, (column + 1) * tile, floor + (row + 1) * tile, [51, 65, 85], 0.85))
    }
  }
  const mirror = place.side > 0 ? f.X(0.74) : f.X(0.02)
  p.add(rect(mirror, f.Y(0.1), mirror + f.unit * 0.24, f.Y(0.52), [226, 232, 240], 1, f.unit * 0.03))
  for (const offset of [0.05, 0.1]) p.add(line([[mirror + f.unit * offset, f.Y(0.2)], [mirror + f.unit * (offset + 0.08), f.Y(0.12)]], WHITE, f.unit * 0.012, 0.8, 'round'))
  const shelf = place.side > 0 ? f.X(0.04) : f.X(0.78)
  p.add(rect(shelf, f.Y(0.3), shelf + f.unit * 0.2, f.Y(0.315), [120, 84, 60]))
  for (const [dx, h, color] of [[0.02, 0.07, [244, 114, 182]], [0.07, 0.09, [96, 165, 250]], [0.12, 0.06, [250, 204, 21]], [0.16, 0.08, [167, 139, 250]]] as const) {
    p.add(rect(shelf + dx * f.unit, f.Y(0.3) - h * f.unit, shelf + (dx + 0.03) * f.unit, f.Y(0.3), color, 1, f.unit * 0.006))
  }
  p.add(text([f.cx, f.Y(0.1)], place.sign ?? 'Snip & Curl', f.unit * 0.055, [13, 148, 136]))
}

const christmas: Painter = (p, f, random, hue, place) => {
  room(p, f, random, hue, place, { wall: ['#1d4e4a', '#163c39'], floor: ['#8a5a3c', '#5e3d2a'], window: 'snow', curtains: '#b91c1c', rug: '#b91c1c', frames: false })
  for (let index = 0; index < 18; index += 1) star(p, [random.uniform(0, f.width), f.Y(random.uniform(-0.3, 0.55))], f.unit * 0.008, [253, 230, 138], 0, 0.35)
  const lights = wave(f.width, f.Y(0.02), f.unit * 0.02, random, 30)
  p.add(line(lights, [30, 50, 40], Math.max(1, f.unit * 0.003)))
  lights.forEach(([x, y], index) => {
    const color = FAIRY[index % 4]
    p.glow([x, y + f.unit * 0.01], f.unit * 0.025, color, 0.6)
    p.add(circle([x, y + f.unit * 0.01], f.unit * 0.006, color))
  })
  if (place.tree !== false) christmasTree(p, place.side > 0 ? f.X(0.12) : f.X(0.88), place.ground - f.unit * 0.04, f.unit * 0.055, random)
  bokeh(p, random, [[255, 214, 120], [255, 120, 100]], 8, f.unit)
}

// Other places ---------------------------------------------------------------------------------

const party: Painter = (p, f, random, hue, place) => {
  const { width, unit } = f
  p.background(tone('#fbcfe8', hue), tone('#e9d5ff', hue))
  for (let index = 0; index < 40; index += 1) p.add(circle([random.uniform(0, width), random.uniform(0, place.ground)], unit * 0.012, WHITE, 0.3))
  const floor = place.ground - unit * 0.18
  p.fillBelow([[0, floor], [width, floor]], tone('#e7c9a9', hue / 3), tone('#c9a27e', hue / 3))
  const palette = [0, 0.12, 0.3, 0.5, 0.62, 0.8].map((shift) => tone('#f87171', hue + shift))
  bunting(p, f.X(-0.05), f.X(1.05), f.Y(0.02), unit * 0.06, unit * 0.06, palette, place.sign ?? '')
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? f.X(0.08) : f.X(0.92)
    for (const [dx, dy] of [[-0.04, 0.22], [0.04, 0.17], [0, 0.29]]) balloon(p, [x + dx * unit, f.Y(dy)], unit * 0.05, random.choice(palette), [x, floor])
  }
  for (let count = Math.floor((70 * width) / unit); count > 0; count -= 1) {
    const [x, y] = [random.uniform(0, width), random.uniform(0, f.height)]
    const piece = unit * random.uniform(0.004, 0.008)
    p.add(rect(x - piece, y - piece * 0.6, x + piece, y + piece * 0.6, random.choice(palette), 0.85))
  }
  bokeh(p, random, [WHITE, ...palette], 8, unit)
}

const halloween: Painter = (p, f, random, _hue, place) => {
  const { width, unit } = f
  p.background([46, 16, 101], [249, 115, 22])
  const moon: Point = [place.side > 0 ? f.X(0.85) : f.X(0.15), f.Y(0.14)]
  p.glow(moon, unit * 0.3, [254, 240, 138], 0.45)
  p.add(circle(moon, unit * 0.07, [254, 243, 199]))
  for (const [dx, dy] of [[-0.12, 0.05], [0.1, 0.1], [-0.05, 0.16]]) {
    const [bx, by] = [moon[0] + dx * unit, moon[1] + dy * unit]
    p.add(polygon([[bx - unit * 0.03, by - unit * 0.008], [bx - unit * 0.012, by], [bx, by - unit * 0.01], [bx + unit * 0.012, by], [bx + unit * 0.03, by - unit * 0.008], [bx, by + unit * 0.008]], [30, 20, 40]))
  }
  const skyline = place.ground - unit * 0.22
  for (let x = -unit * 0.05; x < width; x += unit * random.uniform(0.16, 0.24)) {
    const [w, h] = [unit * random.uniform(0.12, 0.18), unit * random.uniform(0.1, 0.2)]
    p.add(rect(x, skyline - h, x + w, skyline + unit * 0.05, [49, 27, 74]))
    p.add(polygon([[x - unit * 0.01, skyline - h], [x + w / 2, skyline - h - unit * 0.07], [x + w + unit * 0.01, skyline - h]], [40, 22, 62]))
    if (random.random() < 0.7) p.add(rect(x + w * 0.35, skyline - h * 0.65, x + w * 0.6, skyline - h * 0.35, [253, 224, 71], 0.9))
  }
  p.fillBelow([[0, place.ground - unit * 0.14], [width, place.ground - unit * 0.14]], [74, 58, 88], [44, 34, 54])
  bunting(p, f.X(-0.1), f.X(1.1), f.Y(-0.01), unit * 0.05, unit * 0.05, [[249, 115, 22], [30, 20, 40], [147, 51, 234]])
  for (const x of [f.X(0.06), f.X(0.94), f.X(-0.1), f.X(1.1)]) jackOLantern(p, [x, place.ground + unit * 0.02], unit * 0.05)
}

const stage: Painter = (p, f, random, _hue, place) => {
  const { width, height, unit } = f
  p.background([30, 27, 75], [49, 46, 129])
  for (let index = 0; index < 22; index += 1) star(p, [random.uniform(0, width), f.Y(random.uniform(-0.3, 0.55))], unit * random.uniform(0.008, 0.016), [253, 224, 71], 0, 0.8)
  star(p, [f.cx, f.Y(0.07)], unit * 0.05, [253, 224, 71])
  const floor = place.ground - unit * 0.12
  p.fillBelow([[0, floor], [width, floor]], [180, 120, 70], [120, 78, 46])
  for (let index = 1; index < 5; index += 1) {
    const y = floor + (height - floor) * (index / 5)
    p.add(line([[0, y], [width, y]], [90, 60, 40], Math.max(1, unit * 0.003), 0.4))
  }
  p.glow([f.cx, place.ground - unit * 0.3], unit * 0.55, [255, 250, 230], 0.35)
  const red: Rgb = [185, 28, 28]
  for (const side of [-1, 1]) {
    const [inner, outer] = side < 0 ? [f.X(0.12), 0] : [f.X(0.88), width]
    p.add(polygon([[outer, 0], [inner, 0], [inner + side * unit * 0.04, f.Y(0.45)], [inner - side * unit * 0.02, height], [outer, height]], red))
    for (let k = 1; k < 4; k += 1) {
      const x = inner + (outer - inner) * (k / 4)
      p.add(line([[x, 0], [x, height]], darker(red, 30), unit * 0.008, 0.6))
    }
  }
  p.add(rect(0, 0, width, f.Y(0.03), red))
  for (let x = 0; x < width; x += unit * 0.08) p.add(circle([x + unit * 0.04, f.Y(0.03)], unit * 0.04, red))
}

const blanket: Painter = (p, f, random, hue, place) => {
  const color = place.color ?? tone('#f9c6d8', hue)
  p.background(lighter(color, 14), color)
  const pattern = random.below(3)
  const step = f.unit * 0.1
  for (let y = -step; y < f.height + step; y += step) {
    for (let x = -step; x < f.width + step; x += step) {
      const [px, py] = [x + ((y / step) % 2) * step * 0.5, y]
      if (pattern === 0) star(p, [px, py], step * 0.16, WHITE, 0.2, 0.55)
      else if (pattern === 1) p.add(circle([px, py], step * 0.1, WHITE, 0.5))
      else p.add(rect(x, y, x + step * 0.5, y + step * 0.5, darker(color, 18), 0.25))
    }
  }
  p.blurred(f.unit * 0.02, () => {
    for (let index = 0; index < 3; index += 1) {
      const y = random.uniform(0, f.height)
      p.add(stroke(`M0,${n(y)} Q${n(f.width / 2)},${n(y + random.uniform(-0.1, 0.1) * f.unit)} ${n(f.width)},${n(y)}`, darker(color, 30), f.unit * 0.02, 0.25))
    }
  })
}

const cot: Painter = (p, f, random, hue, place) => {
  const { height, unit } = f
  p.background([150, 110, 80], [120, 86, 60])
  const [left, right] = [f.X(0.06), f.X(0.94)]
  const sheet = place.color ?? tone('#e0f2fe', hue / 2)
  p.add(rect(left, -unit, right, height + unit, sheet))
  for (let y = 0; y < height; y += unit * 0.12) {
    for (let x = left + unit * 0.06; x < right; x += unit * 0.12) {
      if (random.random() < 0.5) star(p, [x, y + unit * 0.06], unit * 0.012, lighter(darker(sheet, 40), 10), 0, 0.5)
      else p.crescent([x, y + unit * 0.06], unit * 0.012, [unit * 0.006, -unit * 0.003], darker(sheet, 35))
    }
  }
  for (const [from, to] of [[left - unit * 0.07, left], [right, right + unit * 0.07]]) {
    p.add(rect(from, 0, to, height, WOOD))
    p.add(rect(from + unit * 0.012, 0, to - unit * 0.012, height, lighter(WOOD, 18)))
  }
  p.blurred(unit * 0.015, () => {
    p.add(rect(left, 0, left + unit * 0.04, height, [40, 30, 35], 0.18))
    p.add(rect(right - unit * 0.04, 0, right, height, [40, 30, 35], 0.18))
  })
}

const street: Painter = (p, f, random, hue, place) => {
  const { width, height, unit } = f
  const night = place.night ?? false
  p.background(night ? [30, 27, 75] : tone('#a5d8ff', hue), night ? [76, 29, 149] : tone('#e0f2fe', hue))
  const wallTop = f.Y(-0.02)
  const pavement = place.ground - unit * 0.06
  const brick = night ? [92, 60, 70] as Rgb : tone('#c27a62', hue / 3)
  p.add(rect(0, wallTop, width, pavement, brick))
  for (let y = wallTop + unit * 0.03; y < pavement; y += unit * 0.03) p.add(line([[0, y], [width, y]], lighter(brick, 30), Math.max(1, unit * 0.003), 0.6))
  const doorX = place.side > 0 ? f.X(0.66) : f.X(0.08)
  const [doorW, doorTop] = [unit * 0.26, f.Y(0.12)]
  const door = random.choice([tone('#2563eb', 0), tone('#16a34a', 0), tone('#dc2626', 0), tone('#0f766e', 0)])
  p.add(rect(doorX - unit * 0.025, doorTop - unit * 0.1, doorX + doorW + unit * 0.025, pavement, WHITE))
  p.add(shape(`M${n(doorX)},${n(doorTop)} A${n(doorW / 2)},${n(unit * 0.08)} 0 0,1 ${n(doorX + doorW)},${n(doorTop)} Z`, night ? [253, 224, 71] : [191, 219, 254]))
  p.add(rect(doorX, doorTop, doorX + doorW, pavement, door))
  for (const [dx, dy, h] of [[0.03, 0.04, 0.2], [0.14, 0.04, 0.2], [0.03, 0.3, 0.25], [0.14, 0.3, 0.25]]) {
    p.add(rect(doorX + dx * unit, doorTop + dy * unit, doorX + (dx + 0.09) * unit, doorTop + (dy + h) * unit, darker(door, 25), 1, unit * 0.006))
  }
  p.add(circle([doorX + doorW * 0.85, doorTop + unit * 0.3], unit * 0.012, [250, 204, 21]))
  p.add(rect(doorX - unit * 0.05, pavement - unit * 0.02, doorX + doorW + unit * 0.05, pavement + unit * 0.02, [203, 213, 225]))
  if (place.sign) {
    const half = Math.max(unit * 0.18, place.sign.length * unit * 0.0145)
    const [cx, cy] = [Math.min(f.X(0.98) - half, Math.max(f.X(0.02) + half, doorX + doorW / 2)), doorTop - unit * 0.17]
    p.add(rect(cx - half, cy - unit * 0.045, cx + half, cy + unit * 0.045, [255, 251, 235], 1, unit * 0.015))
    p.add(text([cx, cy + unit * 0.015], place.sign, unit * 0.04, [21, 128, 61]))
  }
  const windowX = place.side > 0 ? f.X(0.04) : f.X(0.72)
  p.add(rect(windowX - unit * 0.015, f.Y(0.12), windowX + unit * 0.255, f.Y(0.42), WHITE))
  p.add(rect(windowX, f.Y(0.135), windowX + unit * 0.24, f.Y(0.405), night ? [253, 224, 71] : [191, 219, 254]))
  p.add(line([[windowX + unit * 0.12, f.Y(0.135)], [windowX + unit * 0.12, f.Y(0.405)]], WHITE, unit * 0.012))
  p.add(rect(windowX - unit * 0.02, f.Y(0.42), windowX + unit * 0.26, f.Y(0.47), [120, 84, 60]))
  for (let index = 0; index < 6; index += 1) p.add(circle([windowX + unit * (0.02 + index * 0.044), f.Y(0.415)], unit * 0.022, FAIRY[(index % 3) + 1]))
  p.fillBelow([[0, pavement], [width, pavement]], night ? [88, 80, 100] : [203, 196, 188], night ? [60, 54, 70] : [168, 160, 152])
  for (let x = 0; x < width; x += unit * 0.2) p.add(line([[x, pavement], [x - unit * 0.06, height]], night ? [50, 44, 60] : [150, 142, 134], Math.max(1, unit * 0.003), 0.6))
  if (night) p.glow([doorX + doorW / 2, doorTop], unit * 0.3, [253, 224, 71], 0.3)
}

const PAINTERS: Readonly<Record<Backdrop, Painter>> = {
  park,
  zoo,
  garden,
  autumn,
  beach,
  sunset,
  pool,
  home,
  playroom,
  hospital,
  bathroom,
  kitchen,
  party,
  halloween,
  bedroom,
  classroom,
  stage,
  christmas,
  blanket,
  cot,
  salon,
  street,
}

export function paintBackdrop(p: Painting, f: Frame, backdrop: Backdrop, random: Random, hue: number, place: Place): void {
  PAINTERS[backdrop](p, f, random, hue, place)
}

/** Rough average colour of each backdrop for a hue shift (the photo's placeholder colour). */
export function backdropColor(backdrop: Backdrop, hue: number): Rgb {
  switch (backdrop) {
    case 'park':
    case 'zoo':
    case 'garden':
      return mix([[tone('#bcd7df', hue), 45], [tone('#8cc56d', hue), 55]])
    case 'autumn':
      return mix([[tone('#c8d8e0', hue), 45], [tone('#a8b56a', hue), 55]])
    case 'beach':
      return mix([[tone('#c7d6e0', hue), 45], [tone('#47b0cf', hue), 30], [tone('#efd19d', hue / 4), 25]])
    case 'sunset':
      return mix([[tone('#fbc2c8', hue / 2), 45], [[180, 110, 130], 30], [tone('#efd19d', hue / 4), 25]])
    case 'pool':
      return mix([[tone('#d8f0fb', hue / 2), 50], [tone('#2aa6c8', hue / 2), 50]])
    case 'home':
      return mix([[tone('#f6d8bd', hue), 70], [tone('#b9875d', hue / 3), 30]])
    case 'playroom':
      return mix([[tone('#eff2e3', hue / 2), 68], [tone('#e59a8a', hue / 2), 32]])
    case 'hospital':
      return mix([[tone('#dff7ec', hue), 70], [tone('#d6dde5', hue / 3), 30]])
    case 'bathroom':
      return mix([[tone('#d4f2f6', hue), 70], [tone('#c7d0da', hue / 3), 30]])
    case 'kitchen':
      return mix([[tone('#fff2e4', hue), 55], [tone('#9ec5c0', hue / 2), 20], [tone('#dac2a6', hue / 3), 25]])
    case 'party':
      return mix([[tone('#fbcfe8', hue), 50], [tone('#e9d5ff', hue), 50]])
    case 'halloween':
      return mix([[[120, 50, 90], 60], [[60, 46, 70], 40]])
    case 'bedroom':
      return mix([[tone('#263370', hue), 75], [tone('#4d3b2e', hue / 3), 25]])
    case 'classroom':
      return mix([[tone('#fdf0b0', hue), 70], [tone('#7ab3fb', hue / 3), 30]])
    case 'stage':
      return mix([[[40, 36, 102], 60], [[170, 40, 40], 25], [[150, 98, 58], 15]])
    case 'christmas':
      return mix([[tone('#1a4542', hue), 70], [tone('#735036', hue / 3), 30]])
    case 'blanket':
    case 'cot':
      return tone('#f6d4e0', hue)
    case 'salon':
      return mix([[tone('#b3f8e8', hue), 70], [[150, 160, 175], 30]])
    case 'street':
      return mix([[tone('#c27a62', hue / 3), 60], [[185, 178, 170], 25], [tone('#c3e0fd', hue), 15]])
  }
}
