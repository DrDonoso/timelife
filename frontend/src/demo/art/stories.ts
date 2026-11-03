/**
 * What the demo photos show: Emma and Leo living each milestone (asleep in Mum's arms, the first
 * spoonful of purée, first steps towards Dad, the giraffes at the zoo…), composed from the figures,
 * props and backdrops. Photos of one milestone vary (close-ups, wide shots, the grown-ups their
 * names mention) and keep their subject around the centre, so the square thumbnail shows it.
 */
import type { Random } from '../random'
import {
  KIDS,
  bareHand,
  drawAdult,
  drawKid,
  forearm,
  head,
  headHeight,
  type Adult,
  type AdultArms,
  type Expression,
  type Hat,
  type Joints,
  type Kid,
  type Look,
  type Pose,
  type Slug,
} from './figures'
import { INK, WHITE, circle, lighter, line, n, oval, polygon, rect, stroke, text, type Painting, type Point, type Rgb } from './paint'
import {
  ball,
  balanceBike,
  balloons,
  bed,
  bigBox,
  biscuits,
  blocks,
  book,
  bookBag,
  bouncer,
  bowl,
  broom,
  bubble,
  bucket,
  bunny,
  bunting,
  cake,
  carSeat,
  carrotSeedling,
  cracker,
  crayons,
  cup,
  eggAndSpoon,
  fence,
  finishTape,
  fireplace,
  giraffe,
  hairBits,
  heart,
  heldCrayon,
  highChair,
  iceCream,
  jackOLantern,
  leaves,
  medal,
  motion,
  notes,
  pancakes,
  paper,
  pegs,
  penguin,
  playGym,
  present,
  puddle,
  pumpkinBucket,
  puzzle,
  puzzlePiece,
  pushchair,
  rattle,
  roast,
  rockPool,
  rotated,
  salonChair,
  sandcastle,
  schoolGate,
  scissors,
  shapeSorter,
  sofa,
  sorterShape,
  spade,
  sparks,
  spoon,
  stacker,
  star,
  stocking,
  swing,
  tableTop,
  teaSet,
  teddy,
  treats,
  trike,
  vegPatch,
  wateringCan,
  babyBath,
  type CakeTheme,
  type Drawing,
} from './props'
import { frameOf, paintBackdrop, water, type Backdrop, type Frame, type Place } from './scenes'

/** One photo of a milestone. */
export interface Moment {
  /** The milestone's children (Emma first), with their age in months that day. */
  cast: readonly Kid[]
  /** Both children's ages that day, in months (negative before birth). */
  ages: Readonly<Record<Slug, number>>
  /** The photo's name ("First cuddle", "With Dad", "The giraffes"…). */
  caption: string
  /** Position of the photo in its milestone. */
  index: number
  /** The day's clothes (index into each child's colours). */
  outfit: number
}

type Cue = Adult | 'grandparents' | 'family' | null

/** Head size of a child next to grown-ups (newborn 0.62 … preschooler 0.9 of an adult's). */
const scaleOf = (months: number) => 0.62 + 0.28 * Math.sqrt(Math.min(Math.max(months, 0), 48) / 48)
/** Height of a figure, feet to the top of the head, in head radii. */
const tall = (kid: Kid, pose: Pose = 'stand') => headHeight(kid, pose) + 1.15
const PALETTE: readonly Rgb[] = [[244, 114, 182], [96, 165, 250], [250, 204, 21], [74, 222, 128], [192, 132, 252], [251, 146, 60]]
const MUM_SLEEVE: Rgb = [224, 122, 95]

export class Shot {
  readonly p: Painting
  readonly f: Frame
  readonly random: Random
  readonly hue: number
  readonly moment: Moment
  /** Side for the window, the tree or the grown-up, so photos of a milestone differ. */
  readonly side: -1 | 1

  constructor(p: Painting, random: Random, hue: number, moment: Moment) {
    this.p = p
    this.f = frameOf(p)
    this.random = random
    this.hue = hue
    this.moment = moment
    this.side = random.random() < 0.5 ? -1 : 1
  }

  get caption(): string {
    return this.moment.caption
  }

  get index(): number {
    return this.moment.index
  }

  get main(): Kid {
    return this.moment.cast[0]
  }

  /** The second child of a milestone of both. */
  get pair(): Kid | null {
    return this.moment.cast[1] ?? null
  }

  kid(slug: Slug): Kid {
    return { slug, months: this.moment.ages[slug] }
  }

  /** The other child, when already born (to join a photo the notes mention them in). */
  sibling(of: Kid): Kid | null {
    const other = this.kid(of.slug === 'emma' ? 'leo' : 'emma')
    return other.months >= 0 ? other : null
  }

  /** Both children of the milestone, or the main one and the sibling. */
  get both(): readonly [Kid, Kid] | null {
    if (this.pair) return [this.main, this.pair]
    return null
  }

  color(slug: Slug): Rgb {
    const colors = KIDS[slug].colors
    return colors[this.moment.outfit % colors.length]
  }

  is(pattern: RegExp): boolean {
    return pattern.test(this.caption)
  }

  /** The grown-ups the photo's name mentions. */
  cue(): Cue {
    if (this.is(/grandma and grandpa/i)) return 'grandparents'
    if (this.is(/whole family|family time/i)) return 'family'
    if (this.is(/mum|cuddle/i)) return 'mum'
    if (this.is(/dad/i)) return 'dad'
    return null
  }

  /** Index-based choice: the first photo gets the first option, the others vary. */
  pick<T>(options: readonly T[]): T {
    return this.index === 0 ? options[0] : options[(this.index + this.random.below(options.length)) % options.length]
  }

  backdrop(kind: Backdrop, ground: number, extra: Partial<Place> = {}): Place {
    const place: Place = { ground, side: this.side, ...extra }
    paintBackdrop(this.p, this.f, kind, this.random, this.hue, place)
    return place
  }

  child(kid: Kid, pose: Pose, anchor: Point, R: number, look: Look = {}): Joints {
    return drawKid(this.p, kid, pose, anchor, R, { color: this.color(kid.slug), ...look })
  }

  grown(who: Adult, anchor: Point, R: number, options: { arms?: AdultArms; mirror?: boolean; kneel?: boolean; expression?: Expression; target?: Point } = {}, between?: (cradle: Point) => void): Joints {
    return drawAdult(this.p, who, anchor, R, options, between)
  }

  /** Head radius that makes a figure `height` head radii tall fill `fill` of the square. */
  fit(height: number, fill: number): number {
    return (this.f.unit * fill) / height
  }

  /** Head centre of an upright figure standing (sitting…) on `anchor`. */
  headOf(kid: Kid, pose: Pose, [x, y]: Point, R: number): Point {
    return [x, y - headHeight(kid, pose) * R]
  }

  sleeve(kid: Kid): Rgb {
    return this.color(kid.slug)
  }

  say(words: string, mouth: Point, R: number, toward: -1 | 1 = 1): void {
    const size = Math.max(this.f.unit * 0.04, R * 0.42)
    const width = Math.max(words.length * size * 0.6 + size * 1.3, size * 2.4)
    const x = Math.min(this.f.X(0.98) - width / 2, Math.max(this.f.X(0.02) + width / 2, mouth[0] + toward * (width * 0.35 + R * 0.8)))
    bubble(this.p, [x, Math.max(this.f.Y(0.08), mouth[1] - R * 2.3)], words, size, [mouth[0] + toward * R * 0.55, mouth[1] - R * 0.35])
  }

  /** Head and shoulders of `kid` filling the square. */
  closeUp(kid: Kid, backdrop: Backdrop, look: Look = {}, extra: Partial<Place> = {}): Joints {
    const { f } = this
    this.backdrop(backdrop, f.Y(1.25), extra)
    const R = f.unit * 0.2
    if (kid.months < 1) return this.child(kid, 'swaddle', [f.cx, f.Y(0.46) + 0.95 * R], R, look)
    return this.child(kid, 'sit', [f.cx, f.Y(0.44) + headHeight(kid, 'sit') * R], R, { shadow: false, ...look })
  }

  /** A baby lying on a blanket, seen from above. */
  fromAbove(kid: Kid, look: Look = {}, size = 0.17, color?: Rgb): Joints {
    const { f } = this
    this.backdrop('blanket', f.Y(1), { color: color ?? lighter(KIDS[kid.slug].blanket, 8) })
    const R = f.unit * size
    if (kid.months < 0.6) return this.child(kid, 'swaddle', [f.cx, f.Y(0.5) + 0.1 * R], R, look)
    return this.child(kid, 'back', [f.cx, f.Y(0.5) + 0.75 * R], R, look)
  }

  /** A swaddled baby lying at an angle (in arms, in a bouncer or a car seat). */
  lying(kid: Kid, at: Point, R: number, angle: number, look: Look = {}): void {
    rotated(this.p, at, angle, () => this.child(kid, 'swaddle', at, R, { expression: 'sleep', ...look }))
  }

  /** A grown-up holding a child: a newborn cradled, an older baby sitting on the arm. */
  holding(who: Adult, kid: Kid, anchor: Point, Ra: number, look: Look = {}, options: { mirror?: boolean; kneel?: boolean; expression?: Expression } = {}): Joints {
    const R = Ra * scaleOf(kid.months)
    const flip = options.mirror ? -1 : 1
    return this.grown(who, anchor, Ra, { arms: 'hold', ...options }, ([cx, cy]) => {
      if (kid.months < 2.5) this.lying(kid, [cx + flip * 0.25 * Ra, cy - 0.1 * Ra], R, flip * -62, { expression: 'sleep', ...look })
      else this.child(kid, 'perch', [cx + flip * 0.7 * Ra, cy + 0.5 * Ra], R, { shadow: false, mirror: options.mirror, ...look })
    })
  }

  /** A grown-up holding the child, close (from the hips up) or whole. */
  cradled(who: Adult, kid: Kid, backdrop: Backdrop, look: Look = {}, close = true, extra: Partial<Place> = {}): void {
    const { f } = this
    const Ra = f.unit * (close ? 0.145 : 0.108)
    const ground = close ? f.Y(1.32) : f.Y(0.98)
    this.backdrop(backdrop, close ? f.Y(1.1) : ground, extra)
    this.holding(who, kid, [f.cx - this.side * 0.05 * f.unit, ground], Ra, look, { mirror: this.side > 0, expression: 'smile' })
  }

  /** Grandma holding the younger child, Grandpa beside them (with the older one, if any). */
  grandparents(kids: readonly Kid[], backdrop: Backdrop, extra: Partial<Place> = {}, dress: (kid: Kid) => Look = () => ({})): void {
    const { f } = this
    const ground = f.Y(0.98)
    this.backdrop(backdrop, ground, extra)
    const Ra = f.unit * 0.1
    const younger = kids.reduce((a, b) => (a.months <= b.months ? a : b))
    const older = kids.find((kid) => kid !== younger) ?? null
    this.grown('grandpa', [f.X(0.3), ground], Ra, { arms: older ? 'hand' : 'wave', expression: 'grin', target: older ? [f.X(0.5), ground - 2.6 * Ra] : undefined })
    if (older) {
      const R = Ra * scaleOf(older.months)
      this.child(older, 'stand', [f.X(0.53), ground], R, { reach: [[f.X(0.5), ground - 2.6 * Ra], null], expression: 'grin', ...dress(older) })
    }
    this.holding('grandma', younger, [f.X(older ? 0.76 : 0.66), ground], Ra, { expression: 'grin', ...dress(younger) }, { mirror: true })
  }

  /** Mum and Dad with the children. */
  family(kids: readonly Kid[], backdrop: Backdrop, extra: Partial<Place> = {}, dress: (kid: Kid) => Look = () => ({})): void {
    const { f } = this
    const ground = f.Y(0.98)
    this.backdrop(backdrop, ground, extra)
    const Ra = f.unit * 0.1
    const [youngest, ...rest] = [...kids].toSorted((a, b) => a.months - b.months)
    this.holding('mum', youngest, [f.X(0.32), ground], Ra, { expression: 'grin', ...dress(youngest) })
    if (rest.length) {
      const older = rest[0]
      const R = Ra * scaleOf(older.months)
      const hand: Point = [f.X(0.64), ground - 2.9 * Ra]
      this.child(older, 'stand', [f.X(0.6), ground], R, { reach: [null, hand], expression: 'laugh', ...dress(older) })
      this.grown('dad', [f.X(0.8), ground], Ra, { arms: 'hand', mirror: true, target: hand, expression: 'grin' })
    } else {
      this.grown('dad', [f.X(0.7), ground], Ra, { arms: 'wave', mirror: true, expression: 'grin' })
    }
  }

  /** The kids at a table seen across it (from the waist up), with things on the table. */
  atTable(kids: readonly { kid: Kid; x: number; look?: Look; reach?: Point | null }[], backdrop: Backdrop, edge: number, cloth: Rgb | undefined, things: (R: number) => void, extra: Partial<Place> = {}): Joints[] {
    const { f } = this
    this.backdrop(backdrop, edge + f.unit * 0.12, extra)
    const R = f.unit * 0.125
    const placed = kids.map(({ kid, x, look, reach }) => {
      const r = (R * scaleOf(kid.months)) / scaleOf(36)
      // Feet below the table, the far edge of the table at the waist.
      const ground = edge + (headHeight(kid, 'stand') - headHeight(kid, 'sit') + 0.2) * r
      const target = reach ?? null
      const joints = this.child(kid, 'stand', [x, ground], r, { reach: target ? [null, target] : undefined, shadow: false, ...look })
      return { kid, r, target, joints }
    })
    tableTop(this.p, edge, [222, 184, 135], cloth)
    things(R)
    for (const { kid, r, target } of placed) if (target) forearm(this.p, kid, target, r, this.sleeve(kid), 1)
    return placed.map(({ joints }) => joints)
  }
}

export type Story = (s: Shot) => void

// Babies ---------------------------------------------------------------------------------------

function nameCard(s: Shot, name: string): void {
  const { f, p } = s
  const [x, y] = [s.side > 0 ? f.X(0.8) : f.X(0.2), f.Y(0.84)]
  rotated(p, [x, y], s.side * 6, () => {
    p.add(rect(x - f.unit * 0.15, y - f.unit * 0.07, x + f.unit * 0.15, y + f.unit * 0.07, WHITE, 1, f.unit * 0.015))
    p.add(rect(x - f.unit * 0.14, y - f.unit * 0.06, x + f.unit * 0.14, y + f.unit * 0.06, lighter(s.color(s.main.slug), 60), 1, f.unit * 0.012))
    p.add(text([x, y + f.unit * 0.018], `Hello, ${name}`, f.unit * 0.042, INK))
  })
}

const NAMES: Readonly<Record<Slug, string>> = { emma: 'Emma', leo: 'Leo' }

const newborn: Story = (s) => {
  const kid = s.main
  const cue = s.cue()
  if (cue === 'grandparents') return s.grandparents([kid], 'home')
  if (cue === 'mum' || cue === 'dad') return s.cradled(cue, kid, 'hospital', {}, s.index % 2 === 1)
  if (s.is(/camera|quiet/i)) {
    s.closeUp(kid, 'hospital', { expression: s.is(/camera/i) ? 'calm' : 'sleep' })
    return
  }
  if (s.is(/home|living/i)) return s.cradled(s.index % 2 ? 'dad' : 'mum', kid, 'home', {}, false)
  s.fromAbove(kid, { expression: s.index % 3 === 2 ? 'calm' : 'sleep' }, 0.19)
  nameCard(s, NAMES[kid.slug])
}

const homecoming: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  if (s.is(/cot/i)) {
    s.backdrop('cot', f.Y(1), { color: lighter(KIDS[kid.slug].blanket, 14) })
    s.child(kid, 'swaddle', [f.cx, f.Y(0.52)], f.unit * 0.17, { expression: 'sleep' })
    teddy(p, [f.X(0.8), f.Y(0.92)], f.unit * 0.06)
    return
  }
  const sister = s.sibling(kid)
  if (sister && (s.index === 0 || s.is(/home|living|quiet/i))) {
    // Emma shows the new baby her toys.
    const ground = f.Y(0.9)
    s.backdrop('home', ground)
    const R = s.fit(tall(sister), 0.56)
    const babyR = (R * scaleOf(kid.months)) / scaleOf(sister.months)
    const seat: Point = [f.X(0.33), ground - 1.6 * babyR]
    bouncer(p, seat, babyR, s.color(kid.slug), ground)
    s.lying(kid, seat, babyR, -35, { expression: 'calm' })
    const at: Point = [f.X(0.68), ground]
    const [hx, hy] = s.headOf(sister, 'stand', at, R)
    s.child(sister, 'stand', at, R, { reach: [[hx - 1.6 * R, hy + 1.6 * R], null], expression: 'grin' })
    teddy(p, [hx - 1.8 * R, hy + 2.3 * R], 0.55 * R)
    return
  }
  if (s.index === 0 || s.is(/coming home/i)) {
    const ground = f.Y(0.88)
    s.backdrop('home', ground)
    bunting(p, f.X(0.05), f.X(0.95), f.Y(0.06), f.unit * 0.05, f.unit * 0.045, PALETTE, 'WELCOME HOME')
    const R = f.unit * 0.11
    const close = carSeat(p, [f.cx, ground], R, [71, 85, 105])
    s.lying(kid, [f.cx - 0.2 * R, ground - 1.9 * R], R, -22, { expression: 'sleep' })
    close()
    return
  }
  newborn(s)
}

const bath: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  if (s.is(/towel/i)) {
    s.backdrop('bathroom', f.Y(1.2))
    const R = f.unit * 0.2
    s.child(kid, 'swaddle', [f.cx, f.Y(0.5) + 0.95 * R], R, { hat: 'hood', blanket: [255, 236, 179], expression: 'calm' })
    return
  }
  const ground = f.Y(1.05)
  s.backdrop('bathroom', ground)
  const R = f.unit * 0.14
  const rim = f.Y(0.66)
  const front = babyBath(p, [f.cx, rim], R, [125, 211, 252])
  const j = s.child(kid, 'sit', [f.cx, rim + 0.85 * R], R, { outfit: 'swim', color: [246, 212, 186], arms: 'out', expression: s.index === 0 ? 'wow' : 'laugh', shadow: false })
  front()
  for (const hand of j.hands) for (const [dx, dy] of [[-0.3, -0.5], [0.25, -0.65], [0, -0.85]]) p.add(oval([hand[0] + dx * R, hand[1] + dy * R], 0.06 * R, 0.1 * R, [125, 211, 252]))
}

const smile: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const sister = s.sibling(kid)
  if (kid.slug === 'leo' && sister && s.index === 0) {
    // His sister pulling faces, and his first smile.
    const ground = f.Y(0.9)
    s.backdrop('home', ground)
    const R = s.fit(tall(sister, 'kneel'), 0.5)
    const babyR = (R * scaleOf(kid.months)) / scaleOf(sister.months)
    const seat: Point = [f.X(0.34), ground - 1.6 * babyR]
    bouncer(p, seat, babyR, s.color(kid.slug), ground)
    s.lying(kid, seat, babyR, -35, { expression: 'smile' })
    const at: Point = [f.X(0.7), ground]
    const [hx, hy] = s.headOf(sister, 'kneel', at, R)
    s.child(sister, 'kneel', at, R, { expression: 'silly', reach: [[hx - 1.2 * R, hy - 0.1 * R], [hx + 1.2 * R, hy - 0.1 * R]] })
    sparks(p, [seat[0], seat[1] - 2.6 * babyR], babyR)
    return
  }
  const cue = s.cue() ?? (s.is(/dad/i) ? 'dad' : null)
  if (cue === 'mum' || cue === 'dad') return s.cradled(cue, kid, 'home', { expression: 'smile' })
  if (s.is(/smile/i) || s.index === 0) {
    s.fromAbove(kid, { expression: 'smile', arms: 'up' }, 0.2)
    return
  }
  s.closeUp(kid, 'home', { expression: 'smile' })
}

const tummy: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.78)
  s.backdrop('playroom', ground)
  const R = f.unit * 0.15
  const mirror = s.index % 2 === 1
  const flip = mirror ? -1 : 1
  const anchor: Point = [f.cx + flip * 0.55 * R, ground]
  s.child(kid, 'tummy', anchor, R, { mirror, expression: s.index === 0 ? 'smile' : 'wow' })
  ball(p, [anchor[0] + flip * 2.6 * R, ground - 0.55 * R], 0.55 * R)
}

const rollover: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.8)
  s.backdrop('playroom', ground)
  const R = f.unit * 0.15
  const anchor: Point = [f.cx + 0.5 * R, ground]
  s.child(kid, 'tummy', anchor, R, { expression: 'wow' })
  const [x0, x1, y] = [anchor[0] - 2.2 * R, anchor[0] + 0.6 * R, ground - 2.7 * R]
  p.add(stroke(`M${n(x0)},${n(y + 0.6 * R)} Q${n((x0 + x1) / 2)},${n(y - 0.9 * R)} ${n(x1)},${n(y + 0.2 * R)}`, WHITE, 0.16 * R))
  p.add(polygon([[x1 + 0.3 * R, y + 0.05 * R], [x1 - 0.15 * R, y - 0.15 * R], [x1 - 0.05 * R, y + 0.45 * R]], WHITE))
}

const laugh: Story = (s) => {
  const { p } = s
  const kid = s.main
  const cue = s.cue()
  if (cue === 'mum' || cue === 'dad') return s.cradled(cue, kid, 'home', { expression: 'laugh' })
  const j = s.fromAbove(kid, { expression: 'laugh', arms: 'up' }, s.index === 0 ? 0.19 : 0.23)
  sparks(p, [j.head[0] - 1.4 * j.R, j.head[1] - 0.2 * j.R], j.R)
  sparks(p, [j.head[0] + 1.4 * j.R, j.head[1] - 0.2 * j.R], j.R)
}

const grabs: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  if (s.index % 2 === 1) {
    const ground = f.Y(0.86)
    s.backdrop('playroom', ground)
    const R = s.fit(tall(kid, 'sit'), 0.55)
    const at: Point = [f.cx - 0.6 * R, ground]
    const [hx, hy] = s.headOf(kid, 'sit', at, R)
    s.child(kid, 'sit', at, R, { reach: [null, [hx + 1.6 * R, hy + 1.5 * R]], expression: 'wow' })
    stacker(p, [hx + 2.0 * R, ground], 0.85 * R, PALETTE)
    return
  }
  const j = s.fromAbove(kid, { expression: 'grin', arms: 'up' }, 0.18)
  rattle(p, j.hands[1], j.R, 20, kid.slug === 'emma' ? [244, 114, 182] : [96, 165, 250])
}

const gym: Story = (s) => {
  const j = s.fromAbove(s.main, { expression: 'wow', arms: 'up' }, 0.16)
  playGym(s.p, [j.chest[0], j.chest[1] + 0.2 * j.R], j.R)
}

const sitUp: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.88)
  s.backdrop('playroom', ground)
  const R = s.fit(tall(kid, 'sit'), 0.56)
  s.child(kid, 'sit', [f.cx, ground], R, { arms: s.index === 0 ? 'out' : 'clap', expression: 'grin' })
  blocks(p, [f.cx - 2.6 * R, ground + 0.1 * R], 0.8 * R, ['A', 'B'], PALETTE)
  ball(p, [f.cx + 2.5 * R, ground - 0.4 * R], 0.5 * R)
}

const crawl: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.84)
  s.backdrop('playroom', ground)
  const R = f.unit * 0.14
  const mirror = s.index % 2 === 1
  const flip = mirror ? -1 : 1
  const anchor: Point = [f.cx - flip * 0.6 * R, ground]
  const sister = s.sibling(kid)
  if (sister && kid.slug === 'leo') {
    teddy(p, [anchor[0] + flip * 3.4 * R, ground], 0.55 * R, [244, 114, 182])
    blocks(p, [anchor[0] + flip * 4.6 * R, ground], 0.7 * R, ['E', 'M'], PALETTE)
  } else ball(p, [anchor[0] + flip * 3.2 * R, ground - 0.5 * R], 0.5 * R)
  s.child(kid, 'crawl', anchor, R, { mirror, expression: 'grin' })
  motion(p, [anchor[0] - flip * 1.9 * R, ground - 0.8 * R], 0.6 * R, flip)
}

const tooth: Story = (s) => {
  s.closeUp(s.main, 'home', { expression: 'tooth', arms: 'clap' })
}

/** A child saying their word to someone (`listener`: a grown-up or the sibling). */
function talking(s: Shot, words: string, listener: Adult | Slug | 'toys'): void {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.92)
  s.backdrop('home', ground)
  if (listener === 'toys') {
    const R = s.fit(tall(kid, 'sit'), 0.5)
    const at: Point = [f.cx, ground]
    s.child(kid, 'sit', at, R, { arms: 'out', expression: 'laugh' })
    teddy(p, [f.cx - 2.6 * R, ground], 0.6 * R)
    bunny(p, [f.cx + 2.6 * R, ground], 0.6 * R)
    const [hx, hy] = s.headOf(kid, 'sit', at, R)
    s.say(words, [hx, hy + 0.5 * R], R, s.side)
    return
  }
  if (listener === 'emma' || listener === 'leo') {
    const other = s.kid(listener)
    const Rb = f.unit * 0.11
    const R = (Rb * scaleOf(kid.months)) / scaleOf(other.months)
    const at: Point = [f.X(0.64), ground]
    s.child(other, 'stand', [f.X(0.3), ground], Rb, { arms: 'up', expression: 'laugh' })
    s.child(kid, 'stand', at, R, { arms: 'out', expression: 'grin' })
    const [hx, hy] = s.headOf(kid, 'stand', at, R)
    s.say(words, [hx, hy + 0.5 * R], R, 1)
    return
  }
  const Ra = f.unit * 0.105
  const R = Ra * scaleOf(kid.months) * 1.15
  const at: Point = [f.X(0.66), ground]
  const pose: Pose = kid.months < 12 ? 'sit' : 'stand'
  const [hx, hy] = s.headOf(kid, pose, at, R)
  s.grown(listener, [f.X(0.3), ground], Ra, { kneel: true, arms: 'reach', expression: 'grin', target: [hx - 1.5 * R, hy + 1.2 * R] })
  s.child(kid, pose, at, R, { arms: 'out', expression: 'laugh' })
  s.say(words, [hx, hy + 0.5 * R], R, 1)
}

const clap: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.88)
  s.backdrop('playroom', ground)
  const R = s.fit(tall(kid, 'sit'), 0.56)
  const j = s.child(kid, 'sit', [f.cx, ground], R, { arms: 'clap', expression: 'laugh' })
  notes(p, [j.head[0] + 1.6 * R, j.head[1] - 0.6 * R], 0.7 * R, [124, 58, 237])
  sparks(p, [j.hands[0][0], j.hands[0][1] - 0.2 * R], 0.6 * R)
}

const sofaStory: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.9)
  s.backdrop('home', ground)
  const R = s.fit(tall(kid), 0.5)
  const seat = sofa(p, f.cx, ground, 10 * R, R, [96, 125, 185])
  if (kid.months >= 13) {
    s.child(kid, 'crawl', [f.cx + 0.3 * R, seat + 0.15 * R], R * 0.95, { mirror: s.side < 0, expression: 'grin', shadow: false })
    return
  }
  const at: Point = [f.cx, ground + 0.4 * R]
  s.child(kid, 'stand', at, R, { reach: [[f.cx - 1.0 * R, seat + 0.25 * R], [f.cx + 1.0 * R, seat + 0.25 * R]], expression: 'grin' })
}

const waves: Story = (s) => {
  const { f } = s
  const kid = s.main
  const ground = f.Y(0.9)
  s.backdrop(s.index % 2 ? 'street' : 'home', ground)
  const R = s.fit(tall(kid), 0.55)
  const at: Point = [f.cx - s.side * 0.08 * f.unit, ground]
  s.child(kid, 'stand', at, R, { arms: 'wave', expression: 'grin' })
  const [hx, hy] = s.headOf(kid, 'stand', at, R)
  s.say('Bye-bye!', [hx, hy + 0.5 * R], R, 1)
}

// Food -----------------------------------------------------------------------------------------

const GROWN_SKIN: Rgb = [240, 202, 176]

/** The child in a high chair at the kitchen table; `after` adds what is held or spilt. */
function inHighChair(s: Shot, look: Look, onTray: (tray: Point, R: number) => void, after?: (j: Joints, R: number) => void): void {
  const { f, p } = s
  const kid = s.main
  s.backdrop('kitchen', f.Y(1.0))
  const R = f.unit * 0.15
  const seat: Point = [f.cx, f.Y(0.8)]
  const tray = highChair(p, seat, R, kid.slug === 'emma' ? [251, 207, 232] : [186, 230, 253], f.Y(1.5))
  const j = s.child(kid, 'sit', seat, R, { bib: true, shadow: false, ...look })
  onTray(tray(), R)
  bareHand(p, kid, j.hands[0], R)
  after?.(j, R)
}

function smear(p: Painting, [hx, hy]: Point, R: number, color: Rgb, spots: readonly (readonly [number, number, number])[] = [[0.42, 0.62, 0.11], [-0.3, 0.75, 0.09], [0.12, 0.9, 0.08]]): void {
  for (const [dx, dy, r] of spots) p.add(circle([hx + dx * R, hy + dy * R], r * R, color, 0.95))
}

/** A grown-up's arm reaching in from the edge of the picture, holding a spoon to the mouth. */
function feedingArm(s: Shot, [hx, hy]: Point, R: number, food: Rgb): void {
  const { f, p } = s
  const hand: Point = [hx + 1.15 * R, hy + 0.95 * R]
  p.add(line([[f.X(1.15), f.Y(0.72)], [hx + 2.6 * R, hy + 1.5 * R], hand], MUM_SLEEVE, 0.62 * R, 1, 'round'))
  spoon(p, hand, [hx + 0.2 * R, hy + 0.62 * R], R, food)
  p.add(circle(hand, 0.28 * R, GROWN_SKIN))
}

const puree: Story = (s) => {
  const { p } = s
  const kid = s.main
  const food: Rgb = kid.slug === 'emma' ? [251, 191, 36] : [132, 204, 22]
  if (s.is(/surprised/i)) {
    const j = s.closeUp(kid, 'kitchen', { expression: 'wow', bib: true })
    smear(p, j.head, j.R, food)
    return
  }
  const spoonful = s.index === 0 || s.is(/spoonful|yummy/i)
  inHighChair(s, { arms: spoonful ? 'down' : 'out', expression: spoonful ? 'wow' : s.pick(['grin', 'smile', 'laugh']) }, (tray, R) => bowl(p, [tray[0] - 1.05 * R, tray[1] + 0.12 * R], 0.75 * R, food), (j, R) => {
    if (spoonful) feedingArm(s, j.head, R, food)
    else smear(p, j.head, R, food)
  })
}

const fingerFood: Story = (s) => {
  const { p } = s
  const bits: readonly Rgb[] = [[74, 222, 128], [250, 204, 21], [249, 115, 22], [74, 222, 128]]
  inHighChair(s, { arms: 'feed', expression: s.index === 0 ? 'calm' : 'grin' }, (tray, R) => {
    ;[[-1.4, 0.0], [-1.0, 0.15], [-0.6, -0.05], [0.9, 0.1], [1.25, -0.05], [1.5, 0.12]].forEach(([dx, dy], index) => p.add(circle([tray[0] + dx * R, tray[1] + dy * R], 0.12 * R, bits[index % bits.length])))
  }, (j, R) => p.add(circle([j.hands[1][0] - 0.12 * R, j.hands[1][1] - 0.12 * R], 0.11 * R, [74, 222, 128])))
}

const spoonFeeding: Story = (s) => {
  const { p } = s
  const kid = s.main
  const food: Rgb = kid.slug === 'emma' ? [251, 146, 60] : [240, 222, 180]
  const messy = s.index % 2 === 1
  inHighChair(s, { arms: 'feed', expression: messy ? 'grin' : 'calm' }, (tray, R) => bowl(p, [tray[0] - 1.05 * R, tray[1] + 0.12 * R], 0.75 * R, food), (j, R) => {
    const [hand, [hx, hy]] = [j.hands[1], j.head]
    spoon(p, [hand[0] + 0.4 * R, hand[1] + 0.35 * R], [hx + 0.15 * R, hy + 0.6 * R], R, food)
    bareHand(p, kid, hand, R)
    if (messy) smear(p, j.head, R, food)
    smear(p, j.chest, R, food, [[-0.25, 0.1, 0.09], [0.2, 0.3, 0.07], [-0.05, 0.45, 0.08]])
  })
}

const drinking: Story = (s) => {
  const { p } = s
  const kid = s.main
  inHighChair(s, { arms: 'feed', expression: 'calm' }, (tray, R) => cup(p, [tray[0] - 1.1 * R, tray[1] + 0.1 * R], 0.5 * R, [74, 222, 128]), (j, R) => {
    const hand = j.hands[1]
    rotated(p, [hand[0], hand[1] + 0.3 * R], -24, () => cup(p, [hand[0] - 0.05 * R, hand[1] + 0.3 * R], 0.75 * R, [250, 204, 21], [191, 219, 254]))
    bareHand(p, kid, hand, R)
    for (const [dx, dy] of [[-0.15, 0.2], [0.1, 0.42], [-0.05, 0.65]]) p.add(oval([j.chest[0] + dx * R, j.chest[1] + dy * R], 0.06 * R, 0.1 * R, [96, 165, 250]))
  })
}

const yum: Story = (s) => {
  const { p } = s
  inHighChair(s, { arms: 'up', expression: 'laugh' }, (tray, R) => bowl(p, [tray[0], tray[1] + 0.12 * R], 0.75 * R, [251, 191, 36]), (j, R) => s.say('Yum! More!', [j.head[0], j.head[1] + 0.5 * R], R * 0.8, s.side))
}

const cakeTaste: Story = (s) => {
  const { p } = s
  const kid = s.main
  const theme: CakeTheme = kid.slug === 'emma' ? 'carrot' : 'party'
  inHighChair(s, { arms: 'out', expression: 'cream', hat: 'party' }, (tray, R) => cake(p, [tray[0], tray[1] + 0.25 * R], 0.62 * R, { theme, eaten: true }), (j, R) => {
    smear(p, j.head, R, WHITE, [[-0.4, -0.22, 0.1], [0.38, -0.25, 0.09], [0.0, -0.4, 0.08]])
    for (const hand of j.hands) p.add(circle([hand[0], hand[1] - 0.1 * R], 0.13 * R, WHITE, 0.9))
  })
}

const iceCreamStory: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const flavour: Rgb = [251, 182, 206]
  const cue = s.cue()
  if (s.index % 3 === 1) {
    const R = f.unit * 0.2
    const [hx, hy] = [f.cx, f.Y(0.44)]
    const hand: Point = [hx + 0.85 * R, hy + 1.4 * R]
    const j = s.closeUp(kid, 'park', { expression: 'cream', reach: [null, hand] })
    iceCream(p, hand, 0.6 * R, flavour)
    bareHand(p, kid, hand, R)
    smear(p, j.head, R, flavour, [[0.35, 0.65, 0.1], [0.05, -0.05, 0.07]])
    return
  }
  const ground = f.Y(0.9)
  s.backdrop('park', ground)
  const Ra = f.unit * 0.1
  const R = cue === 'mum' || cue === 'dad' ? Ra * scaleOf(kid.months) * 1.1 : s.fit(tall(kid), 0.58)
  const at: Point = [cue === 'mum' || cue === 'dad' ? f.X(0.66) : f.cx, ground]
  const [hx, hy] = s.headOf(kid, 'stand', at, R)
  if (cue === 'mum' || cue === 'dad') {
    s.grown(cue, [f.X(0.3), ground], Ra, { kneel: true, arms: 'reach', target: [hx - 1.2 * R, hy + 1.8 * R], expression: 'grin' })
    iceCream(p, [hx - 1.25 * R, hy + 1.6 * R], 0.5 * R, [254, 240, 138])
  }
  const hand: Point = [hx + 0.75 * R, hy + 1.4 * R]
  s.child(kid, 'stand', at, R, { expression: 'cream', reach: [null, hand] })
  iceCream(p, hand, 0.55 * R, flavour)
  bareHand(p, kid, hand, R)
}

const baking: Story = (s) => {
  const { f, p } = s
  const [emma, leo] = [s.kid('emma'), s.kid('leo')]
  const edge = f.Y(0.64)
  const tray: Point = [f.X(0.44), edge + f.unit * 0.13]
  const joints = s.atTable(
    [
      { kid: emma, x: f.X(0.3), look: { hat: 'santa', expression: 'grin' }, reach: [tray[0] - f.unit * 0.04, tray[1] - f.unit * 0.07] },
      { kid: leo, x: f.X(0.72), look: { hat: 'santa', arms: 'feed', expression: 'cream' } },
    ],
    'kitchen',
    edge,
    [239, 68, 68],
    (R) => biscuits(p, tray, 0.85 * R, 3),
  )
  const hand = joints[1].hands[1]
  star(p, [hand[0] - 0.1 * joints[1].R, hand[1] - 0.15 * joints[1].R], 0.3 * joints[1].R, [222, 172, 108])
  bareHand(p, leo, hand, joints[1].R)
}

// Outdoors -------------------------------------------------------------------------------------

const seaside: Story = (s) => {
  const kid = s.main
  if (s.is(/sun hat/i)) {
    s.closeUp(kid, 'beach', { hat: 'sun', expression: 'smile' })
    return
  }
  const who: Adult = s.cue() === 'dad' || (s.cue() === null && s.index % 2 === 1) ? 'dad' : 'mum'
  s.cradled(who, kid, s.is(/sunset/i) ? 'sunset' : 'beach', { hat: 'sun', expression: s.is(/sea|water/i) ? 'wow' : 'smile' }, s.index % 2 === 0)
}

function splash(p: Painting, [x, y]: Point, s: number): void {
  for (const [dx, dy] of [[-0.6, -0.3], [-0.3, -0.7], [0.1, -0.85], [0.5, -0.6], [0.75, -0.25]]) p.add(oval([x + dx * s, y + dy * s], 0.09 * s, 0.14 * s, WHITE, 0.9))
}

const poolSplash: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const level = f.Y(0.6)
  s.backdrop('pool', level + f.unit * 0.3)
  const Ra = f.unit * [0.13, 0.16, 0.115, 0.145][s.index % 4]
  s.holding('mum', kid, [f.cx - s.side * 0.06 * f.unit, level + 5.0 * Ra], Ra, { outfit: 'swim', armbands: true, expression: s.index % 2 === 0 ? 'laugh' : 'wow' }, { mirror: s.side > 0, expression: 'grin' })
  water(p, f, level, s.hue)
  splash(p, [f.cx + s.side * 0.1 * f.unit, level], Ra)
}

const swimming: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const level = f.Y(0.62)
  s.backdrop('pool', level + f.unit * 0.3)
  const R = f.unit * 0.13
  const at: Point = [f.cx, level + 2.35 * R]
  const j = s.child(kid, 'stand', at, R, { outfit: 'swim', armbands: true, arms: 'out', expression: 'grin', shadow: false })
  water(p, f, level, s.hue)
  for (const hand of j.hands) splash(p, [hand[0], level], 0.6 * R)
}

const poolJump: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const level = f.Y(0.7)
  s.backdrop('pool', level + f.unit * 0.3)
  const Ra = f.unit * 0.095
  const R = Ra * scaleOf(kid.months) * 1.05
  const at: Point = [f.X(0.36), level - 0.6 * R]
  const [hx, hy] = s.headOf(kid, 'jump', at, R)
  s.grown('dad', [f.X(0.72), level + 4.6 * Ra], Ra, { arms: 'reach', mirror: true, expression: 'laugh', target: [hx + 1.6 * R, hy + 1.8 * R] })
  s.child(kid, 'jump', at, R, { outfit: 'swim', arms: 'up', expression: 'laugh', shadow: false })
  water(p, f, level, s.hue)
  splash(p, [f.X(0.45), level], 1.2 * R)
}

function beachKid(s: Shot, kid: Kid): Look {
  return { outfit: 'swim', hat: s.index % 2 === 0 ? 'sun' : undefined, color: s.color(kid.slug) }
}

/** Building sandcastles (`helper` kneels on the other side). */
function sandcastles(s: Shot, builder: Kid, helper: Kid | null): void {
  const { f, p } = s
  const ground = f.Y(0.88)
  s.backdrop('beach', ground)
  const Rb = f.unit * 0.105
  const R = (Rb * scaleOf(builder.months)) / scaleOf(30)
  const castle: Point = [f.cx + s.side * 0.03 * f.unit, ground + 0.15 * Rb]
  const left: Point = [castle[0] - 2.6 * Rb, ground]
  const pose: Pose = builder.months < 15 ? 'sit' : 'kneel'
  const [hx, hy] = s.headOf(builder, pose, left, R)
  const hand: Point = [hx + 1.5 * R, hy + 1.9 * R]
  s.child(builder, pose, left, R, { ...beachKid(s, builder), reach: [null, hand], expression: builder.months < 12 ? 'cream' : 'grin' })
  if (builder.months < 12) smear(p, [hx, hy], R, [222, 184, 135])
  if (helper) {
    const r = (Rb * scaleOf(helper.months)) / scaleOf(30)
    const right: Point = [castle[0] + 2.7 * Rb, ground]
    const [ox, oy] = s.headOf(helper, helper.months < 15 ? 'sit' : 'kneel', right, r)
    s.child(helper, helper.months < 15 ? 'sit' : 'kneel', right, r, { ...beachKid(s, helper), reach: [[ox - 1.5 * r, oy + 1.8 * r], null], expression: 'laugh' })
    bucket(p, [ox - 1.6 * r, oy + 2.5 * r], 0.55 * r, [96, 165, 250])
  }
  sandcastle(p, castle, 0.85 * Rb)
  spade(p, hand, [hand[0] + 0.5 * R, hand[1] + 0.8 * R], R, [239, 68, 68])
  bareHand(p, builder, hand, R)
  if (!helper) bucket(p, [castle[0] + 2.4 * Rb, ground + 0.2 * Rb], 0.7 * Rb, [250, 204, 21])
}

/** By the water: the children at the edge of the sea, the older one holding the other's hand. */
function shoreline(s: Shot, kids: readonly Kid[], evening: boolean): void {
  const { f, p } = s
  const ground = f.Y(0.92)
  s.backdrop(evening ? 'sunset' : 'beach', ground)
  if (kids.length === 1) {
    const kid = kids[0]
    const R = s.fit(tall(kid), 0.55)
    const j = s.child(kid, 'stand', [f.cx, ground], R, { ...beachKid(s, kid), arms: 'up', expression: 'laugh' })
    splash(p, [j.feet[1][0] + 0.6 * R, ground], 0.8 * R)
    return
  }
  const [older, younger] = kids[0].months >= kids[1].months ? kids : [kids[1], kids[0]]
  const Rb = f.unit * 0.1
  const r = (Rb * scaleOf(younger.months)) / scaleOf(30)
  const R = (Rb * scaleOf(older.months)) / scaleOf(30)
  const youngPose: Pose = younger.months < 12 ? 'sit' : 'stand'
  const yAt: Point = [f.X(0.62), ground]
  const [yx, yy] = s.headOf(younger, youngPose, yAt, r)
  const hand: Point = youngPose === 'sit' ? [yx - 1.5 * r, yy + 1.1 * r] : [yx - 1.3 * r, yy + 0.6 * r]
  s.child(older, 'stand', [f.X(0.36), ground], R, { ...beachKid(s, older), reach: [null, hand], expression: 'laugh' })
  s.child(younger, youngPose, yAt, r, { ...beachKid(s, younger), reach: [hand, null], expression: younger.months < 12 ? 'cream' : 'grin' })
  if (younger.months < 12) smear(p, [yx, yy], r, [222, 184, 135])
}

function rockPools(s: Shot, kids: readonly Kid[]): void {
  const { f, p } = s
  const ground = f.Y(0.8)
  s.backdrop('beach', ground)
  const Rb = f.unit * 0.1
  kids.forEach((kid, index) => {
    const R = (Rb * scaleOf(kid.months)) / scaleOf(30)
    const at: Point = [index === 0 ? f.X(0.3) : f.X(0.72), ground]
    const [hx, hy] = s.headOf(kid, 'kneel', at, R)
    s.child(kid, 'kneel', at, R, { ...beachKid(s, kid), reach: index === 0 ? [null, [hx + 1.6 * R, hy + 1.6 * R]] : undefined, arms: 'clap', expression: index === 0 ? 'wow' : 'laugh' })
  })
  rockPool(p, [f.cx, f.Y(0.92)], f.unit * 0.55)
}

const beachDay: Story = (s) => {
  const { f, p } = s
  const kids: readonly Kid[] = s.pair ? [s.main, s.pair] : [s.main]
  if (s.is(/rock pool/i)) return rockPools(s, kids)
  if (s.is(/sandcastle|bucket|spade/i)) return sandcastles(s, kids.length > 1 ? kids[1] : kids[0], kids.length > 1 ? kids[0] : null)
  if (s.is(/water|sea|sunset/i) || s.index % 3 === 1) return shoreline(s, kids, s.is(/sunset/i))
  if (s.index % 3 === 2 && kids.length > 1) return sandcastles(s, kids[1], kids[0])
  // On the towel under the parasol.
  const ground = f.Y(0.9)
  s.backdrop('beach', ground)
  const towel: Rgb = s.side > 0 ? [96, 165, 250] : [244, 114, 182]
  p.add(polygon([[f.X(0.14), ground - f.unit * 0.06], [f.X(0.86), ground - f.unit * 0.06], [f.X(0.92), ground + f.unit * 0.07], [f.X(0.08), ground + f.unit * 0.07]], towel))
  for (const t of [0.25, 0.5, 0.75]) p.add(line([[f.X(0.14 + 0.72 * t - 0.02), ground - f.unit * 0.06], [f.X(0.08 + 0.84 * t), ground + f.unit * 0.07]], WHITE, f.unit * 0.02, 0.7))
  const Rb = f.unit * 0.11
  kids.forEach((kid, index) => {
    const R = (Rb * scaleOf(kid.months)) / scaleOf(30)
    s.child(kid, 'sit', [kids.length > 1 ? (index === 0 ? f.X(0.34) : f.X(0.66)) : f.cx, ground], R, { ...beachKid(s, kid), arms: index === 0 ? 'clap' : 'out', expression: 'grin' })
  })
  bucket(p, [f.X(kids.length > 1 ? 0.5 : 0.7), ground + 0.02 * f.unit], 0.6 * Rb, [250, 204, 21])
}

const sandcastleStory: Story = (s) => sandcastles(s, s.main, s.sibling(s.main))

/** The child walking towards someone kneeling with open arms. */
function towards(s: Shot, kid: Kid, to: Adult | Kid): void {
  const { f, p } = s
  const ground = f.Y(0.9)
  s.backdrop('park', ground)
  const Ra = f.unit * 0.1
  const R = Ra * scaleOf(kid.months) * 1.15
  const at: Point = [f.X(0.33), ground]
  const [hx, hy] = s.headOf(kid, 'walk', at, R)
  if (typeof to === 'string') {
    s.grown(to, [f.X(0.74), ground], Ra, { kneel: true, arms: 'reach', mirror: true, expression: 'laugh', target: [hx + 2.2 * R, hy + 1.3 * R] })
  } else {
    const r = Ra * scaleOf(to.months) * 1.15
    const j = s.child(to, 'stand', [f.X(0.72), ground], r, { arms: 'up', expression: 'laugh' })
    sparks(p, [j.head[0], j.head[1] - 0.4 * r], r)
  }
  s.child(kid, 'walk', at, R, { arms: 'out', expression: 'grin' })
  motion(p, [hx - 1.3 * R, hy + 2.4 * R], 0.5 * R, 1)
}

/** A grown-up and the child walking hand in hand. */
function handInHand(s: Shot, who: Adult, kid: Kid, backdrop: Backdrop = 'park', look: Look = {}, extra: Partial<Place> = {}): void {
  const { f } = s
  const ground = f.Y(0.96)
  s.backdrop(backdrop, ground, extra)
  const Ra = f.unit * 0.1
  const R = Ra * scaleOf(kid.months) * 1.12
  const hand: Point = [f.X(0.52), ground - 3.25 * Ra]
  s.grown(who, [f.X(0.34), ground], Ra, { arms: 'hand', expression: 'grin', target: hand })
  s.child(kid, kid.months < 18 ? 'walk' : 'stand', [f.X(0.6), ground], R, { reach: [hand, null], expression: 'grin', ...look })
}

const steps: Story = (s) => {
  const kid = s.main
  const sister = s.sibling(kid)
  if (kid.slug === 'leo' && sister) return s.index % 2 === 0 ? towards(s, kid, sister) : handInHand(s, s.index % 4 === 1 ? 'mum' : 'dad', kid)
  const cue = s.cue()
  if (s.is(/holding hands/i) || cue === 'mum') return handInHand(s, 'mum', kid)
  if (s.index === 0 || cue === 'dad' || s.index % 2 === 0) return towards(s, kid, 'dad')
  handInHand(s, 'dad', kid)
}

const swingStory: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.98)
  s.backdrop('park', ground)
  const R = f.unit * (s.index === 1 ? 0.14 : 0.11)
  const seat: Point = [f.cx, f.Y(0.64)]
  const front = swing(p, seat[0], ground, seat[1], R, [239, 68, 68])
  s.child(kid, 'perch', seat, R, { reach: [[seat[0] - 1.15 * R, seat[1] - 1.7 * R], [seat[0] + 1.15 * R, seat[1] - 1.7 * R]], expression: 'laugh' })
  front()
}

const jumpStory: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.88)
  s.backdrop('park', ground)
  const R = s.fit(tall(kid, 'jump'), 0.6)
  puddle(p, [f.cx, ground + 0.1 * R], 4.2 * R, true)
  s.child(kid, 'jump', [f.cx, ground], R, { arms: 'up', expression: 'laugh' })
}

const zoo: Story = (s) => {
  const { f, p } = s
  const [emma, leo] = [s.kid('emma'), s.kid('leo')]
  const ground = f.Y(0.92)
  const Rb = f.unit * 0.1
  const R = (Rb * scaleOf(emma.months)) / scaleOf(30)
  const r = (Rb * scaleOf(leo.months)) / scaleOf(30)
  const penguins = s.is(/penguin/i) || (!s.is(/giraffe/i) && s.index % 2 === 1)
  s.backdrop('zoo', ground, { side: -1 })
  if (penguins) {
    const pool = ground - f.unit * 0.17
    p.add(rect(f.X(0.4), pool - f.unit * 0.05, f.width, pool + f.unit * 0.04, [94, 200, 205]))
    for (const [x, rx] of [[0.55, 0.1], [0.8, 0.13], [1.0, 0.12]]) p.add(oval([f.X(x), pool - f.unit * 0.04], f.unit * rx, f.unit * 0.05, [168, 162, 158]))
    for (const [x, k, mirror] of [[0.58, 1, true], [0.76, 1.15, false], [0.9, 0.95, true]] as const) penguin(p, [f.X(x), pool - f.unit * 0.06], Rb * 0.55 * k, mirror)
    fence(p, f.X(0.38), f.width, ground - f.unit * 0.06, f.unit * 0.1)
  } else {
    giraffe(p, f.X(0.76), ground - f.unit * 0.1, f.unit * 0.055, true)
    fence(p, 0, f.width, ground - f.unit * 0.06, f.unit * 0.12)
  }
  const cue = s.cue()
  if (cue === 'mum' || cue === 'dad') s.holding(cue, leo, [f.X(0.16), f.Y(1.0)], Rb * 0.95, { expression: penguins ? 'sleep' : 'grin' })
  else {
    const chair = pushchair(p, f.X(0.17), ground, r * 0.95, [96, 165, 250])
    s.child(leo, 'perch', chair.seat, r, { expression: penguins ? 'sleep' : 'grin', shadow: false })
    chair.front()
  }
  const at: Point = [f.X(0.47), ground]
  const [hx, hy] = s.headOf(emma, 'stand', at, R)
  s.child(emma, 'stand', at, R, { reach: [null, penguins ? [hx + 1.7 * R, hy + 0.9 * R] : [hx + 1.3 * R, hy - 1.2 * R]], expression: penguins ? 'laugh' : 'wow' })
}

const run: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.88)
  s.backdrop('park', ground)
  const R = s.fit(tall(kid, 'run'), s.index === 0 ? 0.6 : 0.45)
  const at: Point = [f.cx + 0.3 * R, ground]
  const [hx, hy] = s.headOf(kid, 'run', at, R)
  s.child(kid, 'run', at, R, { arms: 'out', expression: 'laugh' })
  motion(p, [hx - 1.6 * R, hy + 2.0 * R], 0.6 * R, 1)
}

const kick: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.9)
  s.backdrop('park', ground)
  const Ra = f.unit * 0.1
  const R = Ra * scaleOf(kid.months) * 1.15
  const at: Point = [f.X(0.3), ground]
  s.child(kid, 'run', at, R, { arms: 'out', expression: 'grin' })
  const flight: Point = [f.X(0.52), ground - 1.4 * R]
  ball(p, flight, 0.5 * R, 'football')
  motion(p, [flight[0] - 0.55 * R, flight[1]], 0.35 * R, 1)
  s.grown('dad', [f.X(0.78), ground], Ra, { kneel: true, arms: 'reach', mirror: true, expression: 'laugh', target: [flight[0] + 1.3 * R, flight[1] - 0.2 * R] })
}

const trikeStory: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.88)
  s.backdrop('park', ground)
  const R = f.unit * (s.index === 1 ? 0.13 : 0.105)
  const ride = trike(p, f.cx - 0.2 * R, ground, R, [239, 68, 68])
  s.child(kid, 'perch', ride.seat, R, { reach: [[ride.bar[0] - 0.25 * R, ride.bar[1]], [ride.bar[0] + 0.2 * R, ride.bar[1] + 0.05 * R]], expression: 'grin' })
  ride.front()
  motion(p, [ride.seat[0] - 2.4 * R, ground - 1.4 * R], 0.6 * R, 1)
}

const bike: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.88)
  s.backdrop('park', ground)
  const R = f.unit * 0.105
  const ride = balanceBike(p, f.cx, ground, R, [124, 58, 237])
  s.child(kid, 'sit', ride.seat, R, { hat: 'helmet', reach: [[ride.bar[0] - 0.25 * R, ride.bar[1]], [ride.bar[0] + 0.2 * R, ride.bar[1] + 0.05 * R]], expression: 'laugh', shadow: false })
  ride.front()
  motion(p, [ride.seat[0] - 2.4 * R, ground - 1.6 * R], 0.6 * R, 1)
}

const garden: Story = (s) => {
  const { f, p, random } = s
  const [emma, leo] = [s.kid('emma'), s.kid('leo')]
  const ground = f.Y(0.84)
  s.backdrop('garden', ground)
  const Rb = f.unit * 0.105
  const R = (Rb * scaleOf(emma.months)) / scaleOf(30)
  const r = (Rb * scaleOf(leo.months)) / scaleOf(30)
  const eAt: Point = [f.X(0.33), ground]
  const [ex, ey] = s.headOf(emma, 'kneel', eAt, R)
  const watering = s.index % 2 === 1
  const plant: Point = [ex + 1.4 * R, ey + 2.6 * R]
  const can: Point = [ex + 1.5 * R, ey + 1.2 * R]
  if (s.cue() === 'grandparents' || s.index === 3) s.grown('grandpa', [f.X(0.84), f.Y(1.0)], Rb, { kneel: true, arms: 'wave', expression: 'grin' })
  s.child(emma, 'kneel', eAt, R, { reach: [null, watering ? can : plant], expression: 'grin' })
  const lAt: Point = [f.X(0.64), ground]
  const [lx, ly] = s.headOf(leo, 'sit', lAt, r)
  const scoop: Point = [lx + 1.3 * r, ly + 1.8 * r]
  s.child(leo, 'sit', lAt, r, { reach: [null, scoop], expression: 'laugh' })
  smear(p, [lx, ly], r, [101, 67, 33], [[0.4, 0.6, 0.1], [-0.35, 0.2, 0.08]])
  vegPatch(p, f.X(0.04), f.X(0.96), f.Y(0.9), Rb, random)
  if (watering) {
    wateringCan(p, can, 0.7 * R, [34, 197, 94], true)
    bareHand(p, emma, can, R)
  } else {
    carrotSeedling(p, [plant[0] + 0.1 * R, plant[1] - 0.6 * R], 0.8 * R)
    forearm(p, emma, plant, R, s.sleeve(emma), 1)
  }
  spade(p, scoop, [scoop[0] + 0.4 * r, scoop[1] + 0.9 * r], r, [37, 99, 235])
  forearm(p, leo, scoop, r, s.sleeve(leo), 1)
}

const leafHunt: Story = (s) => {
  const { f, p, random } = s
  const [emma, leo] = [s.kid('emma'), s.kid('leo')]
  const ground = f.Y(0.9)
  s.backdrop('autumn', ground)
  const Rb = f.unit * 0.1
  const R = (Rb * scaleOf(emma.months)) / scaleOf(30)
  const r = (Rb * scaleOf(leo.months)) / scaleOf(30)
  const lAt: Point = [f.X(0.66), ground]
  const lj = s.child(leo, 'jump', lAt, r, { arms: 'up', expression: 'laugh', hat: 'beanie' })
  leaves(p, random, [lj.head[0] - 2.6 * r, lj.top - 1.6 * r, lj.head[0] + 2.6 * r, lj.head[1] + 0.5 * r], 14, 0.28 * r)
  const eAt: Point = [f.X(0.32), ground]
  const [ex, ey] = s.headOf(emma, 'stand', eAt, R)
  const hand: Point = [ex + 1.0 * R, ey + 1.3 * R]
  s.child(emma, 'stand', eAt, R, { reach: [null, hand], expression: 'grin', hat: 'beanie' })
  p.add(oval([hand[0] + 0.15 * R, hand[1] - 0.35 * R], 0.38 * R, 0.22 * R, [234, 88, 12], 1, -60))
  bareHand(p, emma, hand, R)
  if (s.index % 2 === 0) s.say('Seven, eight…', [ex, ey + 0.5 * R], R * 0.8, -1)
  leaves(p, random, [f.X(0.05), ground - 0.02 * f.unit, f.X(0.95), ground + 0.06 * f.unit], 22, 0.3 * r)
}

const sportsDay: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.9)
  s.backdrop('park', ground)
  bunting(p, f.X(-0.05), f.X(1.05), f.Y(0.05), f.unit * 0.05, f.unit * 0.05, PALETTE)
  const R = s.fit(tall(kid), 0.6)
  if (s.index % 3 === 1) {
    const at: Point = [f.cx, ground]
    const j = s.child(kid, 'stand', at, R, { arms: 'hips', expression: 'grin' })
    medal(p, [j.head[0], j.head[1] + 1.15 * R], 0.75 * R, '2nd')
    return
  }
  if (s.index % 3 === 2) {
    const j = s.child(kid, 'jump', [f.cx, ground], R, { arms: 'up', expression: 'laugh' })
    sparks(p, [j.head[0] - 1.8 * R, j.head[1]], R)
    return
  }
  finishTape(p, f.X(0.8), ground, 0.8 * R)
  const at: Point = [f.X(0.4), ground]
  const [hx, hy] = s.headOf(kid, 'run', at, R)
  const hand: Point = [hx + 1.3 * R, hy + 1.6 * R]
  s.child(kid, 'run', at, R, { reach: [null, hand], expression: 'grin' })
  eggAndSpoon(p, hand, R, 1)
  bareHand(p, kid, hand, R)
  motion(p, [hx - 1.4 * R, hy + 2.0 * R], 0.6 * R, 1)
}

// Celebrations ---------------------------------------------------------------------------------

const pumpkinBaby: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const look: Look = { outfit: 'pumpkin', hat: 'stem', expression: 'grin' }
  const cue = s.cue()
  if (cue === 'family') return s.family([kid], 'halloween', {}, () => look)
  if (cue === 'grandparents') return s.grandparents([kid], 'halloween', {}, () => look)
  if (cue === 'mum' || cue === 'dad') return s.cradled(cue, kid, 'halloween', look, false)
  if (s.index % 3 === 2) {
    s.closeUp(kid, 'halloween', look)
    return
  }
  const ground = f.Y(0.88)
  s.backdrop('halloween', ground)
  const R = s.fit(tall(kid, 'sit'), 0.55)
  s.child(kid, 'sit', [f.cx, ground], R, { ...look, arms: 'clap' })
  jackOLantern(p, [f.cx - 2.7 * R, ground + 0.1 * R], 0.75 * R)
  jackOLantern(p, [f.cx + 2.6 * R, ground + 0.15 * R], 0.6 * R)
}

const halloweenStory: Story = (s) => {
  const { f, p } = s
  const [emma, leo] = [s.kid('emma'), s.kid('leo')]
  const costume = (kid: Kid): Look => (kid.slug === 'emma' ? { outfit: 'witch', hat: 'witch' } : { outfit: 'pumpkin', hat: 'stem' })
  const cue = s.cue()
  if (cue === 'grandparents') return s.grandparents([emma, leo], 'halloween', {}, costume)
  if (cue === 'family') return s.family([emma, leo], 'halloween', {}, costume)
  const trick = s.is(/trick/i) || (!s.is(/witch/i) && s.index % 2 === 1)
  const ground = f.Y(0.92)
  s.backdrop(trick ? 'street' : 'halloween', ground, { night: true })
  const Rb = f.unit * 0.1
  const R = (Rb * scaleOf(emma.months)) / scaleOf(30)
  const r = (Rb * scaleOf(leo.months)) / scaleOf(30)
  const eAt: Point = [f.X(0.36), ground]
  const lAt: Point = [f.X(0.66), ground]
  const [ex, ey] = s.headOf(emma, 'stand', eAt, R)
  const [lx, ly] = s.headOf(leo, 'walk', lAt, r)
  const eHand: Point = [ex + 1.1 * R, ey + 1.9 * R]
  const lHand: Point = [lx - 1.0 * r, ly + 1.6 * r]
  s.child(emma, 'stand', eAt, R, { outfit: 'witch', hat: 'witch', reach: [null, eHand], expression: 'grin' })
  if (trick) pumpkinBucket(p, eHand, 0.55 * R)
  else broom(p, eHand, 0.8 * R)
  bareHand(p, emma, eHand, R)
  s.child(leo, 'walk', lAt, r, { outfit: 'pumpkin', hat: 'stem', reach: trick ? [lHand, null] : undefined, arms: 'out', expression: 'laugh' })
  if (trick) {
    pumpkinBucket(p, lHand, 0.5 * r)
    bareHand(p, leo, lHand, r)
  }
}

function sittingNear(s: Shot, kids: readonly Kid[], ground: number, xs: readonly number[], looks: readonly Look[]): Joints[] {
  const Rb = s.f.unit * 0.1
  return kids.map((kid, index) => {
    const R = (Rb * scaleOf(kid.months)) / scaleOf(30)
    if (kid.months < 4) {
      const seat: Point = [xs[index], ground - 1.6 * R]
      bouncer(s.p, seat, R, s.color(kid.slug), ground)
      s.lying(kid, seat, R, -35, { expression: 'calm', ...looks[index] })
      return { head: [seat[0], seat[1] - R], R, hands: [seat, seat], chest: seat, hip: seat, feet: [seat, seat], top: seat[1] - 2 * R } satisfies Joints
    }
    const pose: Pose = kid.months < 18 ? 'sit' : 'stand'
    return s.child(kid, pose, [xs[index], ground], R, { expression: 'grin', ...looks[index] })
  })
}

const stockings: Story = (s) => {
  const { f, p } = s
  const kids: readonly Kid[] = s.pair ? [s.main, s.pair] : [s.main]
  const cue = s.cue()
  if (cue === 'grandparents') return s.grandparents(kids, 'christmas', {}, () => ({ hat: 'santa' }))
  if (cue === 'family') return s.family(kids, 'christmas', {}, () => ({ hat: 'santa' }))
  const ground = f.Y(0.9)
  s.backdrop('christmas', ground, { tree: false })
  const fx = f.cx + s.side * 0.14 * f.unit
  const { mantel } = fireplace(p, fx, ground - f.unit * 0.1, f.unit * 0.56, f.unit * 0.4)
  kids.forEach((kid, index) => stocking(p, [fx + (index - (kids.length - 1) / 2) * 0.17 * f.unit, mantel], f.unit * 0.08, index ? [37, 99, 235] : [220, 38, 38], kid.slug === 'emma' ? 'E' : 'L'))
  treats(p, [fx + s.side * 0.2 * f.unit, ground + f.unit * 0.03], f.unit * 0.07)
  const ex = f.cx - s.side * 0.2 * f.unit
  if (kids.length === 1) {
    sittingNear(s, kids, ground, [ex], [{ hat: 'santa', expression: 'wow', arms: 'up' }])
    return
  }
  const [emma, leo] = [s.kid('emma'), s.kid('leo')]
  const R = (f.unit * 0.1 * scaleOf(emma.months)) / scaleOf(30)
  const at: Point = [fx - 0.02 * f.unit, ground]
  s.child(emma, 'stand', at, R, { hat: 'santa', reach: [null, [fx + 0.08 * f.unit, mantel + 0.02 * f.unit]], expression: 'grin' })
  sittingNear(s, [leo], ground, [ex], [{ hat: 'santa' }])
}

const christmasStory: Story = (s) => {
  const { f, p, random } = s
  const kids: readonly Kid[] = s.pair ? [s.main, s.pair] : [s.main]
  const cue = s.cue()
  if (cue === 'grandparents') return s.grandparents(kids, 'christmas')
  if (cue === 'family') return s.family(kids, 'christmas')
  if (s.is(/dinner/i)) {
    const edge = f.Y(0.64)
    const xs = kids.length > 1 ? [f.X(0.3), f.X(0.7)] : [f.cx]
    s.atTable(kids.map((kid, index) => ({ kid, x: xs[index], look: { hat: 'crown', expression: 'laugh' } })), 'christmas', edge, [239, 68, 68], (R) => {
      roast(p, [f.cx, edge + 0.2 * f.unit], 1.1 * R)
      cracker(p, [f.X(0.18), edge + 0.25 * f.unit], 0.6 * R, [37, 99, 235], -20)
      cracker(p, [f.X(0.84), edge + 0.22 * f.unit], 0.6 * R, [22, 163, 74], 15)
    })
    return
  }
  const ground = f.Y(0.9)
  if (s.is(/box/i) && s.pair) {
    s.backdrop('christmas', ground)
    const [emma, leo] = [s.kid('emma'), s.kid('leo')]
    const r = (f.unit * 0.1 * scaleOf(leo.months)) / scaleOf(30)
    const front = bigBox(p, f.X(0.62), ground, f.unit * 0.36, f.unit * 0.22)
    s.child(leo, 'sit', [f.X(0.62), ground - f.unit * 0.12], r, { arms: 'up', expression: 'laugh', shadow: false })
    front()
    const R = (f.unit * 0.1 * scaleOf(emma.months)) / scaleOf(30)
    s.child(emma, 'stand', [f.X(0.27), ground], R, { arms: 'clap', expression: 'laugh', outfit: 'pyjamas' })
    return
  }
  s.backdrop('christmas', ground)
  const wrapping: readonly Rgb[] = [[220, 38, 38], [37, 99, 235], [22, 163, 74], [234, 179, 8]]
  const opening = s.is(/present|morning|opening/i) || s.index % 3 === 2
  const xs = kids.length > 1 ? [f.X(0.36), f.X(0.64)] : [f.cx - s.side * 0.05 * f.unit]
  const looks: Look[] = kids.map((kid, index) => ({ hat: 'santa', outfit: s.is(/morning/i) ? 'pyjamas' : undefined, arms: opening && index === 0 ? 'up' : 'clap', expression: index === 0 ? 'laugh' : 'grin', color: s.color(kid.slug) }))
  const placed = sittingNear(s, kids, ground, xs, looks)
  for (let index = 0; index < 3; index += 1) present(p, [f.cx + (index - 1) * 0.2 * f.unit + s.side * 0.25 * f.unit, ground + 0.06 * f.unit], f.unit * 0.09, f.unit * 0.07, wrapping[index], [253, 224, 71])
  if (opening) {
    const [a, b] = placed[0].hands
    p.add(polygon([[a[0] - 0.2 * placed[0].R, a[1] + 0.2 * placed[0].R], [b[0] + 0.2 * placed[0].R, b[1] + 0.2 * placed[0].R], [b[0] + 0.5 * placed[0].R, b[1] - 0.6 * placed[0].R], [a[0] - 0.4 * placed[0].R, a[1] - 0.7 * placed[0].R]], wrapping[0]))
    for (let index = 0; index < 8; index += 1) {
      const [x, y] = [f.cx + random.uniform(-0.4, 0.4) * f.unit, ground + random.uniform(-0.01, 0.07) * f.unit]
      p.add(polygon([[x, y], [x + 0.03 * f.unit, y - 0.01 * f.unit], [x + 0.02 * f.unit, y + 0.02 * f.unit]], random.choice(wrapping)))
    }
  }
}

const nativity: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const sheep = kid.months >= 30
  const look: Look = sheep ? { outfit: 'sheep', hat: 'sheep', expression: 'laugh' } : { outfit: 'star', hat: 'star', arms: 'wave', expression: 'grin' }
  if (s.index % 3 === 2) {
    s.closeUp(kid, 'stage', look)
    return
  }
  const ground = f.Y(0.88)
  s.backdrop('stage', ground)
  const R = s.fit(tall(kid) + 1, s.index === 0 ? 0.6 : 0.45)
  const at: Point = [f.cx, ground]
  const j = s.child(kid, 'stand', at, R, look)
  if (sheep) s.say('Baa!', [j.head[0], j.head[1] + 0.5 * R], R, 1)
  else notes(p, [j.head[0] - 2.8 * R, j.head[1] - 0.2 * R], 0.6 * R, [253, 224, 71])
}

const CAKES: Readonly<Record<Slug, readonly CakeTheme[]>> = { emma: ['party', 'chocolate', 'unicorn'], leo: ['party', 'dinosaur', 'party'] }

const birthday: Story = (s) => {
  const { f, p, random } = s
  const kid = s.main
  const years = Math.min(3, Math.max(1, Math.round(kid.months / 12)))
  const theme = CAKES[kid.slug][years - 1]
  const hat: Hat = kid.slug === 'emma' && years === 2 ? 'crown' : 'party'
  const sister = s.sibling(kid)
  const kids = sister ? [kid, sister] : [kid]
  const cue = s.cue()
  const sign = 'HAPPY BIRTHDAY'
  if (cue === 'grandparents') return s.grandparents(kids, 'party', { sign })
  if (cue === 'family') return s.family(kids, 'party', { sign })
  if (s.is(/balloon/i)) {
    const ground = f.Y(0.94)
    s.backdrop('party', ground, { sign })
    const R = s.fit(tall(kid) + 4.5, 0.86)
    const at: Point = [f.cx - 0.6 * R, ground]
    const [hx, hy] = s.headOf(kid, 'stand', at, R)
    const hand: Point = [hx + 1.4 * R, hy + 0.9 * R]
    s.child(kid, 'stand', at, R, { hat, reach: [null, hand], expression: 'laugh' })
    balloons(p, hand, 0.8 * R, PALETTE)
    bareHand(p, kid, hand, R)
    return
  }
  if (s.is(/present/i)) {
    const ground = f.Y(0.9)
    s.backdrop('party', ground, { sign })
    const R = s.fit(tall(kid, 'sit'), 0.5)
    s.child(kid, 'sit', [f.cx, ground], R, { hat, arms: 'up', expression: 'laugh' })
    ;[[-2.4, 1.3, 1.1], [2.3, 1.1, 1.3], [3.3, 0.8, 0.8]].forEach(([dx, w, h], index) => present(p, [f.cx + dx * R, ground + 0.3 * R], w * R, h * R, PALETTE[index], WHITE))
    return
  }
  if (s.is(/smile/i)) {
    s.closeUp(kid, 'party', { hat, expression: 'grin' }, { sign })
    return
  }
  if (s.is(/game/i)) {
    const ground = f.Y(0.9)
    s.backdrop('garden', ground)
    bunting(p, f.X(-0.05), f.X(1.05), f.Y(0.04), f.unit * 0.06, f.unit * 0.05, PALETTE)
    const R = s.fit(tall(kid, 'jump'), 0.58)
    const j = s.child(kid, 'jump', [f.cx, ground], R, { hat, arms: 'up', expression: 'laugh' })
    sparks(p, [j.head[0] + 1.9 * R, j.head[1]], R)
    for (let index = 0; index < 30; index += 1) {
      const [x, y] = [random.uniform(0, f.width), random.uniform(0, ground)]
      p.add(rect(x, y, x + f.unit * 0.012, y + f.unit * 0.007, random.choice(PALETTE)))
    }
    return
  }
  // The cake on the table, candles lit (the birthday child, or the big sister, blowing).
  const edge = f.Y(0.64)
  const blowing = s.is(/blow|candle/i) || s.index === 0
  const helper = kid.slug === 'leo' && sister ? sister : null
  const guests: { kid: Kid; x: number; look: Look }[] = helper
    ? [{ kid, x: f.X(0.3), look: { hat, expression: years > 1 && blowing ? 'kiss' : 'wow' } }, { kid: helper, x: f.X(0.72), look: { hat: 'party', expression: blowing ? 'kiss' : 'laugh' } }]
    : [{ kid, x: f.cx - s.side * 0.12 * f.unit, look: { hat, expression: blowing ? 'kiss' : 'grin' } }]
  const cakeX = helper ? f.cx : f.cx + s.side * 0.1 * f.unit
  const joints = s.atTable(guests, 'party', edge, undefined, (R) => cake(p, [cakeX, edge + 0.21 * f.unit], 1.2 * R, { candles: years, theme, lit: true }), { sign })
  if (blowing) {
    const blower = joints[joints.length - 1]
    const [mx, my] = [blower.head[0], blower.head[1] + 0.55 * blower.R]
    const toward = cakeX < mx ? -1 : 1
    for (const dy of [-0.25, 0, 0.25]) p.add(line([[mx + toward * 0.4 * blower.R, my + dy * blower.R], [mx + toward * 1.2 * blower.R, my + (dy * 1.6 + 0.5) * blower.R]], WHITE, 0.08 * blower.R, 0.8, 'round'))
  }
}

// Nursery --------------------------------------------------------------------------------------

const NURSERY_SIGN = 'Little Acorns Nursery'

function ready(s: Shot, kid: Kid, backdrop: Backdrop, extra: Partial<Place> = {}): void {
  const { f, p } = s
  const ground = f.Y(0.92)
  s.backdrop(backdrop, ground, extra)
  const R = s.fit(tall(kid), 0.6)
  const at: Point = [f.cx - s.side * 0.05 * f.unit, ground]
  const [hx, hy] = s.headOf(kid, 'stand', at, R)
  const waving = s.index % 2 === 1
  const hand: Point = [hx + (waving ? -1.2 : 1.2) * R, hy + 2.3 * R]
  s.child(kid, 'stand', at, R, { bag: kid.months >= 40, outfit: kid.months >= 40 ? 'uniform' : undefined, arms: waving ? 'wave' : 'hips', reach: waving ? [hand, null] : [null, hand], expression: 'grin' })
  bookBag(p, hand, 0.75 * R, kid.slug === 'emma' ? [124, 58, 237] : [37, 99, 235])
  bareHand(p, kid, hand, R)
}

/** Coat pegs with name labels: the child (or the big sister) points at the right one. */
function pegsScene(s: Shot, owner: Kid, guide: Kid | null): void {
  const { f, p } = s
  const ground = f.Y(0.94)
  s.backdrop('classroom', ground)
  const names = owner.slug === 'emma' ? ['Ava', 'Emma', 'Noah', 'Isla'] : ['Leo', 'Emma', 'Mia', 'Sam']
  const mine = names.indexOf(NAMES[owner.slug])
  const coats: (Rgb | null)[] = [[96, 165, 250], null, [250, 204, 21], [244, 114, 182]]
  if (owner.slug === 'leo') coats.splice(0, 2, null, s.color('emma'))
  const cards = pegs(p, f.X(-0.02), f.X(1.02), f.Y(0.3), f.unit * 0.07, names, mine, coats)
  const pointer = guide ?? owner
  const Rb = f.unit * 0.1
  const R = (Rb * scaleOf(pointer.months)) / scaleOf(30)
  const card = cards[mine]
  const at: Point = [card[0] + (owner.slug === 'emma' ? -0.16 : 0.2) * f.unit, ground]
  const [hx, hy] = s.headOf(pointer, 'stand', at, R)
  const reach: Point = [card[0] + (at[0] < card[0] ? -0.04 : 0.04) * f.unit, card[1] + 0.05 * f.unit]
  s.child(pointer, 'stand', at, R, { reach: at[0] < card[0] ? [null, reach] : [reach, null], expression: 'laugh', bag: !guide })
  if (guide) {
    const r = (Rb * scaleOf(owner.months)) / scaleOf(30)
    s.child(owner, 'stand', [at[0] + 0.24 * f.unit, ground], r, { bag: true, expression: 'wow' })
  } else s.say("That's me!", [hx, hy + 0.5 * R], R * 0.8, at[0] < card[0] ? -1 : 1)
}

function gate(s: Shot, kid: Kid): void {
  const { f, p } = s
  const ground = f.Y(0.92)
  s.backdrop('street', ground, { side: s.side })
  schoolGate(p, 0, f.width, ground - f.unit * 0.05, f.unit * 0.28, 'Pre-school', f.Y(0.1))
  const R = s.fit(tall(kid), 0.58)
  s.child(kid, 'stand', [f.cx, ground], R, { bag: true, outfit: 'uniform', arms: 'wave', expression: 'grin' })
}

const nursery: Story = (s) => {
  const kid = s.main
  const sister = s.sibling(kid)
  const preschool = kid.months >= 40
  if (kid.slug === 'leo' && sister && (s.index === 0 || s.is(/door|class/i))) return pegsScene(s, kid, sister)
  if (s.is(/gate/i)) return gate(s, kid)
  if (s.is(/home time/i)) return handInHand(s, 'mum', kid, 'street', { bag: true }, { sign: preschool ? 'Pre-school' : NURSERY_SIGN })
  if (s.is(/door/i)) return ready(s, kid, 'street', { sign: preschool ? 'Pre-school' : NURSERY_SIGN })
  if (s.is(/drawing/i)) return drawingAt(s, kid, 'scribble')
  if (s.is(/class|playground/i)) return ready(s, kid, s.is(/playground/i) ? 'park' : 'classroom')
  ready(s, kid, s.index % 2 ? 'street' : 'home', { sign: preschool ? 'Pre-school' : NURSERY_SIGN })
}

const butterflies: Story = (s) => ready(s, s.main, 'classroom', { sign: 'Butterflies' })

function drawingAt(s: Shot, kid: Kid, drawing: Drawing): void {
  const { f, p, random } = s
  if (s.index % 2 === 1) {
    // Holding up the masterpiece.
    const ground = f.Y(0.94)
    s.backdrop('classroom', ground)
    const R = s.fit(tall(kid), 0.62)
    const at: Point = [f.cx, ground]
    const [hx, hy] = s.headOf(kid, 'stand', at, R)
    const hands: [Point, Point] = [[hx - 1.5 * R, hy + 2.1 * R], [hx + 1.5 * R, hy + 2.1 * R]]
    s.child(kid, 'stand', at, R, { reach: hands, expression: 'laugh' })
    paper(p, [hx, hy + 2.6 * R], 3.2 * R, 2.4 * R, drawing, random)
    for (const hand of hands) bareHand(p, kid, hand, R)
    return
  }
  const edge = f.Y(0.64)
  const sheet: Point = [f.cx + 0.1 * f.unit, edge + 0.17 * f.unit]
  const hand: Point = [sheet[0] + 0.02 * f.unit, sheet[1] - 0.04 * f.unit]
  const [joints] = s.atTable([{ kid, x: f.cx - 0.06 * f.unit, look: { expression: 'calm' }, reach: hand }], 'classroom', edge, undefined, (R) => {
    paper(p, sheet, 0.4 * f.unit, 0.28 * f.unit, drawing, random, -4)
    crayons(p, [f.cx - 0.3 * f.unit, edge + 0.2 * f.unit], 0.7 * R, random, 3)
  })
  heldCrayon(p, hand, joints.R, [239, 68, 68])
}

const scribble: Story = (s) => drawingAt(s, s.main, 'scribble')
const face: Story = (s) => drawingAt(s, s.main, 'face')
const letter: Story = (s) => drawingAt(s, s.main, 'E')
const namePeg: Story = (s) => pegsScene(s, s.main, null)

// Home life ------------------------------------------------------------------------------------

const haircut: Story = (s) => {
  const { f, p, random } = s
  const kid = s.main
  const ground = f.Y(0.94)
  s.backdrop('salon', ground)
  const R = f.unit * (s.index === 1 ? 0.15 : 0.12)
  const seat: Point = [f.cx, f.Y(0.72)]
  salonChair(p, seat, R, ground)
  const j = s.child(kid, 'perch', seat, R, { cape: true, expression: s.index === 0 ? 'calm' : 'grin' })
  const side = s.side
  const hand: Point = [j.head[0] + side * 1.35 * R, j.head[1] - 0.55 * R]
  p.add(line([[side > 0 ? f.width + 10 : -10, f.Y(0.2)], hand], [94, 234, 212], 0.5 * R, 1, 'round'))
  scissors(p, [hand[0] - side * 0.15 * R, hand[1]], 0.9 * R, side > 0 ? 200 : -20)
  p.add(circle(hand, 0.24 * R, GROWN_SKIN))
  hairBits(p, random, [f.cx, ground], 0.5 * f.unit, R, KIDS[kid.slug].hair)
  hairBits(p, random, [j.chest[0], j.chest[1] + 0.8 * R], 1.6 * R, 0.6 * R, KIDS[kid.slug].hair)
}

const puzzleStory: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.76)
  s.backdrop('playroom', ground)
  const R = s.fit(tall(kid, 'sit'), 0.5)
  const at: Point = [f.cx - 0.12 * f.unit, ground]
  const board: Point = [f.cx + 0.1 * f.unit, f.Y(0.9)]
  const hand: Point = [board[0] + 0.55 * R, board[1] - 1.35 * R]
  s.child(kid, 'sit', at, R, { reach: [null, hand], expression: 'wow' })
  puzzle(p, board, 0.85 * R)
  forearm(p, kid, hand, R, s.sleeve(kid), 1)
  puzzlePiece(p, [hand[0], hand[1] + 0.25 * R], 0.75 * R)
}

const shapes: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.86)
  s.backdrop('playroom', ground)
  const R = s.fit(tall(kid, 'sit'), 0.52)
  const at: Point = [f.cx - 0.1 * f.unit, ground]
  const box: Point = [f.cx + 0.16 * f.unit, ground + 0.15 * R]
  const [hx, hy] = s.headOf(kid, 'sit', at, R)
  const hand: Point = [box[0] - 0.1 * R, hy + 1.6 * R]
  s.child(kid, 'sit', at, R, { reach: [null, hand], expression: 'laugh' })
  shapeSorter(p, box, R)
  sorterShape(p, [hand[0] + 0.1 * R, hand[1] - 0.3 * R], R, 'circle')
  bareHand(p, kid, hand, R)
  sorterShape(p, [hx - 2.3 * R, ground], R, 'triangle')
  sorterShape(p, [hx - 1.6 * R, ground + 0.25 * R], R, 'square')
}

const blocksStory: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.86)
  s.backdrop('playroom', ground)
  const R = s.fit(tall(kid, 'sit'), 0.52)
  const fallen = s.index % 2 === 1
  s.child(kid, 'sit', [f.cx + 0.1 * f.unit, ground], R, { arms: fallen ? 'up' : 'clap', expression: fallen ? 'laugh' : 'grin' })
  blocks(p, [f.cx - 0.17 * f.unit, ground + 0.2 * R], 0.95 * R, ['A', 'B', 'C'], PALETTE, fallen)
}

const counting: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.88)
  s.backdrop('playroom', ground)
  const R = s.fit(tall(kid), 0.56)
  const at: Point = [f.X(0.3), ground]
  const [hx, hy] = s.headOf(kid, 'stand', at, R)
  s.child(kid, 'stand', at, R, { reach: [null, [hx + 1.6 * R, hy + 2.3 * R]], expression: 'laugh' })
  ;['8', '9', '10'].forEach((label, index) => blocks(p, [f.X(0.55 + index * 0.13), ground + 0.1 * R], 0.95 * R, [label], [PALETTE[index]]))
  s.say('…eight, nine, TEN!', [hx, hy + 0.5 * R], R * 0.75, 1)
}

const teaParty: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.9)
  s.backdrop('home', ground)
  const R = s.fit(tall(kid, 'kneel'), 0.5)
  const table: Point = [f.cx, ground - 1.7 * R]
  for (const side of [-1, 1]) p.add(line([[table[0] + side * 1.5 * R, table[1]], [table[0] + side * 1.7 * R, ground]], [214, 170, 120], 0.25 * R))
  p.add(oval(table, 2.4 * R, 0.6 * R, [244, 238, 250]))
  const brother = s.is(/two/i) ? s.sibling(kid) : null
  const at: Point = [f.cx - 3.0 * R, ground + 0.2 * R]
  const [hx, hy] = s.headOf(kid, 'kneel', at, R)
  const hand: Point = [hx + 1.4 * R, hy + 1.3 * R]
  s.child(kid, 'kneel', at, R, { reach: [null, hand], expression: 'grin' })
  cup(p, [hand[0] + 0.1 * R, hand[1] + 0.25 * R], 0.5 * R, [244, 114, 182], [196, 132, 82])
  bareHand(p, kid, hand, R)
  if (brother) {
    const r = (R * scaleOf(brother.months)) / scaleOf(kid.months)
    const j = s.child(brother, 'sit', [f.cx + 3.0 * R, ground + 0.2 * R], r, { arms: 'feed', expression: 'laugh' })
    cup(p, [j.hands[1][0] + 0.1 * r, j.hands[1][1] + 0.5 * r], 0.8 * r, [96, 165, 250])
  } else teddy(p, [f.cx + 3.0 * R, ground + 0.2 * R], 0.9 * R)
  teaSet(p, [table[0], table[1] - 0.1 * R], 0.75 * R, [244, 114, 182])
}

const dressing: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.9)
  s.backdrop('home', ground)
  const R = s.fit(tall(kid), 0.6)
  const j = s.child(kid, 'stand', [f.cx, ground], R, { arms: 'hips', wrongShoes: true, expression: 'grin' })
  s.say('All by myself!', [j.head[0], j.head[1] + 0.5 * R], R * 0.75, s.side)
  p.add(oval([f.cx - 2.6 * R, ground + 0.2 * R], 0.5 * R, 0.18 * R, [250, 204, 21], 1, 15))
  p.add(trapezoid2(f.cx + 2.7 * R, ground + 0.1 * R, R, s.color(kid.slug === 'emma' ? 'leo' : 'emma')))
}

/** A T-shirt lying on the floor. */
function trapezoid2(x: number, y: number, R: number, color: Rgb): string {
  return polygon([[x - 0.9 * R, y - 0.5 * R], [x - 0.35 * R, y - 0.7 * R], [x + 0.35 * R, y - 0.7 * R], [x + 0.9 * R, y - 0.5 * R], [x + 0.7 * R, y - 0.15 * R], [x + 0.45 * R, y - 0.25 * R], [x + 0.45 * R, y + 0.25 * R], [x - 0.45 * R, y + 0.25 * R], [x - 0.45 * R, y - 0.25 * R], [x - 0.7 * R, y - 0.15 * R]], color)
}

const storyTime: Story = (s) => {
  const { f, p } = s
  const [emma, leo] = [s.kid('emma'), s.kid('leo')]
  const ground = f.Y(0.94)
  s.backdrop('home', ground)
  const R = f.unit * 0.095
  const r = (R * scaleOf(leo.months)) / scaleOf(emma.months)
  const seat = sofa(p, f.cx, ground, 13 * R, R, [134, 179, 140])
  const eAt: Point = [f.cx - 1.6 * R, seat]
  const [ex, ey] = s.headOf(emma, 'perch', eAt, R)
  const pages: Point = [ex + 0.3 * R, ey + 2.35 * R]
  const hands: [Point, Point] = [[pages[0] - 1.0 * R, pages[1] + 0.2 * R], [pages[0] + 1.0 * R, pages[1] + 0.2 * R]]
  s.child(leo, 'perch', [f.cx + 1.9 * R, seat], r, { expression: s.index % 2 ? 'laugh' : 'wow' })
  s.child(emma, 'perch', eAt, R, { reach: hands, expression: 'grin' })
  book(p, pages, 0.95 * R, [124, 58, 237])
  for (const hand of hands) bareHand(p, emma, hand, R)
}

const siblings: Story = (s) => {
  const { f, p } = s
  const [emma, leo] = [s.kid('emma'), s.kid('leo')]
  const cue = s.cue()
  if (s.is(/kiss/i)) {
    const ground = f.Y(0.98)
    s.backdrop('hospital', ground)
    const Ra = f.unit * 0.11
    s.holding('mum', leo, [f.X(0.38), ground], Ra, {}, { kneel: true, expression: 'grin' })
    const R = Ra * scaleOf(emma.months)
    const j = s.child(emma, 'stand', [f.X(0.66), ground], R, { arms: 'reach', mirror: true, expression: 'kiss' })
    heart(p, [j.head[0] - 0.9 * R, j.head[1] - 1.7 * R], 0.35 * R, [244, 114, 182])
    heart(p, [j.head[0] - 0.2 * R, j.head[1] - 2.2 * R], 0.25 * R, [244, 114, 182], 0.8)
    return
  }
  if (cue === 'mum' || cue === 'dad') {
    const ground = f.Y(0.98)
    s.backdrop('hospital', ground)
    const Ra = f.unit * 0.105
    s.holding(cue, leo, [f.X(0.36), ground], Ra)
    s.child(emma, 'stand', [f.X(0.68), ground], Ra * scaleOf(emma.months), { arms: 'clap', expression: 'wow' })
    return
  }
  if (s.index === 0 || s.is(/brother/i)) {
    const ground = f.Y(0.86)
    s.backdrop('hospital', ground)
    const R = s.fit(tall(emma, 'sit'), 0.6)
    const at: Point = [f.cx, ground]
    const [hx, hy] = s.headOf(emma, 'sit', at, R)
    s.child(emma, 'sit', at, R, { arms: 'hold', expression: 'grin' })
    s.lying(leo, [hx + 0.2 * R, hy + 2.0 * R], R * 0.85, -80)
    heart(p, [hx + 1.7 * R, hy - 1.2 * R], 0.3 * R, [244, 114, 182])
    return
  }
  s.family([emma, leo], 'hospital')
}

const weekend: Story = (s) => {
  const { f, p } = s
  const [emma, leo] = [s.kid('emma'), s.kid('leo')]
  switch (s.index % 4) {
    case 1: {
    const edge = f.Y(0.64)
    s.atTable([{ kid: emma, x: f.X(0.3), look: { expression: 'laugh' } }, { kid: leo, x: f.X(0.7), look: { arms: 'up', expression: 'grin' } }], 'kitchen', edge, [96, 165, 250], (R) => {
      pancakes(p, [f.X(0.3), edge + 0.2 * f.unit], 1.1 * R)
      pancakes(p, [f.X(0.7), edge + 0.22 * f.unit], R)
    })
    return
    }
    case 2: {
    const ground = f.Y(0.9)
    s.backdrop('garden', ground)
    puddle(p, [f.cx, ground + 0.02 * f.unit], 0.6 * f.unit, true)
    const Rb = f.unit * 0.1
    s.child(emma, 'jump', [f.X(0.38), ground], (Rb * scaleOf(emma.months)) / scaleOf(30), { arms: 'up', expression: 'laugh', hat: 'beanie' })
    s.child(leo, 'stand', [f.X(0.66), ground], (Rb * scaleOf(leo.months)) / scaleOf(30), { arms: 'out', expression: 'laugh', hat: 'beanie' })
    return
    }
    case 3: {
    const ground = f.Y(0.94)
    s.backdrop('bedroom', ground)
    const Ra = f.unit * 0.1
    s.grown('grandpa', [f.X(0.28), ground], Ra, { kneel: true, arms: 'hold', expression: 'smile' }, (cradle) => book(p, cradle, 0.75 * Ra, [37, 99, 235]))
    const Rb = f.unit * 0.1
    s.child(emma, 'sit', [f.X(0.58), ground], (Rb * scaleOf(emma.months)) / scaleOf(30), { outfit: 'pyjamas', arms: 'clap', expression: 'wow' })
    s.child(leo, 'sit', [f.X(0.8), ground], (Rb * scaleOf(leo.months)) / scaleOf(30), { outfit: 'pyjamas', expression: 'sleep' })
    return
    }
    default:
    s.grandparents([emma, leo], 'home')
  }
}

function asleep(s: Shot, kid: Kid, grownUp: Adult | null): void {
  const { f, p } = s
  const floor = f.Y(0.9)
  s.backdrop('bedroom', floor)
  const R = f.unit * 0.1
  const width = 9.5 * R
  const x = f.cx + (grownUp ? 0.1 * f.unit : 0)
  const { pillow, cover } = bed(p, x, floor, width, R, [214, 170, 120], s.color(kid.slug))
  rotated(p, pillow, -12, () => head(p, kid, pillow[0] + 0.15 * R, pillow[1] - 0.55 * R, R * 0.95, grownUp ? 'calm' : 'sleep'))
  cover()
  teddy(p, [x + width / 2 - 1.6 * R, floor - 2.5 * R], 0.55 * R)
  if (grownUp) s.grown(grownUp, [f.X(0.14), f.Y(1.02)], f.unit * 0.1, { kneel: true, arms: 'hold', expression: 'smile' }, (cradle) => book(p, cradle, 0.7 * f.unit * 0.1, [37, 99, 235]))
  else p.add(text([pillow[0] + 1.6 * R, pillow[1] - 1.8 * R], 'z z', 0.7 * R, WHITE))
}

const sleepover: Story = (s) => asleep(s, s.main, s.index % 2 ? 'grandma' : null)
const bigBed: Story = (s) => asleep(s, s.main, null)

const brushing: Story = (s) => {
  const { f, p } = s
  const kid = s.main
  const ground = f.Y(0.9)
  s.backdrop('bathroom', ground)
  const R = s.fit(tall(kid) + 0.8, 0.62)
  const step = 0.8 * R
  p.add(rect(f.cx - 1.8 * R, ground - step, f.cx + 1.8 * R, ground, [96, 165, 250], 1, 0.15 * R))
  const at: Point = [f.cx, ground - step]
  const [hx, hy] = s.headOf(kid, 'stand', at, R)
  const hand: Point = [hx + 0.9 * R, hy + 1.15 * R]
  s.child(kid, 'stand', at, R, { reach: [null, hand], expression: 'cream', outfit: 'pyjamas' })
  p.add(line([hand, [hx + 0.2 * R, hy + 0.6 * R]], [74, 222, 128], 0.16 * R, 1, 'round'))
  p.add(rect(hx + 0.05 * R, hy + 0.45 * R, hx + 0.35 * R, hy + 0.65 * R, WHITE, 1, 0.05 * R))
  bareHand(p, kid, hand, R)
}

/** Any other milestone: the child in the milestone's scene. */
function portraitIn(backdrop: Backdrop): Story {
  return (s) => {
    const { f } = s
    const kid = s.main
    if (s.index % 3 === 2) {
    s.closeUp(kid, backdrop, { expression: 'grin' })
    return
    }
    const ground = f.Y(0.9)
    s.backdrop(backdrop, ground)
    const pose: Pose = kid.months < 4 ? 'sit' : kid.months < 12 ? 'sit' : 'stand'
    const R = s.fit(tall(kid, pose), 0.58)
    s.child(kid, pose, [f.cx, ground], R, { arms: s.index ? 'wave' : 'down', expression: 'grin' })
  }
}

// Stories and their milestones -----------------------------------------------------------------

const STORIES = {
  newborn: [newborn, 'hospital'],
  homecoming: [homecoming, 'home'],
  bath: [bath, 'bathroom'],
  smile: [smile, 'home'],
  tummy: [tummy, 'playroom'],
  laugh: [laugh, 'blanket'],
  seaside: [seaside, 'beach'],
  rollover: [rollover, 'playroom'],
  grabs: [grabs, 'blanket'],
  gym: [gym, 'blanket'],
  babble: [(s: Shot) => talking(s, 'Ba-ba-ba!', 'toys'), 'home'],
  poolSplash: [poolSplash, 'pool'],
  swimming: [swimming, 'pool'],
  poolJump: [poolJump, 'pool'],
  puree: [puree, 'kitchen'],
  sit: [sitUp, 'playroom'],
  toothbrush: [brushing, 'bathroom'],
  tooth: [tooth, 'home'],
  fingerFood: [fingerFood, 'kitchen'],
  pumpkin: [pumpkinBaby, 'halloween'],
  halloween: [halloweenStory, 'halloween'],
  crawl: [crawl, 'playroom'],
  baking: [baking, 'kitchen'],
  stocking: [stockings, 'christmas'],
  christmas: [christmasStory, 'christmas'],
  sofa: [sofaStory, 'home'],
  mama: [(s: Shot) => talking(s, 'Mama!', 'mum'), 'home'],
  dada: [(s: Shot) => talking(s, 'Dada!', 'dad'), 'home'],
  emmy: [(s: Shot) => talking(s, 'Emmy!', 'emma'), 'home'],
  yum: [yum, 'kitchen'],
  clap: [clap, 'playroom'],
  butterflies: [butterflies, 'classroom'],
  nativity: [nativity, 'stage'],
  sportsDay: [sportsDay, 'park'],
  nursery: [nursery, 'street'],
  birthday: [birthday, 'party'],
  cakeTaste: [cakeTaste, 'kitchen'],
  steps: [steps, 'park'],
  swing: [swingStory, 'park'],
  shapes: [shapes, 'playroom'],
  sleepover: [sleepover, 'bedroom'],
  sandcastle: [sandcastleStory, 'beach'],
  beach: [beachDay, 'beach'],
  iceCream: [iceCreamStory, 'park'],
  siblings: [siblings, 'hospital'],
  spoon: [spoonFeeding, 'kitchen'],
  scribble: [scribble, 'classroom'],
  face: [face, 'classroom'],
  letter: [letter, 'classroom'],
  haircut: [haircut, 'salon'],
  jump: [jumpStory, 'park'],
  zoo: [zoo, 'zoo'],
  puzzle: [puzzleStory, 'playroom'],
  dressing: [dressing, 'home'],
  story: [storyTime, 'home'],
  trike: [trikeStory, 'park'],
  blocks: [blocksStory, 'playroom'],
  counting: [counting, 'playroom'],
  teaParty: [teaParty, 'home'],
  waves: [waves, 'home'],
  pegs: [namePeg, 'classroom'],
  garden: [garden, 'garden'],
  bike: [bike, 'park'],
  kick: [kick, 'park'],
  weekend: [weekend, 'home'],
  cup: [drinking, 'kitchen'],
  run: [run, 'park'],
  bigBed: [bigBed, 'bedroom'],
  leaves: [leafHunt, 'autumn'],
  park: [portraitIn('park'), 'park'],
  beachPortrait: [portraitIn('beach'), 'beach'],
  home: [portraitIn('home'), 'home'],
  party: [portraitIn('party'), 'party'],
  night: [portraitIn('bedroom'), 'bedroom'],
  meal: [portraitIn('kitchen'), 'kitchen'],
  school: [portraitIn('classroom'), 'classroom'],
  play: [portraitIn('playroom'), 'playroom'],
  christmasPortrait: [portraitIn('christmas'), 'christmas'],
} as const satisfies Record<string, readonly [Story, Backdrop]>

export type StoryKey = keyof typeof STORIES

/** Milestone titles and their stories, most specific first. */
const RULES: ReadonlyArray<readonly [RegExp, StoryKey]> = [
  [/^welcome/i, 'newborn'],
  [/first day at home/i, 'homecoming'],
  [/first bath/i, 'bath'],
  [/first smile/i, 'smile'],
  [/lifts (her|his) head/i, 'tummy'],
  [/belly laughs/i, 'laugh'],
  [/trip to the seaside/i, 'seaside'],
  [/rolls over/i, 'rollover'],
  [/grabs/i, 'grabs'],
  [/follows toys/i, 'gym'],
  [/babbles/i, 'babble'],
  [/splash in the pool/i, 'poolSplash'],
  [/swims/i, 'swimming'],
  [/jumps into the pool/i, 'poolJump'],
  [/pur[ée]e/i, 'puree'],
  [/sits up/i, 'sit'],
  [/brushes (his|her) teeth/i, 'toothbrush'],
  [/tooth|teeth/i, 'tooth'],
  [/pincer|finger food/i, 'fingerFood'],
  [/halloween costume/i, 'pumpkin'],
  [/halloween/i, 'halloween'],
  [/crawls/i, 'crawl'],
  [/christmas eve baking/i, 'baking'],
  [/christmas eve/i, 'stocking'],
  [/christmas/i, 'christmas'],
  [/sofa/i, 'sofa'],
  [/"mama"/i, 'mama'],
  [/"dada"/i, 'dada'],
  [/"emmy"/i, 'emmy'],
  [/"yum"/i, 'yum'],
  [/claps/i, 'clap'],
  [/butterflies/i, 'butterflies'],
  [/nativity/i, 'nativity'],
  [/sports day/i, 'sportsDay'],
  [/first day at (nursery|pre-school)|back to nursery/i, 'nursery'],
  [/birthday|today!/i, 'birthday'],
  [/taste of cake/i, 'cakeTaste'],
  [/first steps/i, 'steps'],
  [/swings/i, 'swing'],
  [/shape sorter/i, 'shapes'],
  [/sleepover/i, 'sleepover'],
  [/sandcastle/i, 'sandcastle'],
  [/beach|holiday/i, 'beach'],
  [/ice cream/i, 'iceCream'],
  [/brother and sister/i, 'siblings'],
  [/with a spoon/i, 'spoon'],
  [/scribbles/i, 'scribble'],
  [/draws a face/i, 'face'],
  [/writes an e\b/i, 'letter'],
  [/haircut/i, 'haircut'],
  [/jumps with both feet/i, 'jump'],
  [/zoo/i, 'zoo'],
  [/puzzle/i, 'puzzle'],
  [/gets dressed/i, 'dressing'],
  [/reads .* a story/i, 'story'],
  [/trike/i, 'trike'],
  [/stacks/i, 'blocks'],
  [/counts/i, 'counting'],
  [/tea party/i, 'teaParty'],
  [/waves/i, 'waves'],
  [/recognises her name/i, 'pegs'],
  [/vegetable/i, 'garden'],
  [/balance bike/i, 'bike'],
  [/kicks/i, 'kick'],
  [/grandma and grandpa's/i, 'weekend'],
  [/open cup/i, 'cup'],
  [/^runs/i, 'run'],
  [/big(-girl)? bed/i, 'bigBed'],
  [/leaf/i, 'leaves'],
]

const SCENE_STORIES: Readonly<Record<string, StoryKey>> = {
  park: 'park',
  beach: 'beachPortrait',
  home: 'home',
  party: 'party',
  night: 'night',
  meal: 'meal',
  school: 'school',
  play: 'play',
  christmas: 'christmasPortrait',
}

/** The story a milestone's title tells, when it has one of its own. */
export function titleStory(title: string): StoryKey | null {
  return RULES.find(([pattern]) => pattern.test(title))?.[1] ?? null
}

/** The story of a milestone, from its title (or its scene for anything else). */
export function storyOf(title: string, scene: string): StoryKey {
  return titleStory(title) ?? SCENE_STORIES[scene] ?? 'home'
}

/** The backdrop a story mostly happens in (for the photo's average colour). */
export function storyBackdrop(story: StoryKey): Backdrop {
  return STORIES[story][1]
}

export function paintStory(p: Painting, random: Random, hue: number, story: StoryKey, moment: Moment): void {
  STORIES[story][0](new Shot(p, random, hue, moment))
}
