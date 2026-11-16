import { readdirSync, readFileSync } from 'node:fs'
import { matchRoutes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { routes } from '../App'
import { LANGS } from '../i18n'
import { NOTE_ICONS, noteIcon } from './icons'
import { NOTES, NOTE_ID, byKind, byMonth, type Note } from './notes'

// Read from disk, every file (whatever its name), as written. The path stays a parameter: Vite rewrites
// `new URL(<literal>, import.meta.url)` into an asset URL.
const at = (path: string) => new URL(path, import.meta.url)
const FILE_NAMES = readdirSync(at('./notes/'))
const TITLE_MAX = 70
const BODY_MAX = 300

function realDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

/** A page of the app that is the same for every family: no child, milestone or other id in it. */
function isStaticPage(link: string): boolean {
  const last = matchRoutes(routes, link)?.at(-1)
  return /^\/[a-z0-9/-]*$/.test(link) && last !== undefined && last.route.path !== '*' && Object.keys(last.params).length === 0
}

/** Problems of one note file (an empty list when it is fine). */
function problems(name: string, raw: string): string[] {
  const found: string[] = []
  const id = name.replace(/\.json$/, '')
  if (!name.endsWith('.json') || !NOTE_ID.test(id) || id.length > 80) found.push('name: YYYY-MM-DD-slug.json (a-z, 0-9, -)')
  else if (!realDate(id.slice(0, 10))) found.push(`name: ${id.slice(0, 10)} is not a date`)
  let note: Record<string, unknown>
  try {
    note = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return [...found, 'not valid JSON']
  }
  const allowed = new Set(['kind', 'audience', 'icon', 'link', ...LANGS])
  found.push(...Object.keys(note).filter((key) => !allowed.has(key)).map((key) => `unknown field "${key}"`))
  if (!['new', 'improved', 'fixed'].includes(note.kind as string)) found.push('kind: new, improved or fixed')
  if (!['everyone', 'admins'].includes(note.audience as string)) found.push('audience: everyone or admins')
  if ('icon' in note && !(typeof note.icon === 'string' && Object.hasOwn(NOTE_ICONS, note.icon))) {
    found.push(`icon: one of ${Object.keys(NOTE_ICONS).join(', ')}`)
  }
  if ('link' in note) {
    if (typeof note.link !== 'string' || !isStaticPage(note.link)) found.push('link: a page of the app, such as /admin/backup')
    else if (note.link.startsWith('/admin') && note.audience !== 'admins') found.push('link: administration pages need audience "admins"')
  }
  for (const lang of LANGS) {
    const text = note[lang] as Record<string, unknown> | undefined
    if (typeof text !== 'object' || text === null || Object.keys(text).toSorted().join() !== 'body,title') {
      found.push(`${lang}: { "title", "body" }`)
      continue
    }
    for (const [field, max] of [['title', TITLE_MAX], ['body', BODY_MAX]] as const) {
      const value = text[field]
      if (typeof value !== 'string' || !value.trim()) found.push(`${lang}.${field}: missing`)
      else if (value !== value.trim() || /\s{2,}|[\n\r\t]/.test(value)) found.push(`${lang}.${field}: one line, no extra spaces`)
      else if (value.length > max) found.push(`${lang}.${field}: ${value.length} characters (${max} at most)`)
    }
  }
  return found
}

const NOTE = (id: string, kind: Note['kind']): Note => {
  const text = { title: id, body: id }
  return { id, date: id.slice(0, 10), kind, audience: 'everyone', es: text, en: text, pt: text }
}

describe('what\'s new notes', () => {
  it.each(FILE_NAMES)('%s is a valid note', (name) => {
    expect(problems(name, readFileSync(at(`./notes/${name}`), 'utf8'))).toEqual([])
  })

  it('are all bundled, newest first', () => {
    expect(NOTES.map((note) => note.id)).toEqual(FILE_NAMES.map((name) => name.replace(/\.json$/, '')).toSorted().toReversed())
    expect(NOTES[0]).toMatchObject({ date: NOTES[0].id.slice(0, 10) })
  })

  it('finds what is wrong with a note', () => {
    const text = { title: 'Fotos en grande', body: 'Toca una foto para verla.' }
    const fine = { kind: 'new', audience: 'everyone', es: text, en: text, pt: text }
    expect(problems('2026-12-01-fotos.json', JSON.stringify(fine))).toEqual([])
    expect(problems('2026-12-01-fotos.json', JSON.stringify({ ...fine, audience: 'admins', icon: 'photo', link: '/admin/backup' }))).toEqual([])
    expect(problems('2026-02-30-Fotos.md', '{')).toEqual(['name: YYYY-MM-DD-slug.json (a-z, 0-9, -)', 'not valid JSON'])
    expect(problems('2026-02-30-fotos.json', JSON.stringify(fine))).toEqual(['name: 2026-02-30 is not a date'])
    expect(
      problems(
        '2026-12-01-fotos.json',
        JSON.stringify({ ...fine, kind: 'feature', audience: 'all', icon: 'unicorn', link: '/admin/backup', extra: 1, pt: { title: 'Fotos' } }),
      ),
    ).toEqual([
      'unknown field "extra"',
      'kind: new, improved or fixed',
      'audience: everyone or admins',
      `icon: one of ${Object.keys(NOTE_ICONS).join(', ')}`,
      'link: administration pages need audience "admins"',
      'pt: { "title", "body" }',
    ])
    for (const link of ['/c/ana', '/all/e/5', '/admin/events/7', '/nowhere', '/admin/nowhere', 'https://example.com', '/admin?tab=1']) {
      expect(problems('2026-12-01-fotos.json', JSON.stringify({ ...fine, audience: 'admins', link }))).toEqual([
        'link: a page of the app, such as /admin/backup',
      ])
    }
    const long = { title: 'x'.repeat(TITLE_MAX + 1), body: ' Toca  una foto. ' }
    expect(problems('2026-12-01-fotos.json', JSON.stringify({ ...fine, en: long }))).toEqual([
      `en.title: ${TITLE_MAX + 1} characters (${TITLE_MAX} at most)`,
      'en.body: one line, no extra spaces',
    ])
  })

  it('orders notes by kind and groups them by month', () => {
    const notes = [NOTE('2026-11-02-a', 'fixed'), NOTE('2026-12-20-b', 'improved'), NOTE('2026-11-20-c', 'new'), NOTE('2026-11-10-d', 'new')]
    expect(byKind(notes).map((note) => note.id)).toEqual(['2026-11-20-c', '2026-11-10-d', '2026-12-20-b', '2026-11-02-a'])
    expect(byMonth(notes).map(({ month, notes: items }) => [month, items.map((note) => note.id)])).toEqual([
      ['2026-12-01', ['2026-12-20-b']],
      ['2026-11-01', ['2026-11-20-c', '2026-11-10-d', '2026-11-02-a']],
    ])
  })

  it('gives every note an icon', () => {
    expect(noteIcon({ kind: 'new', icon: 'photo' })).toBe(NOTE_ICONS.photo)
    expect(noteIcon({ kind: 'fixed' })).toBe(NOTE_ICONS.tool)
    expect(noteIcon({ kind: 'improved', icon: 'toString' })).toBe(NOTE_ICONS['trending-up'])
  })
})
