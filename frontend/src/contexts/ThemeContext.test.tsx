import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { THEMES } from '../theme/themes'
import { THEME_COLORS, ThemeProvider, readStoredPalette, useTheme } from './ThemeContext'

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="theme-color" content="#fbf7f2" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#1c1816" media="(prefers-color-scheme: dark)" />`
  })

  afterEach(() => {
    document.head.innerHTML = ''
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.palette
    document.documentElement.style.colorScheme = ''
  })

  const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) => meta.getAttribute('content'))

  it('follows the system preference by default (light in tests)', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.preference).toBe('system')
    expect(result.current.resolved).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(metas()).toEqual([THEME_COLORS.light, THEME_COLORS.dark])
  })

  it('applies, persists and paints the browser UI for an explicit choice', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    act(() => result.current.setPreference('dark'))
    expect(result.current.resolved).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(localStorage.getItem('timelife.theme')).toBe('dark')
    expect(metas()).toEqual([THEME_COLORS.dark, THEME_COLORS.dark])

    act(() => result.current.setPreference('system'))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(metas()).toEqual([THEME_COLORS.light, THEME_COLORS.dark])
  })

  it('restores the stored preference', () => {
    localStorage.setItem('timelife.theme', '"dark"')
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.preference).toBe('dark')
  })

  it('uses the sunset palette by default, the colours of the home-screen app', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.palette).toBe('sunset')
    expect(document.documentElement.dataset.palette).toBe('sunset')
    expect(THEME_COLORS).toEqual(THEMES.sunset.background)
  })

  it('applies and persists a palette, and paints the browser UI with its backgrounds', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    act(() => result.current.setPalette('ocean'))
    expect(result.current.palette).toBe('ocean')
    expect(document.documentElement.dataset.palette).toBe('ocean')
    expect(localStorage.getItem('timelife.palette')).toBe('ocean')
    // System mode: one colour per scheme.
    expect(metas()).toEqual([THEMES.ocean.background.light, THEMES.ocean.background.dark])

    act(() => result.current.setPreference('dark'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.palette).toBe('ocean')
    expect(metas()).toEqual([THEMES.ocean.background.dark, THEMES.ocean.background.dark])

    act(() => result.current.setPalette('graphite'))
    expect(metas()).toEqual([THEMES.graphite.background.dark, THEMES.graphite.background.dark])
  })

  it('restores the stored palette and ignores unknown ones', () => {
    localStorage.setItem('timelife.palette', '"lavender"')
    const { result, unmount } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.palette).toBe('lavender')
    expect(document.documentElement.dataset.palette).toBe('lavender')
    unmount()

    for (const stored of ['neon', '', 'SUNSET', '__proto__']) {
      localStorage.setItem('timelife.palette', stored)
      expect(readStoredPalette()).toBe('sunset')
    }
    localStorage.removeItem('timelife.palette')
    expect(readStoredPalette()).toBe('sunset')
  })
})
