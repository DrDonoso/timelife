import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { TimelineEventOut } from '../api/schema.gen'
import { I18nProvider } from '../i18n'
import { THEMES } from '../theme/themes'
import { ThemeScope, getThemeColors } from '../theme/useThemeColors'
import { computeLayout, type LayoutLane } from './layout'
import { buildTimelineModel, type TimelineLane } from './model'
import { lanePath, lanesExtent, TimelineLanes } from './TimelineLanes'

const LANE: LayoutLane = {
  id: 1,
  index: 0,
  offset: -80,
  head: 100,
  tail: 700,
  segments: [
    { from: 100, to: 400, c0: -80, c1: -80 },
    { from: 400, to: 700, c0: -80, c1: 0 },
  ],
}

const FRAME = { orientation: 'horizontal', reversed: false, length: 1000 } as const

describe('lanePath', () => {
  it('draws straight runs as lines and curves as cubic S-curves with their control points at thirds', () => {
    expect(lanePath(FRAME, LANE, 0, 1000, 88)).toBe('M100 8L400 8C500 8 600 88 700 88')
  })

  it('mirrors along the axis in reversed frames and swaps the axes when vertical', () => {
    expect(lanePath({ ...FRAME, reversed: true }, LANE, 0, 1000, 88)).toBe('M900 8L600 8C500 8 400 88 300 88')
    expect(lanePath({ ...FRAME, orientation: 'vertical' }, LANE, 0, 1000, 88)).toBe('M8 100L8 400C8 500 88 600 88 700')
  })

  it('only draws the segments in the window', () => {
    expect(lanePath(FRAME, LANE, 450, 1000, 88)).toBe('M400 8C500 8 600 88 700 88')
    expect(lanePath(FRAME, LANE, 800, 1000, 88)).toBe('')
  })

  it('sizes the box around the outermost lane', () => {
    expect(lanesExtent([LANE, { ...LANE, id: 2, offset: 80 }])).toBe(88)
  })
})

function event(id: number, date: string, childIds: number[]): TimelineEventOut {
  return { id, title: `Hito ${id}`, date, day_order: 0, category_ids: [], child_ids: childIds, cover: null, image_count: 0, created_at: `${date}T10:00:00Z` }
}

describe('TimelineLanes', () => {
  const people: TimelineLane[] = [
    { id: 1, name: 'Emma', avatar: null },
    { id: 2, name: 'Leo', avatar: null },
  ]
  const model = buildTimelineModel([event(1, '2026-03-12', [2]), event(2, '2026-03-02', [1, 2]), event(3, '2026-01-20', [1])], people)
  const layout = computeLayout(model, 'events', { orientation: 'horizontal', viewport: 1200 })

  function renderLanes(lanes: readonly TimelineLane[], wrap: (children: ReactNode) => ReactNode = (children) => children) {
    const { container } = render(
      <I18nProvider>
        {wrap(<TimelineLanes layout={layout} people={lanes} from={0} to={layout.length} revealDelay={null} avatarSize={32} />)}
      </I18nProvider>,
    )
    const lines = [...container.querySelectorAll<SVGPathElement>('path[data-lane]')]
    const avatars = [...container.querySelectorAll<HTMLElement>('.slot')]
    return {
      container,
      lines: lines.map((line) => line.style.getPropertyValue('--lane-color')),
      avatars: avatars.map((slot) => slot.style.getPropertyValue('--lane-color')),
      ids: lines.map((line) => line.dataset.lane),
    }
  }

  it("draws one line per child in the palette's lane colours, with their avatar at the newest end", () => {
    const { container, lines, avatars, ids } = renderLanes(people)
    expect(ids).toEqual(['1', '2'])
    // Outside a ThemeProvider: sunset, the default palette.
    expect(lines).toEqual(THEMES.sunset.lanes.slice(0, 2))
    expect(avatars).toEqual(lines)
    // Initials avatars (decorative: the milestones say whose they are).
    expect(container.textContent).toBe('EL')
  })

  it("paints a child's own colour instead of the automatic one", () => {
    const { lines, avatars } = renderLanes([people[0], { ...people[1], color: '#123456' }])
    expect(lines).toEqual([THEMES.sunset.lanes[0], '#123456'])
    expect(avatars).toEqual(lines)
  })

  it("follows the palette: its own lane colours and the child's colour adapted to it", () => {
    const ocean = getThemeColors('ocean', 'dark')
    const { lines } = renderLanes([people[0], { ...people[1], color: '#123456' }], (children) => (
      <ThemeScope palette="ocean" mode="dark">
        {children}
      </ThemeScope>
    ))
    expect(lines).toEqual([THEMES.ocean.lanes[0], ocean.adapt('#123456')])
    expect(ocean.adapt('#123456')).not.toBe('#123456')
  })

  it('renders nothing without lanes (hub levels, a single child)', () => {
    const months = computeLayout(model, 'months', { orientation: 'horizontal', viewport: 1200 })
    const { container } = render(
      <I18nProvider>
        <TimelineLanes layout={months} people={people} from={0} to={months.length} revealDelay={null} avatarSize={32} />
      </I18nProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
