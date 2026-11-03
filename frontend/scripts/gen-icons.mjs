// Renders the home-screen icons in public/ from public/favicon.svg, so an installed Timelife shows
// the same mark as the browser tab:
//
//   apple-touch-icon.png    180×180  iOS/iPadOS "Add to Home Screen" (linked from index.html)
//   icon-192.png            192×192  manifest.webmanifest, purpose "any"
//   icon-512.png            512×512  manifest.webmanifest, purpose "any"
//   icon-maskable-512.png   512×512  manifest.webmanifest, purpose "maskable" (Android launchers)
//
// Home screens need an opaque square: iOS fills transparency with black and never uses an SVG
// apple-touch-icon, so the transparent favicon is drawn on a light cream tile (--color-bg-elevated
// to --color-surface-2 of src/styles/tokens.css). Android crops the maskable icon to the
// launcher's shape (circle, squircle…) and only promises the centred circle of 40 % radius: the
// favicon's mark reaches 36.4/64 from its centre, so there it must stay below 0.70 of the tile.
//
// Uses Playwright's Chromium (`npx playwright install chromium` once). Run `npm run gen:icons`
// after changing favicon.svg and commit the PNGs.

import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../public')
const TILE = 'linear-gradient(#fffcf8, #f6efe7)'
// `mark`: the favicon's size as a fraction of the icon's.
const ICONS = [
  { file: 'apple-touch-icon.png', size: 180, mark: 0.76 },
  { file: 'icon-192.png', size: 192, mark: 0.76 },
  { file: 'icon-512.png', size: 512, mark: 0.76 },
  { file: 'icon-maskable-512.png', size: 512, mark: 0.68 },
]

const favicon = `data:image/svg+xml;base64,${readFileSync(resolve(PUBLIC, 'favicon.svg')).toString('base64')}`

const browser = await chromium.launch()
try {
  for (const { file, size, mark } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(
      `<body style="margin: 0; height: ${size}px; display: grid; place-items: center; background: ${TILE}">` +
        `<img src="${favicon}" alt="" style="width: ${mark * size}px; height: ${mark * size}px"></body>`,
    )
    await page.locator('img').evaluate((image) => image.decode())
    await page.screenshot({ path: resolve(PUBLIC, file) })
    await page.close()
    console.log(`public/${file}  ${size}×${size}`)
  }
} finally {
  await browser.close()
}
