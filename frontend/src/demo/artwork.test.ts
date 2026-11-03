import { describe, expect, it } from 'vitest'
import { titleStory } from './art/stories'
import { THUMB_SIZE, dominantColor, photoArt, renderArt, type Art } from './artwork'
import { CHILDREN, MILESTONES, buildScenario } from './scenario'

/** Every photo of the scenario: the milestones shown today and the year still to come. */
const PHOTOS = buildScenario(new Date('2027-10-20T12:00:00')).events.flatMap((event) =>
  event.photos.map((photo, index) => ({
    title: event.milestone.title,
    milestone: `${event.milestone.date} ${event.milestone.title}`,
    label: `${event.milestone.title} · ${photo.name}`,
    art: photoArt(event.milestone, photo, index),
  })),
)
const SKIN = '#f6d4ba'

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml')
}

function photoOf(title: string, caption?: string) {
  const found = PHOTOS.find((photo) => photo.title === title && (caption === undefined || photo.art.caption === caption))
  if (!found) throw new Error(`No photo "${caption}" in "${title}"`)
  return found.art
}

describe('demo artwork', () => {
  it('plans a picture for every photo of every milestone', () => {
    expect(PHOTOS).toHaveLength(MILESTONES.reduce((sum, milestone) => sum + milestone.photos, 0))
  })

  it('gives every milestone with photos a story of its own', () => {
    expect(MILESTONES.filter((milestone) => milestone.photos > 0 && titleStory(milestone.title) === null).map(({ title }) => title)).toEqual([])
  })

  it('draws every photo as a well-formed SVG with a child in it', () => {
    const problems: string[] = []
    for (const { label, art } of PHOTOS) {
      const svg = renderArt(art, 'display')
      const document = parse(svg)
      if (document.querySelector('parsererror')) {
        problems.push(`${label}: not well-formed`)
        continue
      }
      if (document.documentElement.getAttribute('viewBox') !== `0 0 ${art.width} ${art.height}`) problems.push(`${label}: viewBox`)
      const ids = new Set([...document.querySelectorAll('[id]')].map((element) => element.id))
      for (const [, id] of svg.matchAll(/url\(#([\w-]+)\)/g)) if (!ids.has(id)) problems.push(`${label}: missing #${id}`)
      if (/NaN|undefined|Infinity/.test(svg)) problems.push(`${label}: invalid number`)
      if (!svg.includes(SKIN)) problems.push(`${label}: nobody in it`)
    }
    expect(problems).toEqual([])
  })

  it('crops thumbnails to the centred square', () => {
    const landscape = PHOTOS.find(({ art }) => art.width > art.height)?.art
    const portrait = PHOTOS.find(({ art }) => art.width < art.height)?.art
    if (!landscape || !portrait) throw new Error('The scenario should have landscape and portrait photos')
    const wide = parse(renderArt(landscape, 'thumb')).documentElement
    expect(wide.getAttribute('width')).toBe(String(THUMB_SIZE))
    expect(wide.getAttribute('height')).toBe(String(THUMB_SIZE))
    expect(wide.getAttribute('viewBox')).toBe(`${(landscape.width - landscape.height) / 2} 0 ${landscape.height} ${landscape.height}`)
    expect(parse(renderArt(portrait, 'thumb')).documentElement.getAttribute('viewBox')).toBe(`0 ${(portrait.height - portrait.width) / 2} ${portrait.width} ${portrait.width}`)
  })

  it('shows the same children at their age, dressed alike in each milestone', () => {
    expect(photoOf('Welcome, Emma!').cast).toEqual([{ slug: 'emma', months: 0 }])
    expect(photoOf('Three today!').cast[0].months).toBeCloseTo(36, 0)
    const meet = photoOf('Brother and sister meet')
    expect(meet.cast.map(({ slug }) => slug)).toEqual(['emma', 'leo'])
    expect(meet.ages.emma).toBeCloseTo(18.3, 0)
    expect(meet.ages.leo).toBeCloseTo(0, 0)
    expect(photoOf('First day at nursery').ages.leo).toBeLessThan(0)
    const outfits = new Map<string, Set<number>>()
    for (const { milestone, art } of PHOTOS) outfits.set(milestone, (outfits.get(milestone) ?? new Set()).add(art.outfit))
    expect([...outfits].filter(([, set]) => set.size > 1).map(([milestone]) => milestone)).toEqual([])
  })

  it('brings in the grown-ups a photo is named after', () => {
    const grandparents = renderArt(photoOf('First Christmas', 'With Grandma and Grandpa'), 'display')
    expect(grandparents).toContain('#d4cdc6')
    expect(grandparents).toContain('#dad4ce')
    expect(renderArt(photoOf('Welcome, Emma!', 'With Mum'), 'display')).toContain('#6b4226')
  })

  it('is deterministic per seed and varies between seeds', () => {
    const art = photoOf('First trip to the zoo', 'The giraffes')
    expect(renderArt({ ...art }, 'display')).toBe(renderArt(art, 'display'))
    expect(renderArt({ ...art, seed: art.seed + 1 }, 'display')).not.toBe(renderArt(art, 'display'))
    expect(dominantColor({ ...art })).toBe(dominantColor(art))
  })

  it('gives every picture a #rrggbb average colour', () => {
    expect(PHOTOS.filter(({ art }) => !/^#[0-9a-f]{6}$/.test(dominantColor(art))).map(({ label }) => label)).toEqual([])
  })

  it('draws a portrait of each child', () => {
    for (const child of CHILDREN) {
      const art: Art = { kind: 'avatar', seed: child.slug, background: child.background, hair: child.hair, shirt: child.shirt, pigtails: child.pigtails }
      expect(parse(renderArt(art, 'display')).documentElement.getAttribute('viewBox')).toBe('0 0 800 800')
      expect(parse(renderArt(art, 'thumb')).documentElement.getAttribute('width')).toBe(String(THUMB_SIZE))
      expect(dominantColor(art)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
