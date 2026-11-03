import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_PALETTES, THEMES } from './themes'

// public/theme-init.js runs before the app (no imports, plain ES5), so it keeps its own copy of the
// palette backgrounds. The path stays a parameter: Vite rewrites `new URL(<literal>, import.meta.url)`.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('../../public/theme-init.js')

/** Runs the script as the page does, before the app. */
function run() {
  new Function(script)()
}

const root = document.documentElement
const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) => meta.getAttribute('content'))

describe('public/theme-init.js', () => {
  beforeEach(() => {
    root.setAttribute('lang', 'es')
    document.head.innerHTML = `
      <meta name="theme-color" content="#fbf7f2" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#1c1816" media="(prefers-color-scheme: dark)" />`
  })

  afterEach(() => {
    document.head.innerHTML = ''
    root.removeAttribute('data-theme')
    root.removeAttribute('data-palette')
    root.setAttribute('lang', 'es')
    root.style.colorScheme = ''
  })

  it("keeps a table of every palette's backgrounds equal to the registry", () => {
    const table = Object.fromEntries(
      Array.from(script.matchAll(/(\w+): \{ light: '(#[0-9a-f]{6})', dark: '(#[0-9a-f]{6})' \}/g), ([, palette, light, dark]) => [
        palette,
        { light, dark },
      ]),
    )
    expect(table).toEqual(Object.fromEntries(THEME_PALETTES.map((palette) => [palette, THEMES[palette].background])))
  })

  it('defaults to the system mode, the sunset palette and the page language', () => {
    run()
    expect(root.dataset.theme).toBe('light')
    expect(root.dataset.palette).toBe('sunset')
    expect(root.style.colorScheme).toBe('light')
    expect(root.getAttribute('lang')).toBe('es')
    expect(metas()).toEqual([THEMES.sunset.background.light, THEMES.sunset.background.dark])
  })

  it.each(THEME_PALETTES)('applies the saved %s palette and paints the browser UI with its backgrounds', (palette) => {
    localStorage.setItem('timelife.palette', palette)
    run()
    expect(root.dataset.palette).toBe(palette)
    expect(metas()).toEqual([THEMES[palette].background.light, THEMES[palette].background.dark])

    for (const mode of ['light', 'dark'] as const) {
      localStorage.setItem('timelife.theme', JSON.stringify(mode))
      run()
      expect(root.dataset.theme).toBe(mode)
      expect(root.style.colorScheme).toBe(mode)
      expect(metas()).toEqual([THEMES[palette].background[mode], THEMES[palette].background[mode]])
    }
  })

  it('ignores unknown palettes and languages', () => {
    localStorage.setItem('timelife.palette', 'neon')
    localStorage.setItem('timelife.lang', 'fr')
    root.setAttribute('lang', 'en')
    run()
    expect(root.dataset.palette).toBe('sunset')
    expect(root.getAttribute('lang')).toBe('en')
  })

  it.each(['es', 'en', 'pt'])('applies the saved language %s', (lang) => {
    localStorage.setItem('timelife.lang', `"${lang}"`)
    run()
    expect(root.getAttribute('lang')).toBe(lang)
  })

  it('never throws when the storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(run).not.toThrow()
    expect(root.dataset.theme).toBe('light')
    expect(root.dataset.palette).toBe('sunset')
  })
})
