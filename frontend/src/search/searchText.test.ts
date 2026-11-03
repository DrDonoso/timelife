import { describe, expect, it } from 'vitest'
import { matchingPreset, presetRange } from './datePresets'
import { foldText, highlightSegments, matchesTokens, normalizeQuery, rankMatches, searchTokens } from './searchText'

const marked = (text: string, query: string) =>
  highlightSegments(text, searchTokens(query))
    .map((segment) => (segment.match ? `[${segment.text}]` : segment.text))
    .join('')

describe('normalizeQuery', () => {
  it('trims, collapses whitespace and caps the length at 200 characters', () => {
    expect(normalizeQuery('  primeros   pasos \n')).toBe('primeros pasos')
    expect(normalizeQuery(null)).toBe('')
    expect(normalizeQuery('   ')).toBe('')
    expect(Array.from(normalizeQuery('😀'.repeat(250)))).toHaveLength(200)
  })
})

describe('search tokens and matching (mirror of the backend)', () => {
  it('folds accents, case and compatibility characters', () => {
    expect(foldText('Jardín ÑANDÚ Straße ﬁesta')).toBe('jardin nandu strasse fiesta')
    expect(searchTokens('  Pasos  pasos JARDÍN ')).toEqual(['pasos', 'jardin'])
  })

  it('requires every token to be contained in the title', () => {
    expect(matchesTokens('Primeros pasos en el jardín', ['jard', 'paso'])).toBe(true)
    expect(matchesTokens('Primeros pasos', ['pasos', 'luna'])).toBe(false)
    expect(matchesTokens('Cualquier cosa', [])).toBe(true)
  })

  it('ranks word-start matches first and otherwise keeps the original order', () => {
    const items = [{ title: 'Repaso de vocales' }, { title: 'Paseo por el parque' }, { title: 'Primeros pasos' }, { title: 'Luna' }]
    expect(rankMatches(items, searchTokens('pas')).map((item) => item.title)).toEqual([
      'Paseo por el parque',
      'Primeros pasos',
      'Repaso de vocales',
    ])
    expect(rankMatches(items, [])).toEqual([])
  })
})

describe('highlightSegments', () => {
  it('highlights accent-insensitively on the original characters', () => {
    expect(marked('Primeros pasos en el jardín', 'JARDIN pasos')).toBe('Primeros [pasos] en el [jardín]')
    expect(marked('Árbol', 'arb')).toBe('[Árb]ol')
  })

  it('handles decomposed accents, expansions and overlapping tokens', () => {
    expect(marked('Cafe\u0301 con leche', 'cafe')).toBe('[Cafe\u0301] con leche')
    expect(marked('Große Straße', 'strasse')).toBe('Große [Straße]')
    expect(marked('Mamá y papá', 'ma ama')).toBe('[Mamá] y papá')
  })

  it('marks every occurrence and leaves non-matching text whole', () => {
    expect(marked('papá y papá', 'pa')).toBe('[papá] y [papá]')
    expect(marked('Luna', 'sol')).toBe('Luna')
    expect(highlightSegments('', ['a'])).toEqual([])
  })
})

describe('date presets', () => {
  const today = '2026-10-20'

  it('computes the quick ranges relative to today', () => {
    expect(presetRange('thisYear', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(presetRange('last12Months', today)).toEqual({ from: '2025-10-21', to: '2026-10-20' })
    expect(presetRange('lastYear', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
    // Leap day: 12 months back clamps to 28 Feb, so the range starts on 1 March.
    expect(presetRange('last12Months', '2028-02-29')).toEqual({ from: '2027-03-01', to: '2028-02-29' })
  })

  it('recognises the preset matching a range', () => {
    expect(matchingPreset('2026-01-01', '2026-12-31', today)).toBe('thisYear')
    expect(matchingPreset('2025-10-21', '2026-10-20', today)).toBe('last12Months')
    expect(matchingPreset('2026-01-01', null, today)).toBeNull()
    expect(matchingPreset('2026-02-01', '2026-12-31', today)).toBeNull()
  })
})
