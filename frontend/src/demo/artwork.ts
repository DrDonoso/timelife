/**
 * Demo pictures, drawn as SVG in the browser: the photos of the family's milestones, where Emma and
 * Leo act each one out (art/stories.ts), and the children's portraits (render_avatar in
 * src/timelife/demo.py). `display` is the whole picture and `thumb` its centred square crop, like
 * the variants the real upload pipeline stores. Deterministic: the same art always draws the same
 * picture.
 */
import type { ImageCrop } from '../api/schema.gen'
import { cropBox } from '../utils/crop'
import { KIDS, type Kid, type Slug } from './art/figures'
import { Painting, WHITE, ellipse, hex, mix, n, onEllipse, paint, pieslice, polygon, rect, rgb, type Rgb } from './art/paint'
import { backdropColor, type Backdrop } from './art/scenes'
import { paintStory, storyBackdrop, storyOf, type StoryKey } from './art/stories'
import { Random } from './random'
import { CHILDREN, type Milestone } from './scenario'

export type Variant = 'thumb' | 'display'

export interface PhotoArt {
  kind: 'photo'
  width: number
  height: number
  seed: number
  /** What the photo shows: the milestone's story, its children, the photo's name and position. */
  story: StoryKey
  cast: readonly Kid[]
  /** Both children's ages that day, in months (negative before birth). */
  ages: Readonly<Record<Slug, number>>
  caption: string
  index: number
  /** The day's clothes (the same in every photo of a milestone). */
  outfit: number
}

export interface AvatarArt {
  kind: 'avatar'
  /** Avatar seed (the child's slug). */
  seed: string
  background: readonly [string, string]
  hair: string
  shirt: string
  pigtails: boolean
}

export type Art = PhotoArt | AvatarArt

export const THUMB_SIZE = 512
export const AVATAR_SIZE = 800

/** Colour grades ("light" of the moment): golden, rose, teal, lavender, mint, peach and sky. */
const GRADES: readonly Rgb[] = [
  [255, 190, 110],
  [255, 160, 185],
  [110, 205, 215],
  [185, 165, 255],
  [160, 230, 175],
  [255, 205, 160],
  [140, 185, 255],
]
const OUTDOORS: ReadonlySet<Backdrop> = new Set(['park', 'zoo', 'garden', 'autumn', 'beach', 'sunset', 'pool'])
const DAY = 24 * 60 * 60 * 1000

function months(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY / 30.4375
}

function hash(text: string): number {
  let value = 0
  for (const char of text) value = (Math.imul(value, 31) + (char.codePointAt(0) ?? 0)) >>> 0
  return value
}

/** What photo `index` of a milestone shows (dates on the scenario's reference calendar). */
export function photoArt(milestone: Milestone, { width, height, seed, name }: { width: number; height: number; seed: number; name: string }, index: number): PhotoArt {
  const ages = Object.fromEntries(CHILDREN.map((child) => [child.slug, months(child.birthDate, milestone.date)])) as Record<Slug, number>
  return {
    kind: 'photo',
    width,
    height,
    seed,
    story: storyOf(milestone.title, milestone.scene),
    cast: milestone.children.map((slug) => ({ slug, months: ages[slug] })),
    ages,
    caption: name,
    index,
    outfit: hash(`${milestone.date} ${milestone.title}`) % 5,
  }
}

/** The light of a photo, drawn before the picture: hue shift of the place and colour grade. */
function look({ story, seed }: PhotoArt) {
  const random = new Random(seed)
  const wide = OUTDOORS.has(storyBackdrop(story)) ? 0.05 : 0.12
  const hue = random.uniform(-wide, wide)
  const grade = random.choice(GRADES)
  const strength = random.uniform(0.3, 0.6)
  return { random, hue, grade, strength }
}

function drawPhoto(art: PhotoArt): Painting {
  const { random, hue, grade, strength } = look(art)
  const picture = new Painting(art.width, art.height)
  paintStory(picture, random, hue, art.story, { cast: art.cast, ages: art.ages, caption: art.caption, index: art.index, outfit: art.outfit })
  picture.finish(grade, strength)
  return picture
}

/** A child's portrait (render_avatar in src/timelife/demo.py). */
function drawAvatar(art: AvatarArt): Painting {
  const side = AVATAR_SIZE
  const picture = new Painting(side, side)
  const unit = side / 100
  picture.background(rgb(art.background[0]), rgb(art.background[1]))
  picture.glow([side * 0.5, side * 0.45], side * 0.55, WHITE, 0.5)
  const skin: Rgb = [246, 212, 186]
  const hair = rgb(art.hair)
  const box = (left: number, top: number, right: number, bottom: number) => [left * unit, top * unit, right * unit, bottom * unit] as const

  picture.add(ellipse(...box(14, 76, 86, 130), rgb(art.shirt)))
  picture.add(rect(...box(44, 64, 56, 80), skin, 1, 4 * unit))
  if (art.pigtails) {
    for (const left of [14, 70]) {
      picture.add(ellipse(...box(left, 30, left + 16, 48), hair))
      picture.add(polygon([[(left + 8) * unit, 33 * unit], [(left + 2) * unit, 27 * unit], [(left + 2) * unit, 37 * unit]], [244, 114, 182]))
    }
  }
  for (const left of [23, 69]) picture.add(ellipse(...box(left, 44, left + 8, 56), skin))
  picture.add(ellipse(...box(27, 22, 73, 72), skin))
  // Hair: the top half of an ellipse (Pillow's chord from 180° to 360°).
  const [hl, ht, hr, hb] = box(25, 18, 75, 62)
  const middle = (ht + hb) / 2
  picture.add(`<path d="M${n(hl)},${n(middle)} A${n((hr - hl) / 2)},${n((hb - ht) / 2)} 0 0,1 ${n(hr)},${n(middle)} Z" ${paint(hair)}/>`)
  if (art.pigtails) picture.add(pieslice(...box(30, 28, 52, 48), 180, 300, hair))
  else {
    picture.add(ellipse(...box(44, 14, 56, 24), hair))
    picture.add(ellipse(...box(50, 12, 60, 21), hair))
  }
  for (const left of [37, 56]) {
    picture.add(ellipse(...box(left, 46, left + 7, 54), [62, 44, 40]))
    picture.add(ellipse(...box(left + 1.5, 47.5, left + 3.5, 49.5), WHITE))
    picture.add(ellipse(...box(left - 4, 55, left + 5, 61), [244, 143, 160], 110 / 255))
  }
  // Smile: Pillow's arc from 25° to 155°.
  const [ml, mt, mr, mb] = box(42, 52, 58, 64)
  const [mcx, mcy, mrx, mry] = [(ml + mr) / 2, (mt + mb) / 2, (mr - ml) / 2, (mb - mt) / 2]
  const [sx, sy] = onEllipse(mcx, mcy, mrx, mry, 25)
  const [ex, ey] = onEllipse(mcx, mcy, mrx, mry, 155)
  picture.add(
    `<path d="M${n(sx)},${n(sy)} A${n(mrx)},${n(mry)} 0 0,1 ${n(ex)},${n(ey)}" fill="none" stroke="#aa5050" stroke-width="${n(Math.max(2, 1.5 * unit))}" stroke-linecap="round"/>`,
  )
  picture.finish(null, 0)
  return picture
}

const rendered = new Map<string, string>()

/**
 * SVG document of a picture variant (memoised: every thumbnail is requested again and again);
 * thumbnails show `crop`'s square of the picture, or its centred square.
 */
export function renderArt(art: Art, variant: Variant, crop: ImageCrop | null = null): string {
  const framing = variant === 'thumb' ? crop : null
  const base =
    art.kind === 'photo'
      ? `photo:${art.seed}:${art.story}:${art.index}:${art.width}x${art.height}:${variant}`
      : `avatar:${art.seed}:${variant}`
  const key = framing ? `${base}:${framing.x}:${framing.y}:${framing.zoom}` : base
  let svg = rendered.get(key)
  if (svg === undefined) {
    const picture = art.kind === 'photo' ? drawPhoto(art) : drawAvatar(art)
    const square = framing ? cropBox(framing, { width: picture.width, height: picture.height }) : null
    svg = picture.render(variant === 'thumb' ? THUMB_SIZE : null, square)
    rendered.set(key, svg)
  }
  return svg
}

/** Approximate average colour (the placeholder shown while the picture loads), without drawing it. */
export function dominantColor(art: Art): string {
  if (art.kind === 'avatar') return hex(mix([[rgb(art.background[0]), 1], [rgb(art.background[1]), 1]]))
  const { hue, grade, strength } = look(art)
  const clothes = KIDS[art.cast[0].slug].colors[art.outfit % KIDS[art.cast[0].slug].colors.length]
  return hex(mix([[backdropColor(storyBackdrop(art.story), hue), 0.85 - strength * 0.3], [clothes, 0.15], [grade, strength * 0.3]]))
}
