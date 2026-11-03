import { describe, expect, it } from 'vitest'
import { shiftISODate, toISODate } from '../utils/dates'
import { CAPTIONS, CATEGORIES, CHILDREN, MILESTONES, REFERENCE_DAY, USERS, buildScenario, yearsSinceReference, type Milestone } from './scenario'

/** Midday of a local calendar day. */
function day(iso: string): Date {
  const [year, month, date] = iso.split('-').map(Number)
  return new Date(year, month - 1, date, 12)
}

function daysBetween(from: string, to: string): number {
  return Math.round((day(to).getTime() - day(from).getTime()) / 86_400_000)
}

const CATEGORY_KEYS = new Set<string>(CATEGORIES.map((category) => category.key))
const BIRTHS = new Map(CHILDREN.map((child) => [child.slug, child.birthDate]))

/** What a milestone breaks of the API limits (EventIn) and of the story. */
function problems(item: Milestone): string[] {
  const found: string[] = []
  if (item.title.length > 120 || item.title.trim() !== item.title) found.push('title')
  if (item.notes.length > 5000) found.push('notes')
  if ((item.location ?? '').length > 200) found.push('location')
  if (item.photos < 0 || item.photos > 6 || item.captions.length > item.photos) found.push('photos')
  if (item.children.length === 0) found.push('children')
  if (new Set(item.categories).size !== item.categories.length) found.push('duplicate categories')
  for (const key of item.categories) if (!CATEGORY_KEYS.has(key)) found.push(`category ${key}`)
  for (const slug of item.children) if (item.date < (BIRTHS.get(slug) as string)) found.push(`before ${slug} was born`)
  return found.map((problem) => `${item.date} ${item.title}: ${problem}`)
}

describe('demo content', () => {
  it('tells the story in date order and within the API limits', () => {
    const dates = MILESTONES.map((item) => item.date)
    expect(dates).toEqual(dates.toSorted())
    expect(MILESTONES.flatMap(problems)).toEqual([])
    expect(Object.values(CAPTIONS).flat().filter((name) => name.length > 160)).toEqual([])
  })

  it('uses every category, both children and some shared milestones', () => {
    expect(new Set(MILESTONES.flatMap((item) => item.categories))).toEqual(CATEGORY_KEYS)
    expect(new Set(MILESTONES.flatMap((item) => item.children))).toEqual(new Set(['emma', 'leo']))
    expect(MILESTONES.filter((item) => item.children.length === 2).length).toBeGreaterThanOrEqual(10)
  })

  it('names the categories like the backend’s seed, in European Portuguese too', () => {
    expect(Object.fromEntries(CATEGORIES.map((category) => [category.key, category.name_pt]))).toEqual({
      general: 'Geral',
      academic: 'Académico',
      teething: 'Dentição',
      language: 'Linguagem e comunicação',
      sleep: 'Sono',
      'gross-motor': 'Motricidade global',
      'fine-motor': 'Motricidade fina',
      cognitive: 'Desenvolvimento cognitivo',
      'social-emotional': 'Desenvolvimento social e emocional',
      feeding: 'Alimentação',
      'self-care': 'Autonomia e cuidados pessoais',
    })
    // CategoryIn: 1-60 characters on a single line, in every language.
    const names = CATEGORIES.flatMap((category) => [category.name_es, category.name_en, category.name_pt])
    expect(names.filter((name) => name.length < 1 || name.length > 60 || name !== name.split(/\s+/).filter(Boolean).join(' '))).toEqual([])
  })

  it('is written in English', () => {
    const text = MILESTONES.flatMap((item) => [item.title, item.notes, item.location ?? '', ...item.captions]).join('\n')
    // Spanish punctuation and words only: English keeps words like "purée".
    expect(text).not.toMatch(/[ñ¿¡«»]|\b(el|la|los|las|con|una|del)\b/i)
  })

  it('has one visitor administrator, signing in with a password like everyone', () => {
    expect(USERS[0]).toMatchObject({ role: 'admin', password: 'set', disabled: false })
    expect(new Set(USERS.map((user) => user.email)).size).toBe(USERS.length)
    // Someone who was just given access has not changed their temporary password yet.
    expect(USERS.filter((user) => user.password === 'temporary').every((user) => user.lastLoginMinutesAgo === null)).toBe(true)
  })
})

describe('buildScenario', () => {
  it('shows the 82 milestones written up to the reference day', () => {
    const scenario = buildScenario(day(REFERENCE_DAY))
    expect(scenario.yearShift).toBe(0)
    expect(scenario.events).toHaveLength(MILESTONES.filter((item) => item.date <= REFERENCE_DAY).length)
    expect(scenario.events).toHaveLength(82)
    expect(scenario.children.map((child) => [child.name, child.birthDate])).toEqual([
      ['Emma', '2024-03-10'],
      ['Leo', '2025-09-18'],
    ])
  })

  it('counts whole years from the reference day', () => {
    expect(yearsSinceReference(REFERENCE_DAY)).toBe(0)
    expect(yearsSinceReference('2027-10-20')).toBe(0)
    expect(yearsSinceReference('2027-10-21')).toBe(1)
    expect(yearsSinceReference('2026-10-20')).toBe(-1)
    expect(yearsSinceReference('2031-01-01')).toBe(4)
  })

  it('always reaches today and keeps birthdays and holidays on their calendar dates', () => {
    const found: string[] = []
    for (let offset = 0; offset < 3 * 366; offset += 5) {
      const today = shiftISODate(REFERENCE_DAY, { days: offset })
      const { events, children } = buildScenario(day(today))
      const born = new Map(children.map((child) => [child.slug, child.birthDate]))
      const latest = events.at(-1)?.date ?? ''
      if (latest > today || daysBetween(latest, today) > 31) found.push(`${today}: latest milestone on ${latest}`)
      for (const { milestone, date } of events) {
        const expected = /birthday|today!/i.test(milestone.title)
          ? (born.get(milestone.children[0]) as string).slice(5)
          : /Christmas Eve/.test(milestone.title)
            ? '12-24'
            : /^(First Christmas|Christmas together|Christmas Day)$/.test(milestone.title)
              ? '12-25'
              : /Halloween/.test(milestone.title)
                ? '10-31'
                : date.slice(5)
        if (date.slice(5) !== expected) found.push(`${today}: ${milestone.title} on ${date}`)
        if (milestone.children.some((slug) => date < (born.get(slug) as string))) found.push(`${today}: ${milestone.title} before birth`)
      }
    }
    expect(found).toEqual([])
  })

  it('never records a milestone after now', () => {
    const now = day('2027-03-10')
    const { events } = buildScenario(now)
    expect(events.at(-1)?.milestone.title).toBe('Three today!')
    expect(events.filter((event) => Date.parse(event.recordedAt) > now.getTime())).toEqual([])
    expect(events.filter((event) => toISODate(new Date(event.recordedAt)) < event.date)).toEqual([])
  })

  it('is deterministic, with photos that do not depend on which milestones are shown', () => {
    const early = buildScenario(day(REFERENCE_DAY))
    const later = buildScenario(day('2027-06-01'))
    expect(buildScenario(day(REFERENCE_DAY))).toEqual(early)
    expect(later.events.slice(0, early.events.length).map((event) => event.photos)).toEqual(early.events.map((event) => event.photos))
    const ids = later.events.flatMap((event) => event.photos.map((photo) => photo.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(later.events.filter((event) => event.photos.length !== event.milestone.photos)).toEqual([])
    expect(
      later.events.filter(
        (event) => event.photos.slice(0, event.milestone.captions.length).map((photo) => photo.name).join('|') !== event.milestone.captions.join('|'),
      ),
    ).toEqual([])
    expect(later.events.filter((event) => event.cover >= Math.max(1, event.photos.length))).toEqual([])
  })
})
