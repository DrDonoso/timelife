/**
 * The people in the demo photos, in the flat style of the children's portraits: Emma and Leo at
 * any age (swaddled newborn, baby, toddler, preschooler) with poses, expressions, outfits and
 * hats, and the grown-ups who appear with them (Mum, Dad, Grandma and Grandpa).
 */
import {
  INK,
  WHITE,
  circle,
  darker,
  lighter,
  line,
  n,
  oval,
  pieslice,
  polygon,
  rect,
  rgb,
  shadow,
  shape,
  stroke,
  trapezoid,
  type Painting,
  type Point,
  type Rgb,
} from './paint'

export type Slug = 'emma' | 'leo'
export type Stage = 'newborn' | 'baby' | 'toddler' | 'child'
export type Expression = 'smile' | 'calm' | 'grin' | 'laugh' | 'sleep' | 'wow' | 'tooth' | 'kiss' | 'cream' | 'silly'
/** Upright poses stand on the anchor; `sit` sits on it; `perch` sits on a seat with legs hanging. */
export type Pose = 'stand' | 'walk' | 'run' | 'jump' | 'kneel' | 'sit' | 'perch' | 'crawl' | 'tummy' | 'back' | 'swaddle'
export type Arms = 'down' | 'out' | 'up' | 'wave' | 'clap' | 'hold' | 'reach' | 'point' | 'hips' | 'feed' | 'nose'
export type Hat = 'sun' | 'party' | 'crown' | 'witch' | 'santa' | 'beanie' | 'stem' | 'sheep' | 'star' | 'hood' | 'helmet'
export type Outfit = 'clothes' | 'dress' | 'onesie' | 'swim' | 'pyjamas' | 'uniform' | 'pumpkin' | 'witch' | 'sheep' | 'star'

export interface Kid {
  slug: Slug
  months: number
}

export interface Look {
  expression?: Expression
  arms?: Arms
  hat?: Hat
  outfit?: Outfit
  /** Main clothes colour (default: the child's own). */
  color?: Rgb
  bib?: boolean
  armbands?: boolean
  bag?: boolean
  cape?: boolean
  /** Face/move the other way (crawling, running, tummy time). */
  mirror?: boolean
  /** Swaddle blanket colour. */
  blanket?: Rgb
  /** Hands placed on these points (our left hand, our right hand), elbows bent to suit. */
  reach?: readonly [Point | null, Point | null]
  /** Contact shadow under the figure (off when it sits on a chair, a bike or in water). */
  shadow?: boolean
  /** Shoes on the wrong feet. */
  wrongShoes?: boolean
}

/** Where the drawn figure ended up, for props held, worn or placed around it. */
export interface Joints {
  head: Point
  R: number
  hands: [Point, Point]
  chest: Point
  hip: Point
  feet: [Point, Point]
  top: number
}

const SKIN: Rgb = [246, 212, 186]

/** Arm thickness and hand radius of a child, in head radii. */
export function limbSizes(kid: Kid): { arm: number; hand: number } {
  const body = BODIES[stageOf(kid.months)]
  return { arm: body.armW, hand: body.hand }
}

/** A forearm and hand drawn again over something the child reaches across (a table, a book). */
export function forearm(p: Painting, kid: Kid, target: Point, R: number, sleeve: Rgb, side: -1 | 1): void {
  const { arm, hand } = limbSizes(kid)
  p.add(line([[target[0] + side * 0.35 * R, target[1] - 0.95 * R], target], sleeve, arm * R, 1, 'round'))
  p.add(circle(target, hand * R, SKIN))
}

export function bareHand(p: Painting, kid: Kid, point: Point, R: number): void {
  p.add(circle(point, limbSizes(kid).hand * R, SKIN))
}
const CHEEK: Rgb = [244, 143, 160]
const LIPS: Rgb = [170, 80, 80]
const MOUTH: Rgb = [150, 60, 72]
const TONGUE: Rgb = [240, 128, 138]

interface Identity {
  hair: Rgb
  colors: readonly Rgb[]
  bottoms: Rgb
  shoes: Rgb
  blanket: Rgb
}

export const KIDS: Readonly<Record<Slug, Identity>> = {
  emma: {
    hair: rgb('#5b3a29'),
    colors: [rgb('#f472b6'), rgb('#fb7185'), rgb('#c084fc'), rgb('#fbbf24'), rgb('#f9a8d4')],
    bottoms: rgb('#6d5a9c'),
    shoes: rgb('#e0475b'),
    blanket: rgb('#f9c6d8'),
  },
  leo: {
    hair: rgb('#a0703c'),
    colors: [rgb('#60a5fa'), rgb('#34d399'), rgb('#fb923c'), rgb('#38bdf8'), rgb('#84cc16')],
    bottoms: rgb('#47648f'),
    shoes: rgb('#2f4a7a'),
    blanket: rgb('#bfdcf7'),
  },
}

export function stageOf(months: number): Stage {
  if (months < 3) return 'newborn'
  if (months < 12) return 'baby'
  if (months < 30) return 'toddler'
  return 'child'
}

interface Body {
  torso: number
  top: number
  bottom: number
  arm: number
  armW: number
  leg: number
  legW: number
  hand: number
  foot: number
}

/** Body proportions in head radii. */
const BODIES: Readonly<Record<Stage, Body>> = {
  newborn: { torso: 1.25, top: 1.35, bottom: 1.6, arm: 0.75, armW: 0.42, leg: 0.7, legW: 0.5, hand: 0.19, foot: 0.24 },
  baby: { torso: 1.4, top: 1.45, bottom: 1.75, arm: 0.95, armW: 0.44, leg: 0.85, legW: 0.54, hand: 0.2, foot: 0.26 },
  toddler: { torso: 1.55, top: 1.42, bottom: 1.6, arm: 1.2, armW: 0.38, leg: 1.3, legW: 0.46, hand: 0.19, foot: 0.3 },
  child: { torso: 1.8, top: 1.38, bottom: 1.5, arm: 1.45, armW: 0.34, leg: 1.8, legW: 0.4, hand: 0.18, foot: 0.32 },
}

/** Distance from the anchor up to the head centre, in head radii (to frame a figure). */
export function headHeight(kid: Kid, pose: Pose): number {
  const body = BODIES[stageOf(kid.months)]
  switch (pose) {
    case 'stand':
    case 'walk':
    case 'run':
      return body.leg + body.torso + 1.05 + 0.12
    case 'jump':
      return body.leg + body.torso + 1.05 + 0.7
    case 'kneel':
      return body.leg * 0.55 + body.torso + 1.05
    case 'sit':
    case 'perch':
      return body.torso + 1.05
    case 'crawl':
      return 1.55
    case 'tummy':
      return 1.15
    default:
      return 0
  }
}

// Faces and hair -----------------------------------------------------------------------------

/** The portraits' face: dark eyes with a highlight, pink cheeks and a mouth for `expression`. */
function face(p: Painting, hx: number, hy: number, R: number, expression: Expression, small = false): void {
  const eye = small ? 0.8 : 1
  const eyeY = hy + 0.13 * R
  for (const side of [-1, 1]) {
    const ex = hx + side * 0.4 * R
    if (expression === 'sleep') {
      p.add(stroke(`M${n(ex - 0.13 * R)},${n(eyeY)} Q${n(ex)},${n(eyeY + 0.11 * R)} ${n(ex + 0.13 * R)},${n(eyeY)}`, INK, 0.055 * R))
    } else if (expression === 'silly') {
      p.add(stroke(`M${n(ex - 0.14 * R)},${n(eyeY + 0.04 * R)} Q${n(ex)},${n(eyeY - 0.16 * R)} ${n(ex + 0.14 * R)},${n(eyeY + 0.04 * R)}`, INK, 0.06 * R))
    } else {
      p.add(oval([ex, eyeY], 0.14 * R * eye, 0.16 * R * eye, INK))
      p.add(circle([ex - 0.04 * R, eyeY - 0.05 * R], 0.045 * R * eye, WHITE))
    }
    p.add(oval([hx + side * 0.52 * R, hy + 0.45 * R], 0.19 * R, 0.12 * R, CHEEK, 0.43))
  }
  const smile = (rx: number, ry: number) => {
    const cy = hy + 0.46 * R
    const [sx, sy] = [hx - rx * Math.cos(Math.PI * 25 / 180), cy + ry * Math.sin(Math.PI * 25 / 180)]
    const [ex, ey] = [hx + rx * Math.cos(Math.PI * 25 / 180), sy]
    p.add(stroke(`M${n(ex)},${n(ey)} A${n(rx)},${n(ry)} 0 0,1 ${n(sx)},${n(sy)}`, LIPS, 0.065 * R))
    return [ex, ey, sx]
  }
  switch (expression) {
    case 'smile':
    case 'cream':
      smile(0.33 * R, 0.25 * R)
      break
    case 'calm':
    case 'sleep':
      smile(0.17 * R, 0.1 * R)
      break
    case 'grin':
    case 'laugh':
    case 'tooth': {
      const width = expression === 'laugh' ? 0.34 : 0.3
      const depth = expression === 'laugh' ? 1.02 : 0.92
      const d = `M${n(hx - width * R)},${n(hy + 0.42 * R)} Q${n(hx)},${n(hy + depth * R)} ${n(hx + width * R)},${n(hy + 0.42 * R)} Z`
      p.add(shape(d, MOUTH))
      p.add(oval([hx, hy + (0.42 + (depth - 0.42) * 0.42) * R], 0.14 * R, 0.07 * R, TONGUE))
      if (expression === 'tooth') p.add(rect(hx - 0.06 * R, hy + 0.58 * R, hx + 0.06 * R, hy + (0.42 + (depth - 0.42) * 0.5) * R, WHITE, 1, 0.03 * R))
      break
    }
    case 'wow':
      p.add(oval([hx, hy + 0.55 * R], 0.1 * R, 0.13 * R, MOUTH))
      break
    case 'kiss':
      p.add(oval([hx + 0.02 * R, hy + 0.52 * R], 0.08 * R, 0.07 * R, [214, 90, 112]))
      break
    case 'silly':
      p.add(oval([hx, hy + 0.55 * R], 0.2 * R, 0.11 * R, MOUTH))
      p.add(oval([hx + 0.03 * R, hy + 0.7 * R], 0.12 * R, 0.14 * R, TONGUE))
      break
  }
  if (expression === 'cream') {
    p.add(circle([hx + 0.46 * R, hy + 0.55 * R], 0.13 * R, WHITE, 0.95))
    p.add(circle([hx - 0.22 * R, hy + 0.78 * R], 0.1 * R, WHITE, 0.95))
    p.add(circle([hx + 0.05 * R, hy + 0.3 * R], 0.07 * R, WHITE, 0.95))
  }
}

/** Hair drawn behind the head (pigtails). */
function hairBehind(p: Painting, kid: Kid, hx: number, hy: number, R: number): void {
  if (kid.slug !== 'emma' || kid.months < 18) return
  const hair = KIDS.emma.hair
  const long = kid.months >= 30
  for (const side of [-1, 1]) {
    const cx = hx + side * 1.2 * R
    if (long) p.add(oval([cx + side * 0.02 * R, hy - 0.05 * R], 0.32 * R, 0.52 * R, hair, 1, side * -12))
    else p.add(circle([cx, hy - 0.35 * R], 0.35 * R, hair))
  }
}

/** Hair over the head: caps, fringe, curls, quiffs, bows and headbands. */
function hairFront(p: Painting, kid: Kid, hx: number, hy: number, R: number): void {
  const hair = KIDS[kid.slug].hair
  const cap = (centerY: number, rx: number, ry: number) =>
    p.add(shape(`M${n(hx - rx)},${n(centerY)} A${n(rx)},${n(ry)} 0 0,1 ${n(hx + rx)},${n(centerY)} Z`, hair))
  const bow = (bx: number, by: number, size: number) => {
    const pink: Rgb = [244, 114, 182]
    p.add(polygon([[bx, by], [bx - size, by - size * 0.65], [bx - size, by + size * 0.65]], pink))
    p.add(polygon([[bx, by], [bx + size, by - size * 0.65], [bx + size, by + size * 0.65]], pink))
    p.add(circle([bx, by], size * 0.32, darker(pink, 25)))
  }
  if (kid.months < 3) {
    // A newborn's wisp of hair.
    p.add(stroke(`M${n(hx - 0.12 * R)},${n(hy - 0.98 * R)} C${n(hx - 0.2 * R)},${n(hy - 1.3 * R)} ${n(hx + 0.28 * R)},${n(hy - 1.28 * R)} ${n(hx + 0.12 * R)},${n(hy - 1.04 * R)}`, hair, 0.08 * R))
    return
  }
  if (kid.months < 12) {
    cap(hy - 0.5 * R, 0.92 * R, 0.56 * R)
    if (kid.slug === 'emma') {
      p.add(stroke(`M${n(hx - 0.99 * R)},${n(hy - 0.05 * R)} Q${n(hx)},${n(hy - 1.55 * R)} ${n(hx + 0.99 * R)},${n(hy - 0.05 * R)}`, [244, 150, 196], 0.13 * R))
      bow(hx + 0.6 * R, hy - 0.86 * R, 0.2 * R)
    } else {
      p.add(oval([hx + 0.05 * R, hy - 1.07 * R], 0.18 * R, 0.1 * R, hair, 1, -20))
    }
    return
  }
  cap(hy - 0.3 * R, 1.087 * R, 0.957 * R)
  if (kid.slug === 'emma') {
    p.add(pieslice(hx - 0.87 * R, hy - 0.83 * R, hx + 0.09 * R, hy + 0.05 * R, 180, 300, hair))
    if (kid.months >= 18) for (const side of [-1, 1]) bow(hx + side * 1.05 * R, hy - 0.62 * R, 0.17 * R)
    else bow(hx + 0.55 * R, hy - 0.95 * R, 0.17 * R)
  } else {
    p.add(oval([hx, hy - 1.217 * R], 0.26 * R, 0.217 * R, hair))
    p.add(oval([hx + 0.217 * R, hy - 1.326 * R], 0.217 * R, 0.196 * R, hair))
  }
}

/** A child's head (ears, face, hair, hat) centred on (hx, hy). */
export function head(p: Painting, kid: Kid, hx: number, hy: number, R: number, expression: Expression, hat?: Hat): void {
  if (hat === 'star') starBehind(p, hx, hy, R)
  if (hat === 'sheep') for (const [dx, dy, r] of [[-0.95, -0.3, 0.42], [0.95, -0.3, 0.42], [-0.75, 0.45, 0.38], [0.75, 0.45, 0.38], [0, 0.95, 0.4]]) {
    p.add(circle([hx + dx * R, hy + dy * R], r * R, [245, 245, 240]))
  }
  if (hat === 'hood') p.add(oval([hx, hy + 0.05 * R], 1.32 * R, 1.36 * R, HOOD))
  if (!hat || hat === 'sun' || hat === 'party' || hat === 'crown' || hat === 'beanie' || hat === 'santa' || hat === 'helmet') hairBehind(p, kid, hx, hy, R)
  if (hat !== 'hood') for (const side of [-1, 1]) p.add(oval([hx + side * 1.0 * R, hy + 0.13 * R], 0.17 * R, 0.26 * R, SKIN))
  p.add(oval([hx, hy], R, 1.08 * R, SKIN))
  face(p, hx, hy, R, expression, kid.months < 3)
  if (hat !== 'sheep' && hat !== 'witch' && hat !== 'beanie' && hat !== 'santa' && hat !== 'hood') hairFront(p, kid, hx, hy, R)
  if (hat) hatOn(p, kid, hx, hy, R, hat)
}

const HOOD: Rgb = [255, 236, 179]

function starBehind(p: Painting, hx: number, hy: number, R: number): void {
  const star = Array.from({ length: 10 }, (_, point) => {
    const radius = R * (point % 2 === 0 ? 2.15 : 1.25)
    const angle = -Math.PI / 2 + (point * Math.PI) / 5
    return [hx + Math.cos(angle) * radius, hy + 0.1 * R + Math.sin(angle) * radius] as const
  })
  p.add(polygon(star, [252, 211, 77]))
  p.add(polygon(star.map(([x, y]) => [hx + (x - hx) * 0.86, hy + 0.1 * R + (y - hy - 0.1 * R) * 0.86] as const), [253, 230, 138]))
}

function hatOn(p: Painting, kid: Kid, hx: number, hy: number, R: number, hat: Hat): void {
  switch (hat) {
    case 'sun': {
      const straw: Rgb = kid.slug === 'emma' ? [250, 214, 225] : [222, 236, 250]
      p.add(oval([hx, hy - 0.5 * R], 1.6 * R, 0.33 * R, straw))
      p.add(shape(`M${n(hx - 0.92 * R)},${n(hy - 0.5 * R)} A${n(0.92 * R)},${n(0.78 * R)} 0 0,1 ${n(hx + 0.92 * R)},${n(hy - 0.5 * R)} Z`, straw))
      p.add(rect(hx - 0.92 * R, hy - 0.72 * R, hx + 0.92 * R, hy - 0.52 * R, KIDS[kid.slug].colors[0]))
      break
    }
    case 'party': {
      const tip: Point = [hx + 0.25 * R, hy - 2.15 * R]
      p.add(polygon([[hx - 0.6 * R, hy - 0.72 * R], [hx + 0.6 * R, hy - 0.72 * R], tip], [129, 140, 248]))
      for (const t of [0.3, 0.62]) {
        const y = hy - 0.72 * R - t * 1.43 * R
        const half = 0.6 * R * (1 - t)
        const cx = hx + 0.25 * R * t
        p.add(line([[cx - half, y], [cx + half, y]], [253, 224, 71], 0.12 * R, 1, 'round'))
      }
      p.add(circle(tip, 0.2 * R, [244, 114, 182]))
      break
    }
    case 'crown': {
      const base = hy - 0.62 * R
      const spikes: Point[] = [[hx - 0.95 * R, base]]
      for (let index = 0; index <= 4; index += 1) {
        const x = hx - 0.95 * R + (index * 1.9 * R) / 4
        if (index > 0) spikes.push([x - (0.95 * R) / 4, base - 0.35 * R])
        spikes.push([x, base - (index % 2 === 0 ? 0.75 : 0.6) * R])
      }
      spikes.push([hx + 0.95 * R, base])
      p.add(polygon(spikes, [250, 204, 21]))
      p.add(rect(hx - 0.95 * R, base - 0.18 * R, hx + 0.95 * R, base, [234, 179, 8]))
      for (const dx of [-0.55, 0, 0.55]) p.add(circle([hx + dx * R, base - 0.09 * R], 0.07 * R, [239, 68, 68]))
      break
    }
    case 'witch': {
      p.add(shape(`M${n(hx - 1.08 * R)},${n(hy - 0.3 * R)} A${n(1.08 * R)},${n(0.96 * R)} 0 0,1 ${n(hx + 1.08 * R)},${n(hy - 0.3 * R)} Z`, KIDS[kid.slug].hair))
      p.add(oval([hx, hy - 0.62 * R], 1.55 * R, 0.3 * R, [40, 32, 56]))
      p.add(polygon([[hx - 0.75 * R, hy - 0.7 * R], [hx + 0.75 * R, hy - 0.7 * R], [hx + 0.55 * R, hy - 2.0 * R], [hx + 1.05 * R, hy - 2.35 * R], [hx + 0.2 * R, hy - 2.05 * R]], [48, 38, 68]))
      p.add(rect(hx - 0.73 * R, hy - 0.95 * R, hx + 0.73 * R, hy - 0.75 * R, [147, 51, 234]))
      break
    }
    case 'santa': {
      p.add(polygon([[hx - 0.98 * R, hy - 0.55 * R], [hx + 0.98 * R, hy - 0.55 * R], [hx + 1.25 * R, hy - 1.15 * R], [hx + 0.2 * R, hy - 1.7 * R]], [220, 38, 38]))
      p.add(rect(hx - 1.05 * R, hy - 0.72 * R, hx + 1.05 * R, hy - 0.45 * R, WHITE, 1, 0.12 * R))
      p.add(circle([hx + 1.3 * R, hy - 1.12 * R], 0.2 * R, WHITE))
      break
    }
    case 'beanie': {
      const wool: Rgb = kid.slug === 'emma' ? [236, 72, 153] : [234, 88, 12]
      p.add(shape(`M${n(hx - 1.06 * R)},${n(hy - 0.25 * R)} A${n(1.06 * R)},${n(1.0 * R)} 0 0,1 ${n(hx + 1.06 * R)},${n(hy - 0.25 * R)} Z`, wool))
      p.add(rect(hx - 1.08 * R, hy - 0.42 * R, hx + 1.08 * R, hy - 0.18 * R, darker(wool, 30), 1, 0.1 * R))
      p.add(circle([hx, hy - 1.28 * R], 0.24 * R, [255, 247, 237]))
      break
    }
    case 'stem':
      p.add(shape(`M${n(hx - 0.7 * R)},${n(hy - 0.72 * R)} Q${n(hx)},${n(hy - 1.35 * R)} ${n(hx + 0.7 * R)},${n(hy - 0.72 * R)} Z`, [77, 124, 15]))
      p.add(stroke(`M${n(hx)},${n(hy - 1.0 * R)} q${n(0.05 * R)},${n(-0.35 * R)} ${n(0.3 * R)},${n(-0.45 * R)}`, [101, 67, 33], 0.14 * R))
      break
    case 'sheep':
      for (const [dx, dy, r] of [[-0.6, -0.95, 0.38], [0, -1.12, 0.42], [0.6, -0.95, 0.38], [-0.95, -0.45, 0.32], [0.95, -0.45, 0.32]]) {
        p.add(circle([hx + dx * R, hy + dy * R], r * R, [250, 250, 246]))
      }
      for (const side of [-1, 1]) p.add(oval([hx + side * 1.35 * R, hy - 0.3 * R], 0.36 * R, 0.17 * R, [120, 113, 108], 1, side * 25))
      break
    case 'hood':
      for (const side of [-1, 1]) {
        p.add(circle([hx + side * 0.82 * R, hy - 1.02 * R], 0.36 * R, HOOD))
        p.add(circle([hx + side * 0.82 * R, hy - 1.02 * R], 0.2 * R, [253, 205, 140]))
      }
      p.add(shape(`M${n(hx - 1.32 * R)},${n(hy + 0.05 * R)} A${n(1.32 * R)},${n(1.36 * R)} 0 0,1 ${n(hx + 1.32 * R)},${n(hy + 0.05 * R)} Q${n(hx + 0.9 * R)},${n(hy - 0.95 * R)} ${n(hx)},${n(hy - 0.82 * R)} Q${n(hx - 0.9 * R)},${n(hy - 0.95 * R)} ${n(hx - 1.32 * R)},${n(hy + 0.05 * R)} Z`, HOOD))
      break
    case 'helmet': {
      const shell: Rgb = kid.slug === 'emma' ? [168, 85, 247] : [34, 197, 94]
      p.add(shape(`M${n(hx - 1.16 * R)},${n(hy - 0.22 * R)} A${n(1.16 * R)},${n(1.12 * R)} 0 0,1 ${n(hx + 1.16 * R)},${n(hy - 0.22 * R)} Z`, shell))
      for (const dx of [-0.45, 0, 0.45]) p.add(rect(hx + dx * R - 0.08 * R, hy - 1.15 * R, hx + dx * R + 0.08 * R, hy - 0.62 * R, lighter(shell, 60), 1, 0.08 * R))
      p.add(rect(hx - 1.2 * R, hy - 0.32 * R, hx + 1.2 * R, hy - 0.16 * R, darker(shell, 35), 1, 0.08 * R))
      for (const side of [-1, 1]) p.add(line([[hx + side * 0.95 * R, hy - 0.2 * R], [hx + side * 0.62 * R, hy + 0.85 * R]], [70, 70, 80], 0.07 * R))
      break
    }
    case 'star':
      break
  }
}

// Bodies -------------------------------------------------------------------------------------

interface Colors {
  top: Rgb
  bottom: Rgb
  shoes: Rgb | null
  sleeve: Rgb
  bareArms: boolean
  bareLegs: boolean
}

function colorsOf(kid: Kid, look: Look, outfit: Outfit): Colors {
  const identity = KIDS[kid.slug]
  const own = look.color ?? identity.colors[0]
  const base = { top: own, bottom: identity.bottoms, shoes: identity.shoes as Rgb | null, sleeve: own, bareArms: false, bareLegs: false }
  switch (outfit) {
    case 'onesie': {
      const soft = lighter(own, 45)
      return { ...base, top: soft, bottom: soft, sleeve: soft, shoes: null }
    }
    case 'dress':
      return { ...base, bottom: lighter(own, 70) }
    case 'swim':
      return { ...base, bottom: kid.slug === 'emma' ? own : identity.bottoms, bareArms: true, bareLegs: true, shoes: null }
    case 'pyjamas': {
      const soft = lighter(own, 75)
      return { ...base, top: soft, bottom: soft, sleeve: soft, shoes: null }
    }
    case 'uniform':
      return { ...base, top: [37, 66, 140], sleeve: [37, 66, 140], bottom: [110, 116, 128], shoes: [44, 40, 48] }
    case 'pumpkin':
      return { ...base, top: [249, 115, 22], sleeve: [77, 124, 15], bottom: [77, 124, 15], shoes: [60, 52, 48] }
    case 'witch':
      return { ...base, top: [76, 29, 149], sleeve: [48, 38, 68], bottom: [40, 32, 56], shoes: [30, 26, 36] }
    case 'sheep':
      return { ...base, top: [248, 248, 242], sleeve: [248, 248, 242], bottom: [120, 113, 108], shoes: [70, 64, 60] }
    case 'star':
      return { ...base, top: [253, 224, 71], sleeve: [253, 224, 71], bottom: [250, 250, 245], shoes: [234, 179, 8] }
    default:
      return base
  }
}

function defaultOutfit(stage: Stage): Outfit {
  return stage === 'newborn' || stage === 'baby' ? 'onesie' : 'clothes'
}

type Limb = [Point, Point, Point]

/** Shoulder → elbow → hand for an arms pose (side -1 = the figure's right, on our left). */
function armOf(side: -1 | 1, arms: Arms, shoulder: Point, L: number, R: number, hip: number, head: Point): Limb {
  const [sx, sy] = shoulder
  const s = side
  const down: Limb = [shoulder, [sx + s * 0.14 * R, sy + 0.5 * L], [sx + s * 0.1 * R, sy + 0.95 * L]]
  switch (arms) {
    case 'out':
      return [shoulder, [sx + s * 0.5 * L, sy + 0.18 * L], [sx + s * 0.95 * L, sy + 0.08 * L]]
    case 'up':
      return [shoulder, [sx + s * 0.32 * L, sy - 0.45 * L], [sx + s * 0.38 * L, sy - 0.95 * L]]
    case 'wave':
      return s === 1 ? [shoulder, [sx + 0.45 * L, sy + 0.1 * L], [sx + 0.55 * L, sy - 0.55 * L]] : down
    case 'clap':
      return [shoulder, [sx + s * 0.28 * L, sy + 0.55 * L], [head[0] + s * 0.12 * R, sy + 0.42 * L]]
    case 'hold':
      return [shoulder, [sx + s * 0.22 * L, sy + 0.55 * L], [head[0] + s * 0.42 * R, sy + 0.72 * L]]
    case 'reach':
      return s === 1 ? [shoulder, [sx + 0.5 * L, sy + 0.02 * L], [sx + 0.98 * L, sy - 0.18 * L]] : down
    case 'point':
      return s === 1 ? [shoulder, [sx + 0.5 * L, sy + 0.12 * L], [sx + 0.98 * L, sy + 0.04 * L]] : down
    case 'hips':
      return [shoulder, [sx + s * 0.45 * L, sy + 0.42 * L], [head[0] + s * 0.62 * R, hip - 0.1 * R]]
    case 'feed':
      return s === 1 ? [shoulder, [sx + 0.38 * L, sy + 0.55 * L], [head[0] + 0.25 * R, head[1] + 0.78 * R]] : [shoulder, [sx - 0.25 * L, sy + 0.55 * L], [head[0] - 0.55 * R, sy + 0.85 * L]]
    case 'nose':
      return s === 1 ? [shoulder, [sx + 0.42 * L, sy + 0.45 * L], [head[0] + 0.08 * R, head[1] + 0.32 * R]] : down
    default:
      return down
  }
}

/** Hip → knee → foot for an upright or seated pose. */
function legOf(side: -1 | 1, pose: Pose, hip: Point, L: number, R: number): Limb {
  const [x, y] = hip
  const s = side
  switch (pose) {
    case 'walk':
      return s === -1 ? [hip, [x - 0.18 * R, y + 0.5 * L], [x - 0.4 * R, y + L]] : [hip, [x + 0.22 * R, y + 0.42 * L], [x + 0.32 * R, y + 0.9 * L]]
    case 'run':
      return s === -1 ? [hip, [x - 0.25 * R, y + 0.5 * L], [x - 0.75 * R, y + 0.72 * L]] : [hip, [x + 0.35 * R, y + 0.42 * L], [x + 0.28 * R, y + L]]
    case 'jump':
      return [hip, [x + s * 0.3 * R, y + 0.45 * L], [x + s * 0.12 * R, y + 0.85 * L]]
    case 'kneel':
      return [hip, [x + s * 0.08 * R, y + 0.55 * L], [x + s * 0.1 * R, y + L]]
    case 'sit':
      return [hip, [x + s * 0.65 * R, y + 0.05 * R], [x + s * 0.55 * R, y + 0.42 * R]]
    case 'perch':
      return [hip, [x + s * 0.06 * R, y + 0.32 * R], [x + s * 0.1 * R, y + 0.32 * R + 0.8 * L]]
    case 'back':
      return [hip, [x + s * 0.55 * R, y + 0.35 * L], [x + s * 0.35 * R, y + 0.62 * L]]
    default:
      return [hip, [x + s * 0.03 * R, y + 0.5 * L], [x + s * 0.06 * R, y + L]]
  }
}

function limb(p: Painting, [a, b, c]: Limb, color: Rgb, width: number): void {
  p.add(line([a, b, c], color, width, 1, 'round'))
}

/** Shoulder → elbow → `target`, the elbow bent outwards and down when the target is near. */
export function bendTo(shoulder: Point, target: Point, side: -1 | 1, length: number): Limb {
  const [sx, sy] = shoulder
  const [tx, ty] = target
  const slack = Math.max(0, length - Math.hypot(tx - sx, ty - sy)) / length
  return [shoulder, [(sx + tx) / 2 + side * (0.08 + 0.3 * slack) * length, (sy + ty) / 2 + (0.06 + 0.25 * slack) * length], target]
}

function chestPrint(p: Painting, kid: Kid, x: number, y: number, R: number, color: Rgb): void {
  const ink = lighter(color, 90)
  if (kid.slug === 'emma') {
    const s = 0.2 * R
    p.add(shape(`M${n(x)},${n(y + s * 0.9)} C${n(x - s * 1.4)},${n(y - s * 0.2)} ${n(x - s * 0.6)},${n(y - s * 1.2)} ${n(x)},${n(y - s * 0.35)} C${n(x + s * 0.6)},${n(y - s * 1.2)} ${n(x + s * 1.4)},${n(y - s * 0.2)} ${n(x)},${n(y + s * 0.9)} Z`, ink))
  } else {
    const star = Array.from({ length: 10 }, (_, point) => {
      const radius = R * (point % 2 === 0 ? 0.24 : 0.1)
      const angle = -Math.PI / 2 + (point * Math.PI) / 5
      return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius] as const
    })
    p.add(polygon(star, ink))
  }
}

// Children ------------------------------------------------------------------------------------

/**
 * Draws a child. `anchor` is the ground point under the feet (upright poses), under the bottom
 * (`sit`), the seat (`perch`), the ground under the body (`crawl`, `tummy`) or the body centre
 * (`back`, seen from above, and `swaddle`).
 */
export function drawKid(p: Painting, kid: Kid, pose: Pose, anchor: Point, R: number, look: Look = {}): Joints {
  let joints: Joints | null = null
  if (look.mirror && look.reach) {
    const flip = (point: Point | null): Point | null => (point ? [2 * anchor[0] - point[0], point[1]] : null)
    look = { ...look, reach: [flip(look.reach[1]), flip(look.reach[0])] }
  }
  p.mirrored(anchor[0], look.mirror ?? false, () => {
    if (pose === 'swaddle') joints = swaddled(p, kid, anchor, R, look)
    else if (pose === 'crawl') joints = crawling(p, kid, anchor, R, look)
    else if (pose === 'tummy') joints = onTummy(p, kid, anchor, R, look)
    else joints = upright(p, kid, pose, anchor, R, look)
  })
  const result = joints as unknown as Joints
  return look.mirror ? mirrorJoints(result, anchor[0]) : result
}

function mirrorJoints(joints: Joints, axis: number): Joints {
  const flip = ([x, y]: Point): Point => [2 * axis - x, y]
  return {
    ...joints,
    head: flip(joints.head),
    hands: [flip(joints.hands[1]), flip(joints.hands[0])],
    chest: flip(joints.chest),
    hip: flip(joints.hip),
    feet: [flip(joints.feet[1]), flip(joints.feet[0])],
  }
}

function upright(p: Painting, kid: Kid, pose: Pose, [ax, ay]: Point, R: number, look: Look): Joints {
  const stage = stageOf(kid.months)
  const body = BODIES[stage]
  const outfit = look.outfit ?? defaultOutfit(stage)
  const colors = colorsOf(kid, look, outfit)
  const arms = look.arms ?? (pose === 'walk' && kid.months < 18 ? 'out' : pose === 'back' ? 'up' : 'down')
  const L = body.leg * R
  let hipY: number
  if (pose === 'sit') hipY = ay - 0.12 * R
  else if (pose === 'perch') hipY = ay
  else if (pose === 'back') hipY = ay + (body.torso * R) / 2
  else if (pose === 'kneel') hipY = ay - 0.55 * L - 0.05 * R
  else hipY = ay - (pose === 'jump' ? 0.7 * R : 0) - L - 0.1 * R
  const shoulderY = hipY - body.torso * R
  const [hx, hy] = [ax, shoulderY - 1.05 * R]
  if (pose !== 'back' && pose !== 'perch' && look.shadow !== false) {
    shadow(p, [ax, ay - 0.02 * R], (pose === 'sit' ? 1.5 : 1.05) * R, 0.18 * R, pose === 'jump' ? 0.12 : 0.2)
  }
  if (look.bag) p.add(rect(hx - 0.62 * R, shoulderY + 0.05 * R, hx + 0.62 * R, shoulderY + body.torso * R * 0.85, [234, 88, 12], 1, 0.25 * R))

  // Legs and feet.
  const legW = body.legW * R
  const hipOffset = (body.bottom / 2) * R - legW * 0.55
  const legColor = colors.bareLegs ? SKIN : colors.bottom
  const legs = ([-1, 1] as const).map((side) => legOf(side, pose, [hx + side * hipOffset, hipY], L, R))
  legs.forEach((leg, index) => {
    const side = index === 0 ? -1 : 1
    limb(p, leg, legColor, legW)
    if (pose === 'kneel') return
    const [fx, fy] = leg[2]
    const angle = pose === 'sit' ? side * -35 : pose === 'back' ? side * -20 : 0
    const footColor = colors.shoes ?? (outfit === 'onesie' ? lighter(colors.bottom, 15) : SKIN)
    const toe = look.wrongShoes ? -side : side
    p.add(oval([fx + toe * 0.08 * R, fy + 0.02 * R], body.foot * R * 1.2, body.foot * R * 0.62, footColor, 1, look.wrongShoes ? side * 18 : angle))
  })

  // Body and clothes.
  const dress = outfit === 'dress' || outfit === 'witch'
  const torsoBottom = dress ? hipY + 0.45 * R : hipY + 0.18 * R
  const bottomWidth = body.bottom * R * (dress ? 1.38 : 1)
  if (outfit === 'swim' && kid.slug === 'leo') {
    p.add(trapezoid(hx, shoulderY, torsoBottom, body.top * R, bottomWidth, 0.42 * R, SKIN))
    p.add(rect(hx - bottomWidth / 2, hipY - 0.2 * R, hx + bottomWidth / 2, hipY + 0.3 * R, colors.bottom, 1, 0.12 * R))
  } else {
    p.add(trapezoid(hx, shoulderY, torsoBottom, body.top * R, bottomWidth, 0.42 * R, colors.top))
  }
  const chestY = shoulderY + 0.55 * R
  if (outfit === 'onesie') {
    for (const dy of [0.25, 0.6, 0.95]) p.add(circle([hx, shoulderY + dy * R], 0.06 * R, lighter(colors.top, 40)))
  } else if (outfit === 'clothes' || outfit === 'dress') {
    chestPrint(p, kid, hx, chestY, R, colors.top)
  } else if (outfit === 'pyjamas') {
    for (const [dx, dy] of [[-0.4, 0.35], [0.35, 0.55], [-0.1, 0.95], [0.45, 1.15], [-0.45, 1.25]]) p.add(circle([hx + dx * R, shoulderY + dy * R], 0.07 * R, darker(colors.top, 30)))
  } else if (outfit === 'uniform') {
    for (const side of [-1, 1]) p.add(polygon([[hx, shoulderY + 0.05 * R], [hx + side * 0.45 * R, shoulderY], [hx + side * 0.3 * R, shoulderY + 0.35 * R]], WHITE))
    p.add(circle([hx + 0.35 * R, chestY + 0.1 * R], 0.12 * R, [250, 204, 21]))
  } else if (outfit === 'pumpkin') {
    const cy = shoulderY + body.torso * R * 0.55
    p.add(oval([hx, cy], bottomWidth * 0.62, body.torso * R * 0.66, [249, 115, 22]))
    for (const dx of [-0.35, 0, 0.35]) p.add(stroke(`M${n(hx + dx * R)},${n(cy - body.torso * R * 0.6)} Q${n(hx + dx * 1.6 * R)},${n(cy)} ${n(hx + dx * R)},${n(cy + body.torso * R * 0.6)}`, [234, 88, 12], 0.06 * R))
  } else if (outfit === 'sheep') {
    for (const [dx, dy] of [[-0.4, 0.3], [0.4, 0.3], [0, 0.55], [-0.45, 0.85], [0.45, 0.85], [0, 1.15]]) p.add(circle([hx + dx * R, shoulderY + dy * R], 0.32 * R, [252, 252, 248]))
  } else if (outfit === 'star') {
    chestPrint(p, { slug: 'leo', months: kid.months }, hx, chestY, R, [253, 200, 40])
  }
  if (look.bib) {
    p.add(oval([hx, shoulderY + 0.42 * R], 0.6 * R, 0.5 * R, [255, 255, 255]))
    p.add(oval([hx, shoulderY + 0.42 * R], 0.46 * R, 0.37 * R, [255, 241, 224]))
  }
  p.add(rect(hx - 0.24 * R, hy + 0.7 * R, hx + 0.24 * R, shoulderY + 0.12 * R, SKIN))
  if (look.bag) for (const side of [-1, 1]) p.add(line([[hx + side * 0.5 * R, shoulderY + 0.05 * R], [hx + side * 0.55 * R, shoulderY + body.torso * R * 0.75]], [194, 65, 12], 0.12 * R, 1, 'round'))

  // Head, then arms (hands can be in front of the face).
  head(p, kid, hx, hy, R, look.expression ?? 'smile', look.hat)
  const armL = body.arm * R
  const shoulderX = (body.top / 2) * R - body.armW * R * 0.45
  const limbs = ([-1, 1] as const).map((side, index) => {
    const shoulder: Point = [hx + side * shoulderX, shoulderY + 0.22 * R]
    const target = look.reach?.[index]
    return target ? bendTo(shoulder, target, side, armL) : armOf(side, arms, shoulder, armL, R, hipY, [hx, hy])
  })
  if (look.cape) {
    p.add(trapezoid(hx, shoulderY - 0.02 * R, hipY + 0.35 * R, body.top * R * 1.15, body.bottom * R * 1.9, 0.3 * R, [45, 170, 160]))
    for (const [dx, dy] of [[-0.3, 0.4], [0.25, 0.7], [-0.1, 1.05]]) p.add(stroke(`M${n(hx + dx * R)},${n(shoulderY + dy * R)} l${n(0.14 * R)},${n(0.06 * R)}`, KIDS[kid.slug].hair, 0.05 * R))
  } else {
    for (const arm of limbs) {
      limb(p, arm, colors.bareArms ? SKIN : colors.sleeve, body.armW * R)
      if (colors.bareArms) p.add(circle(arm[0], body.armW * R * 0.62, outfit === 'swim' && kid.slug === 'leo' ? SKIN : colors.top))
      if (look.armbands) {
        const [[x0, y0], [x1, y1]] = arm
        p.add(oval([(x0 + x1) / 2, (y0 + y1) / 2], body.armW * R * 0.85, body.armW * R * 0.75, [251, 146, 60]))
      }
      p.add(circle(arm[2], body.hand * R, SKIN))
    }
  }
  return {
    head: [hx, hy],
    R,
    hands: [limbs[0][2], limbs[1][2]],
    chest: [hx, chestY],
    hip: [hx, hipY],
    feet: [legs[0][2], legs[1][2]],
    top: hy - 1.08 * R,
  }
}

function crawling(p: Painting, kid: Kid, [ax, ay]: Point, R: number, look: Look): Joints {
  const body = BODIES[stageOf(kid.months)]
  const colors = colorsOf(kid, look, look.outfit ?? defaultOutfit(stageOf(kid.months)))
  const ty = ay - 0.95 * R
  shadow(p, [ax - 0.1 * R, ay], 1.6 * R, 0.16 * R, 0.18)
  limb(p, [[ax + 0.45 * R, ty], [ax + 0.5 * R, ay - 0.45 * R], [ax + 0.55 * R, ay - 0.12 * R]], darker(colors.sleeve, 25), body.armW * R)
  p.add(oval([ax + 0.62 * R, ay - 0.1 * R], 0.2 * R, 0.12 * R, darker(SKIN, 20)))
  limb(p, [[ax - 0.75 * R, ty + 0.1 * R], [ax - 0.55 * R, ay - 0.14 * R], [ax - 1.2 * R, ay - 0.14 * R]], darker(colors.bottom, 25), body.legW * R)
  p.add(oval([ax - 0.15 * R, ty], 1.15 * R, 0.6 * R, colors.top))
  limb(p, [[ax - 0.95 * R, ty + 0.15 * R], [ax - 0.78 * R, ay - 0.12 * R], [ax - 1.45 * R, ay - 0.1 * R]], colors.bottom, body.legW * R)
  p.add(oval([ax - 1.58 * R, ay - 0.14 * R], 0.22 * R, 0.14 * R, colors.shoes ?? lighter(colors.bottom, 15)))
  const hand: Point = [ax + 0.92 * R, ay - 0.1 * R]
  limb(p, [[ax + 0.7 * R, ty + 0.05 * R], [ax + 0.78 * R, ay - 0.5 * R], [ax + 0.82 * R, ay - 0.14 * R]], colors.sleeve, body.armW * R)
  const [hx, hy] = [ax + 1.08 * R, ay - 1.62 * R]
  head(p, kid, hx, hy, R, look.expression ?? 'grin', look.hat)
  p.add(oval(hand, 0.22 * R, 0.13 * R, SKIN))
  return { head: [hx, hy], R, hands: [[ax + 0.62 * R, ay - 0.1 * R], hand], chest: [ax + 0.4 * R, ty], hip: [ax - 0.8 * R, ty], feet: [[ax - 1.2 * R, ay], [ax - 1.58 * R, ay]], top: hy - 1.08 * R }
}

function onTummy(p: Painting, kid: Kid, [ax, ay]: Point, R: number, look: Look): Joints {
  const body = BODIES[stageOf(kid.months)]
  const colors = colorsOf(kid, look, look.outfit ?? defaultOutfit(stageOf(kid.months)))
  shadow(p, [ax - 0.3 * R, ay], 1.8 * R, 0.14 * R, 0.16)
  p.add(oval([ax - 1.45 * R, ay - 0.3 * R], 0.62 * R, 0.25 * R, colors.bottom, 1, -6))
  p.add(oval([ax - 2.05 * R, ay - 0.42 * R], 0.2 * R, 0.14 * R, lighter(colors.bottom, 15), 1, -40))
  limb(p, [[ax + 0.3 * R, ay - 0.5 * R], [ax + 0.55 * R, ay - 0.2 * R], [ax + 1.05 * R, ay - 0.16 * R]], darker(colors.sleeve, 20), body.armW * R)
  p.add(oval([ax - 0.3 * R, ay - 0.45 * R], 1.2 * R, 0.45 * R, colors.top))
  const [hx, hy] = [ax + 0.72 * R, ay - 1.22 * R]
  head(p, kid, hx, hy, R, look.expression ?? 'smile', look.hat)
  const hand: Point = [ax + 1.35 * R, ay - 0.14 * R]
  limb(p, [[ax + 0.1 * R, ay - 0.35 * R], [ax + 0.45 * R, ay - 0.14 * R], [ax + 1.2 * R, ay - 0.14 * R]], colors.sleeve, body.armW * R)
  p.add(oval(hand, 0.2 * R, 0.13 * R, SKIN))
  return { head: [hx, hy], R, hands: [[ax + 1.05 * R, ay - 0.16 * R], hand], chest: [ax + 0.2 * R, ay - 0.5 * R], hip: [ax - 0.9 * R, ay - 0.45 * R], feet: [[ax - 2.05 * R, ay], [ax - 2.05 * R, ay]], top: hy - 1.08 * R }
}

function swaddled(p: Painting, kid: Kid, [ax, ay]: Point, R: number, look: Look): Joints {
  const blanket = look.blanket ?? KIDS[kid.slug].blanket
  p.add(oval([ax, ay - 0.98 * R], 1.24 * R, 1.24 * R, darker(blanket, 10)))
  p.add(oval([ax, ay + 0.55 * R], 1.05 * R, 1.55 * R, blanket))
  head(p, kid, ax, ay - 0.95 * R, R, look.expression ?? 'calm', look.hat)
  const fold = `M${n(ax - 1.0 * R)},${n(ay + 0.08 * R)} Q${n(ax)},${n(ay - 0.18 * R)} ${n(ax + 1.0 * R)},${n(ay + 0.28 * R)} L${n(ax + 0.95 * R)},${n(ay + 0.78 * R)} Q${n(ax)},${n(ay + 0.48 * R)} ${n(ax - 0.98 * R)},${n(ay + 0.58 * R)} Z`
  p.add(shape(fold, lighter(blanket, 18)))
  for (const [dx, dy] of [[-0.45, 0.95], [0.35, 1.25], [-0.1, 1.6], [0.5, 0.7]]) p.add(circle([ax + dx * R, ay + dy * R], 0.07 * R, WHITE, 0.8))
  const chest: Point = [ax, ay + 0.3 * R]
  return { head: [ax, ay - 0.95 * R], R, hands: [chest, chest], chest, hip: [ax, ay + 1.0 * R], feet: [[ax, ay + 2.1 * R], [ax, ay + 2.1 * R]], top: ay - 2.2 * R }
}

// Grown-ups ----------------------------------------------------------------------------------

export type Adult = 'mum' | 'dad' | 'grandma' | 'grandpa'
/** `hold` cradles a baby in front of the chest; `hand` gives a hand to a child on the right. */
export type AdultArms = 'side' | 'hold' | 'hand' | 'reach' | 'hug' | 'wave'

interface Grown {
  skin: Rgb
  hair: Rgb
  top: Rgb
  trousers: Rgb
}

const GROWN: Readonly<Record<Adult, Grown>> = {
  mum: { skin: [240, 202, 176], hair: rgb('#6b4226'), top: rgb('#e07a5f'), trousers: rgb('#3f4a6b') },
  dad: { skin: [236, 196, 168], hair: rgb('#3b2a20'), top: rgb('#3d5a80'), trousers: rgb('#4b5563') },
  grandma: { skin: [244, 212, 192], hair: rgb('#d4cdc6'), top: rgb('#a78bcf'), trousers: rgb('#57534e') },
  grandpa: { skin: [238, 202, 178], hair: rgb('#dad4ce'), top: rgb('#7a8b5c'), trousers: rgb('#5b5048') },
}

function grownHead(p: Painting, who: Adult, hx: number, hy: number, R: number, expression: Expression): void {
  const { skin, hair } = GROWN[who]
  for (const side of [-1, 1]) p.add(oval([hx + side * 0.98 * R, hy + 0.12 * R], 0.16 * R, 0.24 * R, skin))
  p.add(oval([hx, hy], 0.98 * R, 1.12 * R, skin))
  if (who === 'dad') p.add(shape(`M${n(hx - 0.8 * R)},${n(hy + 0.25 * R)} Q${n(hx)},${n(hy + 1.55 * R)} ${n(hx + 0.8 * R)},${n(hy + 0.25 * R)} Q${n(hx)},${n(hy + 0.95 * R)} ${n(hx - 0.8 * R)},${n(hy + 0.25 * R)} Z`, darker(skin, 45), 0.35))
  face(p, hx, hy, R, expression, true)
  const cap = (centerY: number, rx: number, ry: number, color: Rgb) =>
    p.add(shape(`M${n(hx - rx)},${n(centerY)} A${n(rx)},${n(ry)} 0 0,1 ${n(hx + rx)},${n(centerY)} Z`, color))
  switch (who) {
    case 'mum':
      cap(hy - 0.25 * R, 1.1 * R, 0.98 * R, hair)
      p.add(shape(`M${n(hx - 1.05 * R)},${n(hy - 0.3 * R)} Q${n(hx - 0.2 * R)},${n(hy - 0.15 * R)} ${n(hx + 0.35 * R)},${n(hy - 0.95 * R)} L${n(hx - 0.6 * R)},${n(hy - 1.0 * R)} Z`, hair))
      break
    case 'dad':
      cap(hy - 0.4 * R, 1.06 * R, 0.82 * R, hair)
      for (const side of [-1, 1]) p.add(rect(hx + side * 0.98 * R - 0.08 * R, hy - 0.45 * R, hx + side * 0.98 * R + 0.08 * R, hy + 0.05 * R, hair, 1, 0.06 * R))
      break
    case 'grandma':
      cap(hy - 0.3 * R, 1.08 * R, 0.92 * R, hair)
      p.add(circle([hx, hy - 1.22 * R], 0.42 * R, hair))
      break
    case 'grandpa':
      for (const side of [-1, 1]) p.add(oval([hx + side * 0.92 * R, hy - 0.12 * R], 0.2 * R, 0.42 * R, hair))
      p.add(oval([hx, hy + 0.36 * R], 0.3 * R, 0.09 * R, hair))
      break
  }
  if (who === 'grandma' || who === 'grandpa') {
    for (const side of [-1, 1]) p.add(`<circle cx="${n(hx + side * 0.4 * R)}" cy="${n(hy + 0.13 * R)}" r="${n(0.24 * R)}" fill="none" stroke="#5b4636" stroke-width="${n(0.06 * R)}"/>`)
    p.add(line([[hx - 0.16 * R, hy + 0.1 * R], [hx + 0.16 * R, hy + 0.1 * R]], [91, 70, 54], 0.06 * R))
  }
}

/**
 * Draws a grown-up whose feet (or, cropped, whose body) rest on `anchor`. `between` draws what they
 * hold (a baby, a child's hand) between their body and the arm that goes in front of it.
 */
export function drawAdult(
  p: Painting,
  who: Adult,
  anchor: Point,
  R: number,
  {
    arms = 'side',
    mirror = false,
    kneel = false,
    expression = 'smile',
    target,
  }: { arms?: AdultArms; mirror?: boolean; kneel?: boolean; expression?: Expression; target?: Point } = {},
  between?: (cradle: Point) => void,
): Joints {
  const { skin, hair, top, trousers } = GROWN[who]
  const [ax, ay] = anchor
  /** Where the front hand goes (`hand`, `reach`, `hug`), in the unmirrored drawing. */
  const aim: Point | undefined = target && mirror ? [2 * ax - target[0], target[1]] : target
  let result: Joints | null = null
  p.mirrored(ax, mirror, () => {
    const hipY = kneel ? ay - 1.5 * R : ay - 3.4 * R
    const shoulderY = hipY - 2.9 * R
    const [hx, hy] = [ax, shoulderY - 1.2 * R]
    if (who === 'mum') p.add(oval([hx, hy + 0.65 * R], 1.28 * R, 1.75 * R, hair))
    if (!kneel) shadow(p, [ax, ay], 1.6 * R, 0.2 * R, 0.18)
    for (const side of [-1, 1]) {
      const hip: Point = [hx + side * 0.55 * R, hipY]
      const knee: Point = kneel ? [hx + side * 0.75 * R, ay - 0.25 * R] : [hx + side * 0.6 * R, hipY + 1.7 * R]
      const foot: Point = kneel ? [hx + side * 0.2 * R, ay - 0.2 * R] : [hx + side * 0.62 * R, ay - 0.15 * R]
      p.add(line([hip, knee, foot], trousers, 0.7 * R, 1, 'round'))
      if (!kneel) p.add(oval([foot[0] + side * 0.12 * R, ay - 0.12 * R], 0.36 * R, 0.17 * R, [92, 64, 51]))
    }
    p.add(trapezoid(hx, shoulderY, hipY + 0.25 * R, 2.45 * R, 2.2 * R, 0.6 * R, top))
    if (who === 'grandma') for (const dy of [0.5, 1.2, 1.9]) p.add(circle([hx, shoulderY + dy * R], 0.08 * R, lighter(top, 50)))
    p.add(rect(hx - 0.3 * R, hy + 0.8 * R, hx + 0.3 * R, shoulderY + 0.2 * R, skin))
    grownHead(p, who, hx, hy, R, expression)
    const shoulder = (side: -1 | 1): Point => [hx + side * 1.0 * R, shoulderY + 0.35 * R]
    const arm = (points: Point[]) => {
      p.add(line(points, top, 0.55 * R, 1, 'round'))
      p.add(circle(points[points.length - 1], 0.24 * R, skin))
    }
    const cradle: Point = [hx + 0.1 * R, shoulderY + 1.55 * R]
    let hands: [Point, Point] = [[hx - 1.1 * R, hipY], [hx + 1.1 * R, hipY]]
    switch (arms) {
      case 'hold': {
        arm([shoulder(-1), [hx - 1.25 * R, shoulderY + 1.5 * R], [hx - 0.2 * R, shoulderY + 2.1 * R]])
        // The upper arm goes behind what is held, the forearm under it.
        const elbow: Point = [hx + 1.45 * R, shoulderY + 1.9 * R]
        p.add(line([shoulder(1), elbow], top, 0.55 * R, 1, 'round'))
        between?.(cradle)
        arm([elbow, [hx - 0.5 * R, shoulderY + 2.2 * R]])
        hands = [[hx - 0.2 * R, shoulderY + 2.1 * R], [hx - 0.5 * R, shoulderY + 2.2 * R]]
        break
      }
      case 'hand': {
        arm([shoulder(-1), [hx - 1.2 * R, shoulderY + 1.3 * R], [hx - 1.1 * R, hipY - 0.1 * R]])
        between?.(cradle)
        const front = aim ? bendTo(shoulder(1), aim, 1, 3.1 * R) : [shoulder(1), [hx + 1.35 * R, shoulderY + 1.3 * R], [hx + 2.0 * R, hipY + 0.2 * R]] as const
        arm([...front])
        hands = [[hx - 1.1 * R, hipY - 0.1 * R], front[2]]
        break
      }
      case 'reach': {
        const front = aim ? bendTo(shoulder(1), aim, 1, 3.1 * R) : [shoulder(1), [hx + 1.6 * R, shoulderY + 1.0 * R], [hx + 2.7 * R, shoulderY + 0.75 * R]] as const
        const back: Point = [front[2][0] - 0.8 * R, front[2][1] + 0.3 * R]
        arm([shoulder(-1), [hx + 0.4 * R, (shoulderY + back[1]) / 2 + 0.5 * R], back])
        between?.(cradle)
        arm([...front])
        hands = [back, front[2]]
        break
      }
      case 'hug': {
        arm([shoulder(-1), [hx - 1.2 * R, shoulderY + 1.3 * R], [hx - 1.0 * R, hipY - 0.1 * R]])
        between?.(cradle)
        const front = aim ? bendTo(shoulder(1), aim, 1, 3.1 * R) : [shoulder(1), [hx + 1.45 * R, shoulderY + 0.9 * R], [hx + 2.6 * R, shoulderY + 1.2 * R]] as const
        arm([...front])
        hands = [[hx - 1.0 * R, hipY - 0.1 * R], front[2]]
        break
      }
      case 'wave':
        arm([shoulder(-1), [hx - 1.2 * R, shoulderY + 1.3 * R], [hx - 1.1 * R, hipY - 0.1 * R]])
        arm([shoulder(1), [hx + 1.55 * R, shoulderY + 0.4 * R], [hx + 1.75 * R, shoulderY - 0.85 * R]])
        between?.(cradle)
        hands = [[hx - 1.1 * R, hipY - 0.1 * R], [hx + 1.75 * R, shoulderY - 0.85 * R]]
        break
      default:
        arm([shoulder(-1), [hx - 1.2 * R, shoulderY + 1.3 * R], [hx - 1.1 * R, hipY - 0.1 * R]])
        arm([shoulder(1), [hx + 1.2 * R, shoulderY + 1.3 * R], [hx + 1.1 * R, hipY - 0.1 * R]])
        between?.(cradle)
    }
    result = { head: [hx, hy], R, hands, chest: cradle, hip: [hx, hipY], feet: [[hx - 0.6 * R, ay], [hx + 0.6 * R, ay]], top: hy - 1.2 * R }
  })
  const joints = result as unknown as Joints
  return mirror ? mirrorJoints(joints, ax) : joints
}
