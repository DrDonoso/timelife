/**
 * The home-screen app: the links in index.html, public/manifest.webmanifest and the icons that
 * scripts/gen-icons.mjs renders. A mistake here only shows once someone installs it on a phone.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEME_COLORS } from './contexts/ThemeContext'

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose: string
}

// The path stays a parameter: Vite rewrites `new URL(<literal>, import.meta.url)` into an asset URL.
const read = (path: string) => readFileSync(new URL(path, import.meta.url))
const page = new DOMParser().parseFromString(read('../index.html').toString('utf8'), 'text/html')
const manifest = JSON.parse(read('../public/manifest.webmanifest').toString('utf8')) as {
  background_color: string
  theme_color: string
  icons: ManifestIcon[]
}

/** A file at the root of public/: the backend serves no subfolders of dist/ (src/timelife/app.py). */
function publicFile(href: string | null | undefined): Buffer {
  expect(href).toMatch(/^\/[\w.-]+$/)
  return read(`../public${href}`)
}

/** A PNG's size ("180x180") and whether it has an alpha channel (IHDR colour types 4 and 6). */
function png(file: Buffer): { size: string; alpha: boolean } {
  expect(file.subarray(1, 4).toString('ascii')).toBe('PNG')
  return { size: `${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`, alpha: (file[25] & 4) !== 0 }
}

describe('home-screen app', () => {
  it('gives iOS an opaque 180 px icon and the app name', () => {
    const link = page.querySelector('link[rel="apple-touch-icon"]')
    expect(link?.getAttribute('sizes')).toBe('180x180')
    // iOS turns transparent pixels black.
    expect(png(publicFile(link?.getAttribute('href')))).toEqual({ size: '180x180', alpha: false })
    expect(page.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('Timelife')
  })

  it('links a manifest whose icons have their declared size', () => {
    publicFile(page.querySelector('link[rel="manifest"]')?.getAttribute('href'))
    const files = manifest.icons.map(({ src }) => ({ src, type: 'image/png', ...png(publicFile(src)) }))
    expect(files).toEqual(manifest.icons.map(({ src, type, sizes }) => ({ src, type, size: sizes, alpha: false })))
    // Chrome installs an app with a 192 and a 512 px icon; Android launchers crop the maskable one.
    expect(manifest.icons.map(({ sizes, purpose }) => `${sizes} ${purpose}`)).toEqual(
      expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']),
    )
  })

  it('paints the splash screen and title bar in the light theme background', () => {
    expect(manifest.background_color).toBe(THEME_COLORS.light)
    expect(manifest.theme_color).toBe(THEME_COLORS.light)
  })
})
