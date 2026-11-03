import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEME_PALETTES, THEMES, type ResolvedTheme, type ThemePalette } from '../theme/themes'
import { contrastRatio } from '../utils/color'

type Tokens = Record<string, string>

// Read from disk: Vitest doesn't process CSS (`?raw` imports of .css come back empty). The path stays a
// parameter: Vite rewrites `new URL(<literal>, import.meta.url)` into an asset URL.
const at = (path: string) => new URL(path, import.meta.url)
const read = (path: string) => readFileSync(at(path), 'utf8')
const tokensCss = read('./tokens.css')
const themesCss = read('./themes.css')

/** Custom properties declared in a rule body. */
function declarations(body: string): Tokens {
  return Object.fromEntries(
    Array.from(body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), ([, name, value]) => [name, value.trim().replace(/\s+/g, ' ')]),
  )
}

/** Top-level rules of `css` by selector list (one line, ", " separated); at-rules such as @media are skipped. */
function rules(css: string): Map<string, Tokens> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found = new Map<string, Tokens>()
  let depth = 0
  let start = 0
  let selector = ''
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '{') {
      if (depth === 0) {
        selector = text.slice(start, index).trim().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ')
        start = index + 1
      }
      depth += 1
    } else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) {
        if (!selector.startsWith('@')) found.set(selector, { ...found.get(selector), ...declarations(text.slice(start, index)) })
        start = index + 1
      }
    }
  }
  return found
}

const RULES = new Map([...rules(tokensCss), ...rules(themesCss)])

function block(selector: string): Tokens {
  const tokens = RULES.get(selector)
  if (!tokens) throw new Error(`${selector} not found`)
  return tokens
}

/** Where each palette and mode is declared (see the header of tokens.css). */
function selectorOf(palette: ThemePalette, mode: ResolvedTheme): string {
  if (palette === 'sunset') return mode === 'light' ? ":root, [data-theme='light']" : "[data-theme='dark']"
  return mode === 'light' ? `[data-palette='${palette}'], [data-palette='${palette}'][data-theme='light']` : `[data-palette='${palette}'][data-theme='dark']`
}

const MODES: readonly ResolvedTheme[] = ['light', 'dark']
const COMBOS = THEME_PALETTES.flatMap((palette) =>
  MODES.map((mode) => ({ name: `${palette} ${mode}`, palette, mode, tokens: block(selectorOf(palette, mode)) })),
)

/** Non-colour tokens: only in the first :root block. Colour tokens: what sunset light declares. */
const STRUCTURE = block(':root')
const COLOUR_TOKENS = Object.keys(block(selectorOf('sunset', 'light')))

/** Text tokens (all used for small text) and the surfaces they sit on: WCAG AA needs 4.5:1. */
const TEXT = ['--color-text', '--color-text-muted', '--color-text-subtle']
const BACKGROUNDS = ['--color-bg', '--color-bg-elevated', '--color-surface', '--color-surface-2']

/** [text, background] pairs of accent components (buttons, soft badges, tooltips). */
const ACCENT_PAIRS = [
  ['--color-primary-contrast', '--color-primary'],
  ['--color-primary-contrast', '--color-primary-hover'],
  ['--color-danger-contrast', '--color-danger'],
  ['--color-danger-contrast', '--color-danger-hover'],
  ['--color-primary-soft-text', '--color-primary-soft'],
  ['--color-tooltip-text', '--color-tooltip-bg'],
]

/** Status messages on the page, the surfaces and their own soft background; links on the page. */
const STATUS_PAIRS = [
  ...['--color-danger', '--color-success', '--color-warning'].flatMap((status) =>
    ['--color-bg', '--color-bg-elevated', '--color-surface', `${status}-soft`].map((background) => [status, background]),
  ),
  ['--color-primary', '--color-bg'],
  ['--color-primary', '--color-surface'],
]

/** Non-text UI (focus ring, input outlines): 3:1. */
const UI_PAIRS = [
  ['--color-focus', '--color-bg'],
  ['--color-focus', '--color-surface'],
  ['--color-focus', '--color-surface-2'],
  ['--color-border-strong', '--color-surface'],
]

const hexes = (value: string | undefined) => value?.match(/#[0-9a-f]{6}\b/gi) ?? []

function lowContrast(pairs: string[][], min: number): string[] {
  return COMBOS.flatMap(({ name, tokens }) =>
    pairs.flatMap(([text, background]) => {
      const ratio = contrastRatio(tokens[text] ?? text, tokens[background] ?? background)
      return ratio >= min ? [] : [`${name}: ${text} on ${background} = ${ratio.toFixed(2)}:1`]
    }),
  )
}

describe('design tokens', () => {
  it('keeps the non-colour tokens in :root and every colour token in each palette and mode', () => {
    expect(Object.keys(STRUCTURE)).toEqual(expect.arrayContaining(['--radius-md', '--space-4', '--font-sans', '--z-modal', '--ease-out', '--pattern-size']))
    expect(Object.keys(STRUCTURE).filter((name) => COLOUR_TOKENS.includes(name))).toEqual([])
    expect(COLOUR_TOKENS).toEqual(expect.arrayContaining(['--gradient-brand', '--color-hub-badge-bg', '--header-bg', '--shadow-lg', '--glow-gold', '--pattern-image']))
    for (const { name, tokens } of COMBOS) expect({ name, tokens: Object.keys(tokens).toSorted() }).toEqual({ name, tokens: COLOUR_TOKENS.toSorted() })
  })

  it('declares every audited colour as a hex value in every palette and mode', () => {
    const names = [...TEXT, ...BACKGROUNDS, ...ACCENT_PAIRS.flat(), ...STATUS_PAIRS.flat(), ...UI_PAIRS.flat(), '--color-hub-badge-bg']
    const invalid = COMBOS.flatMap(({ name, tokens }) =>
      names.filter((token) => !/^#[0-9a-f]{6}$/i.test(tokens[token] ?? '')).map((token) => `${name}: ${token} = ${tokens[token]}`),
    )
    expect(invalid).toEqual([])
  })

  it('keeps every text colour at 4.5:1 or more on every background', () => {
    expect(lowContrast(TEXT.flatMap((text) => BACKGROUNDS.map((background) => [text, background])), 4.5)).toEqual([])
  })

  it('keeps accent components, status messages and links readable (4.5:1 or more)', () => {
    expect(lowContrast([...ACCENT_PAIRS, ...STATUS_PAIRS], 4.5)).toEqual([])
  })

  it('keeps the focus ring and input outlines visible (3:1 or more)', () => {
    expect(lowContrast(UI_PAIRS, 3)).toEqual([])
  })

  it('keeps text readable on the soft brand gradient and the brand text gradient on the page', () => {
    const low = COMBOS.flatMap(({ name, tokens }) => {
      const check = (text: string, background: string, min: number) => {
        const ratio = contrastRatio(text, background)
        return ratio >= min ? [] : [`${name}: ${text} on ${background} = ${ratio.toFixed(2)}:1`]
      }
      const soft = hexes(tokens['--gradient-brand-soft'])
      const title = hexes(tokens['--gradient-brand-text'])
      expect([soft.length, title.length]).toEqual([3, 3])
      return [
        // The user menu's identity panel (name, e-mail) and the icons of page headers sit on it.
        ...soft.flatMap((stop) => [
          ...check(tokens['--color-text'], stop, 4.5),
          ...check(tokens['--color-text-muted'], stop, 4.5),
          ...check(tokens['--color-primary'], stop, 3),
        ]),
        // The large "Timelife" title of the sign-in card.
        ...title.flatMap((stop) => check(stop, tokens['--color-bg'], 3.8)),
      ]
    })
    expect(low).toEqual([])
  })

  it('keeps the browser UI and hub badge colours in sync with the palette registry', () => {
    const outOfSync = COMBOS.flatMap(({ name, palette, mode, tokens }) => [
      ...(tokens['--color-bg'] === THEMES[palette].background[mode] ? [] : [`${name}: --color-bg ${tokens['--color-bg']} ≠ ${THEMES[palette].background[mode]}`]),
      ...(tokens['--color-hub-badge-bg'] === THEMES[palette].hubBadge[mode]
        ? []
        : [`${name}: --color-hub-badge-bg ${tokens['--color-hub-badge-bg']} ≠ ${THEMES[palette].hubBadge[mode]}`]),
    ])
    expect(outOfSync).toEqual([])
  })

  it('tints the background pattern for every palette and mode', () => {
    const patterns = COMBOS.map(({ tokens }) => tokens['--pattern-image'])
    for (const pattern of patterns) expect(pattern).toMatch(/^url\("data:image\/svg\+xml,%3Csvg .*%3C\/svg%3E"\)$/)
    expect(new Set(patterns).size).toBe(COMBOS.length)
  })

  it('recomposes the background glow wherever a palette or a mode is set', () => {
    const glow = block(':root, [data-theme], [data-palette]')['--background-glow']
    for (const layer of ['--glow-gold', '--glow-rose', '--glow-coral']) expect(glow).toContain(`var(${layer})`)
  })

  it('leaves the palette tokens to tokens.css and themes.css (previews set data-palette and data-theme instead)', () => {
    const root = at('../')
    const modules = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.module.css'))
    expect(modules.length).toBeGreaterThan(0)
    const mirrors = modules.flatMap((file) =>
      Object.keys(declarations(readFileSync(new URL(file.replaceAll('\\', '/'), root), 'utf8')))
        .filter((name) => COLOUR_TOKENS.includes(name))
        .map((name) => `${file}: ${name}`),
    )
    expect(mirrors).toEqual([])
  })
})
