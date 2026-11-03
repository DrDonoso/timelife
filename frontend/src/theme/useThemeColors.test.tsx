import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeProvider, useTheme } from '../contexts/ThemeContext'
import { THEMES } from './themes'
import { ThemeScope, getThemeColors, useThemeColors } from './useThemeColors'

afterEach(() => {
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.palette
  document.documentElement.style.colorScheme = ''
})

describe('getThemeColors', () => {
  it('is memoised per palette and mode', () => {
    expect(getThemeColors('ocean', 'dark')).toBe(getThemeColors('ocean', 'dark'))
    expect(getThemeColors('ocean', 'dark')).not.toBe(getThemeColors('ocean', 'light'))
    expect(getThemeColors('ocean', 'dark').adapt).toBe(getThemeColors('ocean', 'dark').adapt)
  })

  it("paints years with the palette's automatic colours or the adapted overrides", () => {
    const colors = getThemeColors('forest', 'dark')
    expect(colors.autoYear(2026)).toBe(THEMES.forest.years[0])
    expect(colors.autoYear(2025)).toBe(THEMES.forest.years[9])
    expect(colors.autoYear(2036)).toBe(THEMES.forest.years[0])
    const overrides = [
      { year: 2026, color: '#1E3A8A' },
      { year: 2024, color: 'nope' },
    ]
    expect(colors.year(2026, overrides)).toBe(colors.adapt('#1e3a8a'))
    expect(colors.year(2026, overrides)).not.toBe('#1e3a8a')
    expect(colors.year(2024, overrides)).toBe(colors.autoYear(2024))
    expect(colors.year(2025)).toBe(colors.autoYear(2025))
  })

  it("paints lanes with the child's own colour adapted, else the palette's by position", () => {
    const colors = getThemeColors('lavender', 'light')
    expect(colors.lane(0)).toBe(THEMES.lavender.lanes[0])
    expect(colors.lane(9, null)).toBe(THEMES.lavender.lanes[1])
    expect(colors.lane(-1)).toBe(THEMES.lavender.lanes[7])
    expect(colors.lane(0, '#FDE047')).toBe(colors.adapt('#fde047'))
    expect(colors.lane(0, '')).toBe(THEMES.lavender.lanes[0])
  })

  it("gives the palette's hub badge background", () => {
    expect(getThemeColors('graphite', 'dark').hubBadgeBg).toBe(THEMES.graphite.hubBadge.dark)
    expect(getThemeColors('sunset', 'light').hubBadgeBg).toBe('#ffffff')
  })
})

describe('useThemeColors', () => {
  it('paints the default palette in light mode outside a ThemeProvider', () => {
    const { result } = renderHook(() => useThemeColors())
    expect(result.current).toBe(getThemeColors('sunset', 'light'))
  })

  it('follows the chosen palette and mode', () => {
    const { result } = renderHook(() => ({ theme: useTheme(), colors: useThemeColors() }), {
      wrapper: ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>,
    })
    expect(result.current.colors).toBe(getThemeColors('sunset', 'light'))
    act(() => result.current.theme.setPalette('ocean'))
    expect(result.current.colors).toBe(getThemeColors('ocean', 'light'))
    act(() => result.current.theme.setPreference('dark'))
    expect(result.current.colors).toBe(getThemeColors('ocean', 'dark'))
  })

  it('lets a ThemeScope force a mode or a palette for its subtree', () => {
    const { result } = renderHook(() => useThemeColors(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ThemeProvider>
          <ThemeScope palette="graphite">
            <ThemeScope mode="dark">{children}</ThemeScope>
          </ThemeScope>
        </ThemeProvider>
      ),
    })
    expect(result.current).toBe(getThemeColors('graphite', 'dark'))
  })
})
